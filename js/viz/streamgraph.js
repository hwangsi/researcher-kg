// Topic streamgraph (STUB).
// TODO: D3 stacked area with d3.stackOffsetWiggle for streamgraph aesthetic.
//
// Plan:
// - For each year, count papers per topic (using getPrimaryTopic per work)
// - Build matrix: rows = years, columns = top N topics
// - Use d3.stack().offset(d3.stackOffsetWiggle) for streamgraph layout
// - X axis = year, Y centered (offset wiggle handles this)
// - Hover: show topic + paper count for that year
// - Use same TOPIC_PALETTE as bubble timeline for consistency
//
// Reference implementation: https://observablehq.com/@d3/streamgraph

window.RKG = window.RKG || {};

RKG.streamgraph = (function() {
  'use strict';

  function init() {
    const el = document.getElementById('streamgraph-container');
    if (!el) return;
    el.innerHTML = `
      <div class="flex items-center justify-center h-full text-sm text-muted">
        <div class="text-center">
          <p class="display text-2xl mb-2">🚧 미구현</p>
          <p>Topic streamgraph는 다음 단계에서 구현 예정입니다.</p>
          <p class="text-xs mt-2">참고: js/viz/streamgraph.js 의 TODO 주석</p>
        </div>
      </div>
    `;
    RKG.state.subscribe(() => { /* no-op until implemented */ });
  }

  return { init };
})();
