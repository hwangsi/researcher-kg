# Researcher Knowledge Graph — Project Context

## What this is

A single-page web app that pulls a researcher's publication record from OpenAlex and visualizes their research career: paper-level patterns (when, where, what, impact), collaboration structure, topic evolution, and authorship roles.

Target user: academic researchers (initially: radiology professors). Use case: career retrospective, finding collaborators, understanding research patterns, mentorship analysis.

## Tech stack constraints

- **No build step.** Vanilla HTML/CSS/JS. CDN-loaded libraries only.
- **No backend.** All data via public APIs (OpenAlex; future: PubMed).
- **Works from `file://` (double-click open).** Use script tags with global namespace, NOT ES modules — `type="module"` breaks under file://.
- Korean UI primary, English technical labels acceptable.
- All modules attach to `window.RKG` namespace.

## Data sources

### Primary: OpenAlex (https://api.openalex.org)
- Free, open, no API key. Add `?mailto=YOUR_EMAIL` for polite pool (faster, more reliable).
- Author search: `/authors?search={name}&per-page=25`
- All works for an author: `/works?filter=author.id:{id}&cursor=*&per-page=200&sort=publication_year:desc` (use cursor pagination for prolific authors)
- Source (journal) details: `/sources?filter=ids.openalex:{id1|id2|...}` (batch up to 50 per call)
- Works return both `topics` (newer, hierarchical) and `concepts` (older, deprecated). Always check both: `work.topics?.length ? work.topics : work.concepts`.

### Future: PubMed E-utilities
- For MeSH terms (clinically meaningful classification, especially for medical fields).
- `eutils.ncbi.nlm.nih.gov/entrez/eutils/...`
- CORS-friendly. No key required for low volume (<3 req/sec).

## Author identification

Name + institution keyword match → list of candidates → user picks. **Never auto-select**, even with one match. Korean names have severe disambiguation issues — the same person may appear under multiple OpenAlex IDs in older data.

Filter logic: case-insensitive substring match on the institution string against `affiliations[].institution.display_name` and `last_known_institutions[].display_name`. Tokens of length ≥3 required.

ORCID-first: 검색 폼의 ORCID 필드 사용 시 `/authors?filter=orcid:{}` 로 직접 조회. 가장 정확한 disambiguation. 단일 결과면 자동으로 선택 → 로딩 시작.

Multi-ID merge: OpenAlex가 한국인 이름의 같은 사람을 여러 ID로 split하는 경우가 잦음. 후보 picker에서 체크박스로 여러 ID 선택 후 병합. 병합된 author는 `_mergedIds` 배열을 가지며, 모든 모듈에서 `author.id` 단일 비교 대신 `focalIds = author._mergedIds || [author.id]` 패턴 사용 (state.js, dashboard.js, coauthor-network.js). works 로딩 시 각 ID에 fetchAllWorks 호출 후 DOI/id 기준 중복 제거.

## Impact factor handling

- **No JCR IF.** Clarivate doesn't expose IF via API; scraping is TOS violation.
- Use OpenAlex `summary_stats.2yr_mean_citedness` — same formula as JCR IF (citations in current year to articles published in previous 2 years), different citation database.
- Label as "IF (2yr)" with footnote that it's OpenAlex-derived.
- **Future enhancement:** maintain `data/jcr-if.json` as ISSN → IF lookup for major radiology journals (~30 journals covers most use cases). Manual curation, updated yearly.

## Visualization philosophy — IMPORTANT design decisions

We tried an ego network first. **It failed** and is intentionally removed. Reasons:
- Every edge was self → X — glorified radial list, no real relationships
- No temporal axis (career evolution invisible)
- Labels overlap when sized by frequency
- Can't show authorship role, citation impact, or topic clustering simultaneously

**The right approach: multiple coordinated views**, each answering one question well, linked by cross-filtering.

### 1. Bubble Timeline (main view) — "career lifeline"
- X = publication year
- Y = journal (sorted by IF or paper count)
- Bubble size = citations (sqrt scaling: `sqrt(cites) * 0.75 + 3.2`)
- Bubble color = research topic (top topic per paper)
- **Authorship role encoded on bubble itself:**
  - First author: outlined ring (2px border, ~20% fill opacity)
  - Senior/last author: filled solid (full color, 1.5px border)
  - Middle author: smaller, faded (50% size, 0.5px border, 30% opacity)
- One paper = one bubble. Hover/click for tooltip.
- Single chart answers when/where/what/impact in one glance.

### 2. Co-author co-occurrence network — "collaboration structure"
- Nodes = co-authors. **NO central ego node** — explicitly excluded.
- Node size = total papers with focal researcher
- Node color = primary topic of collaboration with focal researcher
- Edges = co-authors who appeared on the same paper (of focal researcher)
- Edge thickness = number of joint papers
- Force-directed layout (D3 d3-force) reveals research clusters/groups naturally
- Default threshold: only show co-authors with ≥2 papers (configurable)
- Bridge nodes (connecting clusters) become visually obvious

### 3. Topic streamgraph (secondary, currently STUB) — "research evolution"
- Stacked area chart, X = year, areas = topic frequency by year
- Shows how research focus has shifted over time
- Use D3 stack with `offset(d3.stackOffsetWiggle)` for streamgraph aesthetic

