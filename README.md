# Researcher Knowledge Graph

A single-page web app that visualizes one researcher's publication career: papers over time, co-author structure, topic evolution, and journal impact. No build tools, no backend, no API keys.

**Live:** https://hwangsi.github.io/researcher-kg/

## Quick start

### Online (GitHub Pages)
Open https://hwangsi.github.io/researcher-kg/ and search for an author.

### Local
```bash
# Double-click index.html, or:
python3 -m http.server 8000
# then open http://localhost:8000
```

## Features

- **Author search** — name + institution + specialty keywords for disambiguation of common names
- **ORCID lookup** — the most accurate way to identify an author
- **Multi-ID merge** — OpenAlex sometimes splits one person across several IDs; merge them with checkboxes (split IDs discovered via ORCID are folded in automatically)
- **3-stage works retrieval** — ORCID registry → OpenAlex → PubMed (see below)
- **Bubble Timeline** — year × journal × citations × topic, with authorship role (first / last / middle) encoded on each bubble
- **3D Timeline** — Three.js; X: year, Y: journal IF, Z: citations
- **Co-author Network** — D3 force-directed co-occurrence graph (focal author excluded by design)
- **Topic Streamgraph** — how research focus shifted over the years
- **Co-author Dot Plot** — co-author × year scatter, long-term vs one-shot collaborations
- **Journal table** — JCR Impact Factor with OpenAlex fallback (details below)
- **Paper list** — role filter, DOI/PubMed links, per-paper source badges (O = ORCID, P = PubMed/MeSH, ! = not in OpenAlex)

## How works are retrieved (3-stage pipeline)

1. **ORCID registry** (`pub.orcid.org`) — if the selected author has an ORCID, their self-curated publication list (DOIs/PMIDs) is fetched first. Highest precision; also catches papers filed under OpenAlex IDs the user didn't merge.
2. **OpenAlex** — the metadata core: citations, topics, authorship order, journals. Combines per-ID fetches, an `author.orcid` filter pass, and batch DOI hydration of ORCID-only papers.
3. **PubMed E-utilities** — keyed only on ORCID or DOIs (never name search, to avoid same-name contamination). Adds MeSH terms and recovers Medline-indexed papers missing from OpenAlex.

Each stage fails soft: if ORCID or PubMed is unavailable, the app continues with what it has. OpenAlex is the only required source.

## Impact Factor data

IF values come from two tiers, resolved per journal at runtime:

| Tier | Source | Coverage | UI marker |
|---|---|---|---|
| 1 | **JCR JIF** (Journal Citation Reports, Clarivate) | See below | plain value |
| 2 | **OpenAlex 2-year mean citedness** | Everything else | "OA" badge |

The OpenAlex fallback uses the same formula as the JIF (citations this year to items published in the previous two years) but a different citation database, so values are similar-but-not-identical to JCR.

### Why two JCR files?

Clarivate does not expose the JIF via any API, and the full JCR dataset is licensed — republishing all ~13,500 values would amount to redistributing it. So:

- **`data/jcr-if.js` / `data/jcr-if.json` (gitignored, local only)** — the full table, extracted from the yearly JCR report PDF with `extract_jcr.py`. Never committed.
- **`data/jcr-if-public.js` (committed)** — a small cited subset that the public build ships: the entire *Radiology, Nuclear Medicine & Medical Imaging* category (215 journals) plus ~26 major medical journals (NEJM, Lancet, JAMA, Nature, …), 418 ISSN keys total. Source attribution is in the file header.

`index.html` loads the full local table first (it 404s on the public build), then the public subset, which only assigns itself if nothing loaded. Journals outside the subset show the OpenAlex value with an "OA" badge.

Current data: **JCR 2026 release (2025 JIF values)**.

### Yearly update

```bash
python extract_jcr.py <path-to-new-JCR-pdf>   # full local table (stays local)
python build_public_if.py                     # public subset (commit this one)
```

## Tech stack

| Library | Used for |
|---|---|
| Tailwind CDN | UI utility classes |
| Chart.js | Bubble timeline, dot plot |
| D3 v7 | Co-author network, streamgraph |
| Three.js | 3D bubble timeline |
| OpenAlex API | Papers, authors, journals |
| ORCID Public API | Author-curated publication list |
| PubMed E-utilities | MeSH terms, Medline recall |

## File structure

```
index.html            ← entry point
researcher-kg.html    ← single-file distributable (built by build_dist.py)
build_dist.py         ← inlines CSS/JS into the distributable
extract_jcr.py        ← JCR PDF → full local IF table
build_public_if.py    ← full table → committed public subset
css/styles.css
js/
  api.js, state.js, search.js, dashboard.js, pubmed.js
  viz/
    bubble-timeline.js, coauthor-network.js
    streamgraph.js, dot-plot.js, bubble-3d.js
data/
  jcr-if-public.js    ← committed IF subset (radiology + major journals)
  jcr-if.js           ← full ISSN → IF table (gitignored, local only)
  jcr-if.json         ← full table + name/rank/category (gitignored)
reference/mvp-v1.html ← original MVP, kept for reference
```

`CLAUDE.md` documents design decisions, constraints, and conventions.

## Disclaimer

All data is retrieved from public web databases (OpenAlex, ORCID, PubMed) and may be inaccurate or incomplete. Impact Factor values are cited from Journal Citation Reports (Clarivate); see [jcr.clarivate.com](https://jcr.clarivate.com) for the authoritative data.

---

© 2026 Sung Il Hwang, MD, PhD. All rights reserved.
