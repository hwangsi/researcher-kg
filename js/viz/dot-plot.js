// Co-author × year dot plot.
// Y = co-author (top 30, sorted by total papers), X = year,
// dot size = citations (sqrt-scaled), dot color = primary topic.
// Deterministic Y-jitter prevents exact overlap without re-shuffling on each render.
// Click dot → open DOI. Responds to all state filters.

window.RKG = window.RKG || {};

RKG.dotPlot = (function() {
  'use strict';

  const MAX_AUTHORS = 30;
  const TOPIC_PALETTE = [
    '#7F77DD', '#1D9E75', '#EF9F27', '#D85A30',
    '#355374', '#6B4A7E', '#4A6B3F',
  ];
  const OTHER_COLOR = '#888780';

  let _chart = null;

  function init() {
    RKG.state.subscribe(_render);
    document.addEventListener('rkg:tab-shown', e => {
      if (e.detail.tab === 'dotplot' && _chart) _chart.resize();
    });
    if (RKG.state.get().author) _render();
  }

  // Deterministic jitter from a string key so positions are stable across re-renders.
  function _jitter(key) {
    let h = 5381;
    for (let i = 0; i < key.length; i++) h = ((h << 5) + h) ^ key.charCodeAt(i);
    return (((h >>> 0) % 1000) / 1000 - 0.5) * 0.42;
  }

  function _hexToRgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function _render() {
    const s = RKG.state.get();
    if (!s.author) return;

    const works = RKG.state.getFilteredWorks();
    const focalId = s.author.id;

    // Tally co-author paper counts
    const authorInfo = new Map(); // id -> {name, count}
    for (const w of works) {
      for (const auth of (w.authorships || [])) {
        const aid = auth.author && auth.author.id;
        if (!aid || aid === focalId) continue;
        if (!authorInfo.has(aid)) {
          authorInfo.set(aid, { name: auth.author.display_name, count: 0 });
        }
        authorInfo.get(aid).count++;
      }
    }

    const topAuthors = [...authorInfo.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, MAX_AUTHORS)
      .map(([id, info]) => ({ id, name: info.name, count: info.count }));

    const authorIdx = new Map(topAuthors.map((a, i) => [a.id, i]));

    // Build topic color map from all filtered works
    const topicCounts = new Map();
    for (const w of works) {
      const t = RKG.state.getPrimaryTopic(w);
      if (t) topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
    }
    const topicColor = new Map();
    [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOPIC_PALETTE.length)
      .forEach(([t], i) => topicColor.set(t, TOPIC_PALETTE[i]));

    // Build one point per (work, co-author) pair
    const points = [];
    for (const w of works) {
      if (!w.publication_year) continue;
      const cites = w.cited_by_count || 0;
      const r = Math.min(Math.sqrt(cites) * 0.32 + 2.8, 12);
      const topic = RKG.state.getPrimaryTopic(w);
      const color = topicColor.get(topic) || OTHER_COLOR;

      const seen = new Set();
      for (const auth of (w.authorships || [])) {
        const aid = auth.author && auth.author.id;
        if (!aid || aid === focalId || !authorIdx.has(aid) || seen.has(aid)) continue;
        seen.add(aid);
        const baseY = authorIdx.get(aid);
        points.push({
          x: w.publication_year,
          y: baseY + _jitter((w.id || '') + aid),
          r,
          _color: color,
          _work: w,
          _authorName: topAuthors[baseY].name,
          _baseY: baseY,
        });
      }
    }

    _draw(points, topAuthors, s);
  }

  function _draw(points, authors, s) {
    const container = document.getElementById('dotplot-container');
    if (!container) return;

    // Height proportional to number of authors shown
    const rowH = 22;
    const newH = Math.max(360, Math.min(680, authors.length * rowH + 72));
    container.style.height = newH + 'px';
    container.innerHTML = '<canvas id="dotplot-canvas" role="img" aria-label="Co-author dot plot"></canvas>';

    if (_chart) { _chart.destroy(); _chart = null; }

    if (!authors.length) {
      container.innerHTML = '<div class="flex items-center justify-center h-full text-sm" style="color:var(--ink-muted)">표시할 공저자 없음</div>';
      return;
    }

    const ctx = document.getElementById('dotplot-canvas');

    _chart = new Chart(ctx, {
      type: 'bubble',
      data: {
        datasets: [{
          data: points,
          backgroundColor: points.map(p => _hexToRgba(p._color, 0.62)),
          borderColor: points.map(p => _hexToRgba(p._color, 0.88)),
          borderWidth: 1,
          pointStyle: 'circle',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 6, right: 20, bottom: 4, left: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(255,254,250,0.97)',
            titleColor: '#1A1A1A',
            bodyColor: '#6B6B6B',
            borderColor: '#E5DFCF',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              title: () => '',
              label: ctx => {
                const p = ctx.raw;
                const w = p._work;
                const title = (w.title || '').length > 75
                  ? (w.title || '').slice(0, 73) + '…'
                  : (w.title || '');
                return [
                  p._authorName,
                  title,
                  `${w.publication_year} · ${w.cited_by_count || 0} 인용`,
                ].filter(Boolean);
              },
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            min: s.filteredYearMin - 0.5,
            max: s.filteredYearMax + 0.5,
            ticks: {
              stepSize: 1,
              callback: v => Number.isInteger(v) ? v : '',
              color: '#6B6B6B',
              font: { size: 11, family: 'Arial' },
            },
            grid: { color: 'rgba(0,0,0,0.04)' },
          },
          y: {
            type: 'linear',
            min: -0.7,
            max: authors.length - 0.3,
            reverse: true,  // index 0 (most frequent) at top
            ticks: {
              stepSize: 1,
              color: '#6B6B6B',
              font: { size: 10, family: 'Arial' },
              callback: v => {
                const i = Math.round(v);
                if (Math.abs(v - i) > 0.01) return '';
                const a = authors[i];
                if (!a) return '';
                const nm = a.name.length > 19 ? a.name.slice(0, 17) + '…' : a.name;
                return `${nm} (${a.count})`;
              },
            },
            grid: {
              color: i => {
                // Slightly stronger gridlines between rows for readability
                return Number.isInteger(i.tick.value) ? 'rgba(0,0,0,0.07)' : 'rgba(0,0,0,0)';
              },
            },
          },
        },
        onClick: (evt, items) => {
          if (!items.length) return;
          const p = _chart.data.datasets[0].data[items[0].index];
          if (p._work.doi) {
            window.open(`https://doi.org/${p._work.doi.replace('https://doi.org/', '')}`, '_blank');
          }
        },
      },
    });
  }

  return { init };
})();