### 4. Co-author dot plot (secondary, currently STUB) — "collaboration timeline"
- Y = co-author (sorted by total papers, descending)
- X = year
- Dot = paper together (size by citations)
- Reveals long-term vs single-shot collaborators at a glance

### Cross-filtering between views (key UX)
- Click bubble in timeline → highlight that paper's co-authors in network, others fade
- Click node in network → filter timeline to papers with that co-author
- Click cluster in network → show only that group's papers
- All views read from central state in `js/state.js`; updates emit to subscribers

## File structure

```
index.html              entry point; loads scripts in order
css/styles.css          all custom styles (cream editorial theme)
js/api.js               OpenAlex API wrapper (searchAuthors, fetchAllWorks, fetchSourceStats)
js/state.js             central state + pub/sub + filtered selectors
js/search.js            author search & disambiguation UI
js/dashboard.js         dashboard controller, tabs, stats cards
js/viz/
  bubble-timeline.js    Chart.js bubble chart with authorship encoding
  coauthor-network.js   D3 force-directed co-author network (no ego node)
  streamgraph.js        STUB — D3 streamgraph for topic evolution
  dot-plot.js           STUB — Chart.js scatter as co-author × year dot plot
data/
  jcr-if.json           manual ISSN → IF lookup (currently empty placeholder)
reference/
  mvp-v1.html           original working monolithic MVP (do not modify)
```

## Conventions

- Global namespace: `window.RKG`. Each module: `RKG.moduleName = (function() { ... return {...}; })();`
- Async/await for all API calls. No callback chains.
- State mutations only through `RKG.state` setters. Direct mutation forbidden.
- DOM access scoped to relevant module — bubble-timeline.js doesn't touch network DOM, etc.
- Korean UI text in markup; English in code/identifiers/comments.
- Polite OpenAlex pool: `?mailto=...` query param on EVERY request (configured in api.js).
- Numeric formatting: round before displaying. Citation counts as integers, IF to 2 decimals.
- Error handling: API failures show user-facing status message, never throw to console.

## Authorship role detection

```js
function getAuthorshipRole(work, focalAuthorId) {
  const auths = work.authorships || [];
  const idx = auths.findIndex(a => a.author?.id === focalAuthorId);
  if (idx === -1) return 'none';
  if (auths.length === 1) return 'first';        // single-author paper
  if (idx === 0) return 'first';
  if (idx === auths.length - 1) return 'senior';  // last position = corresponding/PI
  return 'middle';
}
```

Korean academia convention: last author is typically the PI/senior author. Same for most clinical/medical fields.

## Co-author graph construction

```js
// For each paper, take all (author_i, author_j) pairs where i < j and neither is focal author.
// Increment pair count. Sort key = sorted IDs joined.
function buildCoauthorGraph(works, focalId, minPapers = 2) {
  const nodeCount = new Map();   // coauthorId -> {name, inst, count, topics: Map}
  const edgeCount = new Map();   // "id1__id2" (sorted) -> count
  // ... iterate works, count, then filter to nodes with count >= minPapers
}
```

Then assign each node its dominant topic for coloring.

## Known issues / quirks

- OpenAlex `cited_by_count` updates daily, not real-time.
- Very prolific authors (500+ papers) need cursor pagination — never offset.
- Korean author names: pre-2018 OpenAlex data may split same person across IDs. Manual ID consolidation may be needed for very senior researchers.
- Tailwind CDN: warns in dev tools but works fine for static deploy.
- Force layout is non-deterministic — clusters appear in different positions each render. Acceptable trade-off.
- Chart.js canvas text rendering gotcha: Chart.js는 라벨/툴팁을 <canvas>에 그리므로 CSS만으로 폰트 제어가 안 됨. body의 font-feature-settings가 canvas로 새는 문제도 있음. 차트 폰트는 반드시 Chart.defaults.font.family를 JS에서 설정 (현재 bubble-timeline.js 상단). 축별 ticks.font도 백업으로 둔다. 일부 OpenAlex 저널명에 leading control char가 있어 y축 callback에서 strip 함. 폰트 바꾸고 싶을 때는 bubble-timeline.js 상단의 Chart.defaults.font.family 와 TICK_FONT.family 두 줄만 바꾸면 됨. 같은 font-feature-settings 누수가 HTML 테이블·SVG text에서도 발생하므로, 데이터 표시 영역에는 styles.css에 별도 reset 룰을 둠 (table.kg-table 등 셀렉터).

## When working on this — DO and DON'T

DO:
- Test with multiple author profiles (productive PI, mid-career, junior)
- Round all displayed numbers
- Handle missing data gracefully (no journal, no topic, no citations)
- Preserve `reference/mvp-v1.html` untouched
- Add new viz modules to `js/viz/` and register in `index.html` script tags
- Use the existing color palette consistently (see `css/styles.css` :root vars)

DON'T:
- Reintroduce ego network in any form
- Cram more than 3 dimensions on a single chart
- Auto-select authors — always show candidate picker
- Claim JCR IF without using actual JCR data
- Use ES modules (`type="module"`) — breaks file:// loading
- Mutate state directly; always go through `RKG.state` setters

## Roadmap

See `ROADMAP.md`.
