// Co-author × year dot plot (STUB).
// TODO: Chart.js scatter or D3-based dot plot.
//
// Plan:
// - Y axis = co-author (sorted by total papers, descending)
// - X axis = year
// - Each dot = paper they appeared on with focal author
// - Dot size = citations of that paper
// - Dot color = topic of that paper
// - Limit to top N co-authors (e.g., 25-30) to keep readable
// - Use Chart.js scatter type with categorical Y axis (numeric indices + tick callback)
//
// This view answers "who's a long-term collaborator vs single-shot?"

window.RKG = window.RKG || {};

RKG.dotPlot = (function() {
  'use strict';

  function init() {
    const el = document.getElementById('dotplot-container');
    if (!el) return;
    // Replace canvas with placeholder for stub
    el.innerHTML = `
      <div class="flex items-center justify-center h-full text-sm text-muted">
        <div class="text-center">
          <p class="display text-2xl mb-2">🚧 미구현</p>
          <p>공저자 × 연도 dot plot는 다음 단계에서 구현 예정입니다.</p>
          <p class="text-xs mt-2">참고: js/viz/dot-plot.js 의 TODO 주석</p>
        </div>
      </div>
    `;
    RKG.state.subscribe(() => { /* no-op until implemented */ });
  }

  return { init };
})();
