# Researcher Knowledge Graph

연구자 한 명을 검색해서 그 사람의 출판 이력·공저자 관계·연구 주제 분포·저널 임팩트를 시각화하는 단일 페이지 웹앱.

## Quick start

```bash
# 그냥 index.html을 더블클릭. 또는:
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000
```

빌드 도구 없음. 백엔드 없음. CDN으로 라이브러리 로드.

## What's working

- 저자 검색 + 소속 기관으로 동명이인 disambiguation
- OpenAlex에서 전체 출판 이력 자동 수집 (cursor pagination)
- 통계 요약 (논문 수, 인용, h-index, 활동 기간, 공저자 수)
- 연도 범위 슬라이더로 모든 시각화 동기화
- **Bubble Timeline** — 연도 × 저널 × 인용 × 주제 + 저자 역할(1저자/교신/중간) 인코딩
- **Co-author Co-occurrence Network** — 본인 빼고 공저자끼리의 협업 구조
- 저널 표 (IF는 JCR 2025)
- 논문 목록 (DOI 링크)

## What's stub / TODO

- Topic streamgraph
- Co-author × year dot plot
- Cross-filtering between bubble timeline and co-author network
- JCR IF 정적 lookup (data/jcr-if.json)
- PubMed MeSH terms 통합

자세한 진행 계획은 `ROADMAP.md` 참고. 디자인 결정·기술 제약·관례는 `CLAUDE.md` 참고.

## Stack

- HTML / CSS / Vanilla JS (no build, no modules)
- Tailwind CDN (편의용 utility classes)
- Chart.js (bubble timeline, dot plot)
- D3 v7 (co-author network, streamgraph)
- OpenAlex API (data)

## File layout

`CLAUDE.md`가 가장 중요. Claude Code 작업 시작 전에 반드시 읽고 가세요.

```
index.html
css/styles.css
js/
  api.js, state.js, search.js, dashboard.js
  viz/{bubble-timeline,coauthor-network,streamgraph,dot-plot}.js
data/jcr-if.json
reference/mvp-v1.html
```
