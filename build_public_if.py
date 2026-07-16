"""Build data/jcr-if-public.js — the small, committable subset of the local
JCR lookup (data/jcr-if.json).

The full JCR table is Clarivate-licensed and stays local-only (gitignored:
data/jcr-if.js / data/jcr-if.json). This subset is what the public build
ships: the whole RADIOLOGY, NUCLEAR MEDICINE & MEDICAL IMAGING category plus
a curated list of major general/medical journals. Journals not in the subset
fall back to OpenAlex 2yr mean citedness at runtime.

Usage:
    python extract_jcr.py <JCR pdf>   # regenerate the full local table first
    python build_public_if.py         # then rebuild the public subset
"""

import json
import os
import re
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, 'data')

SUBSET_CATEGORY = 'RADIOLOGY, NUCLEAR MEDICINE & MEDICAL IMAGING'

# Exact JCR journal names (case-insensitive match), curated for the journals
# a radiology/medical researcher is most likely to publish in outside the
# radiology category itself.
MAJOR_JOURNALS = [
    'LANCET',
    'NEW ENGLAND JOURNAL OF MEDICINE',
    'JAMA-JOURNAL OF THE AMERICAN MEDICAL ASSOCIATION',
    'BMJ-BRITISH MEDICAL JOURNAL',
    'NATURE',
    'SCIENCE',
    'NATURE MEDICINE',
    'NATURE COMMUNICATIONS',
    'NATURE BIOMEDICAL ENGINEERING',
    'SCIENTIFIC REPORTS',
    'PLOS ONE',
    'PROCEEDINGS OF THE NATIONAL ACADEMY OF SCIENCES OF THE UNITED STATES OF AMERICA',
    'ANNALS OF INTERNAL MEDICINE',
    'JAMA INTERNAL MEDICINE',
    'JAMA NETWORK OPEN',
    'JAMA ONCOLOGY',
    'JAMA SURGERY',
    'JOURNAL OF CLINICAL ONCOLOGY',
    'LANCET ONCOLOGY',
    'LANCET DIGITAL HEALTH',
    'ECLINICALMEDICINE',
    'NPJ DIGITAL MEDICINE',
    'MEDICINE',
    'CANCER RESEARCH AND TREATMENT',
    'JOURNAL OF KOREAN MEDICAL SCIENCE',
    'YONSEI MEDICAL JOURNAL',
]


def main():
    src = os.path.join(DATA_DIR, 'jcr-if.json')
    if not os.path.exists(src):
        sys.exit('data/jcr-if.json not found — run extract_jcr.py first')
    meta = json.load(open(src, encoding='utf-8'))

    majors = {n.casefold() for n in MAJOR_JOURNALS}
    if_key = next(k for k in next(iter(meta.values())) if re.match(r'^if\d{4}$', k))
    jif_year = if_key[2:]

    subset = {}
    matched_names = set()
    for issn, m in meta.items():
        name = m.get('name', '')
        if m.get('category') == SUBSET_CATEGORY or name.casefold() in majors:
            subset[issn] = m[if_key]
            matched_names.add(name.casefold())

    missing = sorted(majors - matched_names)
    if missing:
        print(f'warning: {len(missing)} major journals not found by name: {missing}')

    out = os.path.join(DATA_DIR, 'jcr-if-public.js')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(
            '// Public subset of Journal Impact Factor values, cited from\n'
            f'// Journal Citation Reports (Clarivate), {jif_year} JIF.\n'
            f'// Coverage: the "{SUBSET_CATEGORY}" category\n'
            '// plus curated major medical journals. Not a substitute for JCR;\n'
            '// see jcr.clarivate.com for the authoritative data.\n'
            '// Journals not listed here fall back to OpenAlex 2yr mean citedness.\n'
            '// Regenerate with: python build_public_if.py\n'
            'window.RKG = window.RKG || {};\n'
            '// The full local table (data/jcr-if.js, gitignored) wins when present.\n'
            'RKG.jcrData = RKG.jcrData || '
            + json.dumps(subset, separators=(',', ':')) + ';\n'
        )

    print(f'subset ISSN keys: {len(subset)} (JIF year {jif_year})')
    print(f'wrote {out}')


if __name__ == '__main__':
    main()
