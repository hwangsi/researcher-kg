# Researcher Knowledge Graph

연구자 한 명을 검색해서 그 사람의 출판 이력·공저자 관계·연구 주제 분포·저널 임팩트를 시각화하는 단일 페이지 웹앱.

**데이터 소스:** [OpenAlex](https://openalex.org) — 빌드 도구 없음, 백엔드 없음, API 키 없음.

## 바로 사용하기

### 온라인 (GitHub Pages)
**https://hwangsi.github.io/researcher-kg/**

### 단일 파일 배포판 다운로드
[`researcher-kg.html`](researcher-kg.html) 을 다운로드 → 더블클릭으로 실행.
모든 코드가 한 파일에 포함되어 있습니다 (약 330 KB).

### 로컬 개발
```bash
# index.html 더블클릭, 또는:
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000
```

## 단일 파일 빌드

```bash
python build_dist.py
# → researcher-kg.html 생성 (약 330 KB)
```

소스 수정 후 `build_dist.py`를 실행하면 `researcher-kg.html`이 재생성됩니다.

## 주요 기능

- **저자 검색** — 이름 + 소속 기관 + 전공으로 동명이인 disambiguation
- **ORCID 직접 조회** — 가장 정확한 방법
- **다중 ID 병합** — OpenAlex가 같은 사람을 여러 ID로 split하는 경우 체크박스로 합산
- **Bubble Timeline** — 연도 × 저널 × 인용 × 주제 + 저자 역할(1저자/교신/중간) 인코딩
- **3D Timeline** — Three.js, X: 연도 / Y: IF / Z: 인용 수
- **Co-author Network** — D3 force-directed, 본인 제외 공저자 co-occurrence
- **Topic Streamgraph** — 연구 주제의 연도별 변화 흐름
- **Co-author Dot Plot** — 공저자 × 연도 산점도
- **저널 표** — JCR 2025 IF (fallback: OpenAlex 2yr citedness)
- **논문 목록** — 역할 필터, DOI 링크

## 기술 스택

| 라이브러리 | 용도 |
|---|---|
| Tailwind CDN | UI utility classes |
| Chart.js | Bubble timeline, dot plot |
| D3 v7 | Co-author network, streamgraph |
| Three.js | 3D bubble timeline |
| OpenAlex API | 논문·저자·저널 데이터 |

## 파일 구조

```
researcher-kg.html   ← 단일 파일 배포판 (빌드 결과물)
build_dist.py        ← 빌드 스크립트
index.html           ← 개발용 진입점
css/styles.css
js/
  api.js, state.js, search.js, dashboard.js
  viz/
    bubble-timeline.js, coauthor-network.js
    streamgraph.js, dot-plot.js, bubble-3d.js
data/
  jcr-if.js          ← JCR 2025 IF 데이터
reference/mvp-v1.html
```

`CLAUDE.md` — 설계 결정·제약·관례 (Claude Code 작업 시 필독).
