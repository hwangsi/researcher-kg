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

- [ ] `data/jcr-if.json` — manual ISSN→IF lookup for ~30 major radiology journals
- [ ] Use JCR IF when available, fallback to OpenAlex 2yr_mean_citedness
- [ ] PubMed E-utilities integration for MeSH terms
- [ ] Show MeSH-based topic classification alongside OpenAlex topics
- [x] Author ID consolidation UI (merge duplicate Korean author IDs)
- [x] ORCID-first search option (skip name disambiguation)

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
