"""Extract ISSN -> Impact Factor data from a JCR category-ranking PDF.

Regenerates data/jcr-if.json and data/jcr-if.js from the yearly JCR report
PDF (the "Categories / Journal name / Abbreviation / ISSN / eISSN / Edition /
JIF / Rank / 5-Year IF / Immediacy Index" export).

Usage:
    python extract_jcr.py <path-to-JCR-pdf>

Parsing notes:
- Text is extracted per page with PyMuPDF and concatenated; the column header
  block appears only on page 1 and is stripped.
- Each record is anchored on its Edition line (SCIE/SSCI/ESCI/AHCI, possibly
  comma-combined). ISSN/eISSN are the two lines before it; JIF, rank, 5-year
  IF and immediacy index the four lines after it.
- Category names and journal names both wrap across lines. The category
  prefix of each record block is recovered by consensus with neighbouring
  records (a category section repeats identical leading lines).
- A journal listed in several categories keeps the rank/category of its LAST
  occurrence in the PDF (matches how previous years' data was built).
- JIF "N/A" entries are skipped; "<0.1" is stored as 0.1 (matches previous
  years' data).
"""

import json
import os
import re
import sys

import fitz  # PyMuPDF

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, 'data')

EDITION_RE = re.compile(r'^(SCIE|SSCI|ESCI|AHCI)(, ?(SCIE|SSCI|ESCI|AHCI))*$')
ISSN_RE = re.compile(r'^(\d{4}-\d{3}[\dXx]|N/A)$')
JIF_RE = re.compile(r'^(\d+(\.\d+)?|<0\.1|N/A)$')
RANK_RE = re.compile(r'^\s*(\d+/\d+|N/A)$')

HEADER_LINES = ['Categories', 'Journal name', 'Abbreviation', 'ISSN', 'eISSN',
                'Edition', 'Rank', '5-Year Impact', 'Factor', 'Immediacy', 'Index']


def extract_lines(pdf_path):
    """All text lines of the PDF, header blocks stripped. Returns (lines, jif_year).

    The 12-line column header block repeats at the start of every category
    section (not just page 1), so header runs are removed wherever they occur.
    """
    def is_notice(l):
        # Korean usage-notice box printed over the table (page 1) — never data
        return (l.startswith('<<') or 'jcr.clarivate.com' in l
                or any('가' <= ch <= '힣' for ch in l))

    doc = fitz.open(pdf_path)
    raw = []
    for page in doc:
        raw.extend(l.strip() for l in page.get_text().splitlines()
                   if l.strip() and not is_notice(l.strip()))
    doc.close()

    lines = []
    jif_year = None
    i = 0
    while i < len(raw):
        if raw[i] == 'Categories':
            i += 1
            while i < len(raw):
                m = re.match(r'^(\d{4}) JIF$', raw[i])
                if m:
                    jif_year = int(m.group(1))
                elif raw[i] not in HEADER_LINES:
                    break
                i += 1
            continue
        lines.append(raw[i])
        i += 1
    return lines, jif_year


def parse_records(lines):
    """Split lines into records anchored on the Edition line.

    Returns a list of dicts with keys: block (category+name+abbrev lines),
    issn, eissn, jif, rank.
    """
    records = []
    anchors = [i for i, l in enumerate(lines)
               if EDITION_RE.match(l)
               and i >= 2 and ISSN_RE.match(lines[i - 1]) and ISSN_RE.match(lines[i - 2])
               and i + 2 < len(lines) and JIF_RE.match(lines[i + 1]) and RANK_RE.match(lines[i + 2])]
    prev_end = -1
    for i in anchors:
        block = lines[prev_end + 1:i - 2]
        records.append({
            'block': block,
            'issn': lines[i - 2],
            'eissn': lines[i - 1],
            'jif': lines[i + 1],
            'rank': lines[i + 2].strip(),
        })
        prev_end = i + 4  # skip 5-year IF and immediacy index
    return records


