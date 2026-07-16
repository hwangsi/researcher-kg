# Roadmap

## Phase 1 — MVP foundation ✅ DONE

- [x] OpenAlex author search with institution filter
- [x] Candidate picker UI
- [x] Fetch all works via cursor pagination
- [x] Fetch source stats (IF proxy) in batches
- [x] Stats cards (papers, citations, h-index, years, coauthors)
- [x] Year range slider
- [x] Journal table with IF
- [x] Paper list with DOI links

Reference: `reference/mvp-v1.html`

## Phase 2 — Better visualizations 🚧 IN PROGRESS

- [x] Remove ego network (intentional)
- [x] **Bubble timeline** as main view (year × journal, size=cites, color=topic)
- [x] **Authorship role encoding** on bubbles (first/senior/middle via border + opacity)
- [x] Authorship filter toggle (all / first author only / senior author only)
- [x] **Co-author co-occurrence network** (D3 force, no ego node)
- [x] Co-author cluster coloring by primary topic
- [ ] Co-author min-papers threshold control
- [ ] Hover tooltips with full author lists on timeline bubbles

## Phase 3 — Cross-filtering & secondary views

- [ ] Click bubble → highlight co-authors in network, filter dot plot
- [ ] Click co-author node → filter bubbles to papers with that author
- [ ] Click cluster (lasso/topic group) → filter to that group's papers
- [ ] **Topic streamgraph** (`js/viz/streamgraph.js`)
- [ ] **Co-author × year dot plot** (`js/viz/dot-plot.js`)
- [ ] "Reset filters" button

## Phase 4 — Data quality & enrichment

- [x] JCR ISSN→IF lookup (`data/jcr-if.js`), fallback to OpenAlex 2yr_mean_citedness
- [x] Author ID consolidation UI (merge duplicate Korean author IDs)
- [x] ORCID-first search option (skip name disambiguation)
- [x] **3-stage works retrieval pipeline** (design in CLAUDE.md § "3-stage works retrieval pipeline"):
  - [x] Stage 1 — ORCID registry (`pub.orcid.org/v3.0/{id}/works`): author-curated DOI/PMID spine
  - [x] Stage 2 — OpenAlex: current author.id fetch + `author.orcid` filter + DOI-batch hydration of ORCID-only works
  - [x] Stage 3 — PubMed E-utilities: ORCID/DOI-keyed PMID lookup + MeSH enrichment (no name-only search)
  - [x] Merge by DOI → PMID → title+year; per-work `_sources` provenance + source badges in paper table
- [ ] Show MeSH-based topic classification alongside OpenAlex topics

## Phase 5 — Export & sharing

- [ ] Export current view as PNG (each viz)
- [ ] Export full report as PDF
- [ ] Shareable URL with author + filter state encoded
- [ ] CSV export of paper list
- [ ] Yearly snapshot mode (timeline at year=N for animation)

## Phase 6 — Comparison mode

- [ ] Compare two researchers side-by-side
- [ ] Find common collaborators
- [ ] Mentor-mentee detection (one's first-author papers = other's senior-author papers)

## Out of scope (don't build)

- Login / accounts / saved profiles → defeats "open and use" simplicity
- Real-time citation tracking → OpenAlex updates daily, that's enough
- Custom topic taxonomy → use OpenAlex topics + future MeSH; don't build a third
- Generic literature search → not the point; this is per-author

## Wishlist (maybe someday)

- Force-directed layout that "remembers" positions across renders for stable aesthetics
- 3D version of co-author network with topic as Z axis
- Integration with Korean journal databases (KCI) for better local journal coverage