def split_category(records):
    """Assign category/name/abbrev per record using neighbour consensus.

    Within a category section every record block starts with the same
    category lines, so the shared leading lines with the previous or next
    record give the category; the last block line is the abbreviation and
    whatever is left in between is the (possibly wrapped) journal name.
    """
    def common_prefix_len(a, b):
        n = 0
        for x, y in zip(a, b):
            if x != y:
                break
            n += 1
        return n

    def join(parts):
        # wrapped cells: re-join without a space after a hyphen ("SPEECH-" + "LANGUAGE")
        out = ''
        for p in parts:
            out += p if (not out or out.endswith('-')) else ' ' + p
        return out

    # pass 1: line-level consensus with neighbours (a section repeats its
    # category lines verbatim at the top of every record block)
    unresolved = []
    for idx, rec in enumerate(records):
        block = rec['block']
        prev_p = common_prefix_len(block, records[idx - 1]['block']) if idx > 0 else 0
        next_p = common_prefix_len(block, records[idx + 1]['block']) if idx + 1 < len(records) else 0
        cat_len = max(prev_p, next_p)
        # category + name + abbrev: need at least 1 line of name and the abbrev
        cat_len = min(cat_len, max(len(block) - 2, 1))
        if cat_len == 0:
            unresolved.append(idx)
            continue
        rec['category'] = join(block[:cat_len])
        rec['abbrev'] = block[-1]
        rec['name'] = join(block[cat_len:-1]) if len(block) - cat_len > 1 else rec['abbrev']

    # pass 2: some sections render category and journal name merged on ONE
    # text line ("ENDOCRINOLOGY & METABOLISM AACE Clinical Case Reports"),
    # so no line-level prefix is shared. A whole section can be merged this
    # way, so recover each such run's category as the longest common string
    # prefix of its records' first lines, then fall back to the category
    # vocabulary confirmed in pass 1.
    consensus = {r['category'] for r in records if 'category' in r}
    run_prefixes = set()
    runs, run = [], []
    for idx in unresolved:
        if run and idx != run[-1] + 1:
            runs.append(run)
            run = []
        run.append(idx)
    if run:
        runs.append(run)
    for r in runs:
        if len(r) < 3:
            continue
        firsts = [records[i]['block'][0] for i in r]
        prefix = firsts[0]
        for f in firsts[1:]:
            n = 0
            for x, y in zip(prefix, f):
                if x != y:
                    break
                n += 1
            prefix = prefix[:n]
        prefix = prefix[:prefix.rfind(' ')] if ' ' in prefix else ''
        if prefix:
            run_prefixes.add(prefix.strip())

    # consensus-confirmed categories outrank run-derived prefixes: a short run
    # of journals sharing a long name prefix ("NUCLEAR INSTRUMENTS & METHODS
    # ...") would otherwise overshoot past the real category
    known = (sorted(consensus, key=len, reverse=True)
             + sorted(run_prefixes - consensus, key=len, reverse=True))
    still = []
    for idx in unresolved:
        rec = records[idx]
        first = join(rec['block'][:max(len(rec['block']) - 1, 1)])
        for cat in known:
            if first == cat or first.startswith(cat + ' ') or first.startswith(cat):
                rec['category'] = cat
                rec['abbrev'] = rec['block'][-1]
                name = first[len(cat):].strip()
                rec['name'] = name or rec['abbrev']
                break
        else:
            still.append(idx)
    for idx in still:  # give up: whole block minus abbrev as name, no category
        rec = records[idx]
        rec['category'] = ''
        rec['abbrev'] = rec['block'][-1]
        rec['name'] = join(rec['block'][:-1]) or rec['abbrev']
    if still:
        print(f'warning: {len(still)} records without category consensus '
              f'(e.g. {records[still[0]]["block"]})')

    # pass 3: repair category/name splits that landed on the wrong boundary.
    # Two ways this happens: the category's wrapped second line is mistaken
    # for the name ("MEDICAL LABORATORY" + "TECHNOLOGY Annals of ..."), or
    # two adjacent records share an identical merged category+name first line
    # so pass 1 confirms a bogus over-long category. Re-split each record's
    # category+name text against TRUSTED categories — those backed by enough
    # records that a couple of merged rows cannot have fabricated them.
    from collections import Counter
    counts = Counter(r['category'] for r in records if r.get('category'))
    trusted = sorted((c for c, n in counts.items() if n >= 5),
                     key=len, reverse=True)
    for rec in records:
        cat = rec.get('category', '')
        combined = (cat + ' ' + rec['name']).strip() if rec['name'] != rec['abbrev'] else cat
        for c in trusted:
            if c == cat:
                break  # current split already trusted
            if combined == c:
                rec['category'] = c
                rec['name'] = rec['abbrev']
                break
            if combined.startswith(c + ' '):
                rec['category'] = c
                rec['name'] = combined[len(c) + 1:]
                break
    return records


def build_tables(records, jif_year):
    """ISSN -> metadata dict and ISSN -> IF float dict. Last occurrence wins."""
    if_key = f'if{jif_year}'
    meta = {}
    for rec in records:
        jif = rec['jif']
        if jif == 'N/A':
            continue
        value = 0.1 if jif == '<0.1' else round(float(jif), 1)
        entry = {'name': rec['name'], if_key: value,
                 'rank': rec['rank'], 'category': rec['category']}
        for issn in (rec['issn'], rec['eissn']):
            if issn != 'N/A':
                if issn in meta:
                    meta[issn].update(entry)  # keep first-insertion order, last values win
                else:
                    meta[issn] = dict(entry)
    lookup = {issn: m[if_key] for issn, m in meta.items()}
    return meta, lookup


def main():
    if len(sys.argv) != 2:
        sys.exit(f'usage: python {os.path.basename(__file__)} <JCR pdf>')
    pdf_path = sys.argv[1]

    lines, jif_year = extract_lines(pdf_path)
    if not jif_year:
        sys.exit('could not detect "<year> JIF" column header on page 1')
    records = split_category(parse_records(lines))

    n_na = sum(1 for r in records if r['jif'] == 'N/A')
    n_lt = sum(1 for r in records if r['jif'] == '<0.1')
    meta, lookup = build_tables(records, jif_year)

    json_path = os.path.join(DATA_DIR, 'jcr-if.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))

    js_path = os.path.join(DATA_DIR, 'jcr-if.js')
    with open(js_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('window.RKG = window.RKG || {};\n')
        f.write('RKG.jcrData = ' + json.dumps(lookup, separators=(',', ':')) + ';\n')

    print(f'JIF year: {jif_year} (JCR {jif_year + 1} release)')
    print(f'records parsed: {len(records)} (JIF N/A skipped: {n_na}, "<0.1" stored as 0.1: {n_lt})')
    print(f'unique ISSN keys: {len(meta)}')
    print(f'wrote {json_path}')
    print(f'wrote {js_path}')


if __name__ == '__main__':
    main()
