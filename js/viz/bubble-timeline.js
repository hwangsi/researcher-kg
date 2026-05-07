// Bubble timeline (career lifeline). Chart.js bubble chart.
// X = year, Y = journal (sorted by IF), size = citations, color = topic,
// border/opacity = authorship role (first / senior / middle).

window.RKG = window.RKG || {};

RKG.bubbleTimeline = (function() {
  'use strict';

  if (typeof Chart !== 'undefined' && Chart.defaults && Chart.defaults.font) {
    Chart.defaults.font.family = 'Arial, "Helvetica Neue", Helvetica, "Segoe UI", system-ui, sans-serif';
    Chart.defaults.font.size = 11;
    Chart.defaults.font.weight = '400';
    Chart.defaults.color = '#6B6B6B';
  }
  const TICK_FONT = { family: 'Arial, "Helvetica Neue", Helvetica, sans-serif', size: 11, weight: '400' };

  const TOPIC_PALETTE = [
    '#0078D4', // metro blue
    '#00B294', // metro teal
    '#FF8C00', // metro orange
    '#E81123', // metro red
    '#8764B8', // metro purple
    '#00B7C3', // metro cyan
    '#498205', // metro green
  ];
  const OTHER_COLOR = '#69797E';
  const MAX_JOURNALS = 18;

  let _chart = null;
  let _journalsList = [];
  let _topicMap = new Map();

  function init() {
    RKG.state.subscribe(_render);
    document.addEventListener('rkg:tab-shown', e => {
      if (e.detail.tab === 'bubble' && _chart) _chart.resize();
    });
    // Initial render if state already has an author (called during dashboard.activate)
    if (RKG.state.get().author) _render();
  }

  // ----- color utilities -----

  function _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function _darken(hex, factor = 0.7) {
    const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
    const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
    const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
    return `rgb(${r},${g},${b})`;
  }

  // ----- data shaping -----

  function _buildJournalsList(works, sourceStats) {
    const counts = new Map();
    for (const w of works) {
      const sid = w.primary_location && w.primary_location.source && w.primary_location.source.id;
      if (!sid) continue;
      counts.set(sid, (counts.get(sid) || 0) + 1);
    }
    const entries = [...counts.entries()].map(([sid, count]) => {
      const stat = sourceStats.get(sid) || {};
      return {
        sid, count,
        name: stat.display_name || 'Unknown',
        if_2yr: stat.if_2yr || 0,
      };
    });
    // Sort by IF descending (top journals on top), ties broken by paper count.
    entries.sort((a, b) => (b.if_2yr - a.if_2yr) || (b.count - a.count));
    return entries.slice(0, MAX_JOURNALS);
  }

  function _buildTopicMap(works) {
    const counts = new Map();
    for (const w of works) {
      const t = RKG.state.getPrimaryTopic(w);
      if (t) counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOPIC_PALETTE.length);
    const map = new Map();
    top.forEach(([name], i) => map.set(name, TOPIC_PALETTE[i]));
    return map;
  }

  // Normalize bubble radius against the max citations in the current filtered set
  // so relative size differences are always visible regardless of absolute scale.
  function _bubbleRadius(cites, role, maxCites) {
    const MIN_R = 3.5, MAX_R = 32;
    const r = maxCites > 0
      ? MIN_R + Math.sqrt(cites / maxCites) * (MAX_R - MIN_R)
      : MIN_R;
    return role === 'middle' ? r * 0.6 : r;
  }

  function _styleForRole(color, role) {
    if (role === 'first') {
      return { bg: _hexToRgba(color, 0.18), border: color, borderWidth: 2.5 };
    } else if (role === 'senior') {
      return { bg: _hexToRgba(color, 0.7), border: _darken(color, 0.7), borderWidth: 1.5 };
    } else {
      return { bg: _hexToRgba(color, 0.35), border: _hexToRgba(color, 0.5), borderWidth: 0.5 };
    }
  }

  // ----- legend -----

  function _renderLegend() {
    const el = document.getElementById('bubble-legend');
    const topicHTML = [..._topicMap.entries()].map(([name, color]) => `
      <span class="flex items-center gap-1.5">
        <span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;"></span>
        <span class="truncate" style="max-width:14ch;" title="${name}">${name}</span>
      </span>
    `).join('');

    const roleHTML = `
      <span class="flex items-center gap-1.5 ml-3 pl-3 border-l rule">
        <span style="width:12px;height:12px;border-radius:50%;border:2.5px solid #555;background:rgba(127,119,221,0.2);display:inline-block;box-sizing:border-box;"></span>
        <span class="text-muted">제1저자</span>
      </span>
      <span class="flex items-center gap-1.5">
        <span style="width:12px;height:12px;border-radius:50%;background:#7F77DD;display:inline-block;"></span>
        <span class="text-muted">교신/마지막</span>
      </span>
      <span class="flex items-center gap-1.5">
        <span style="width:8px;height:8px;border-radius:50%;background:rgba(127,119,221,0.5);display:inline-block;"></span>
        <span class="text-muted">중간</span>
      </span>
    `;

    el.innerHTML = topicHTML + roleHTML;
  }

  // ----- main render -----

  function _render() {
    const s = RKG.state.get();
    if (!s.author) return;

    const works = RKG.state.getFilteredWorks();
    _journalsList = _buildJournalsList(works, s.sourceStats);
    _topicMap = _buildTopicMap(works);

    const journalIdx = new Map(_journalsList.map((j, i) => [j.sid, i]));
    const maxCites = works.reduce((m, w) => Math.max(m, w.cited_by_count || 0), 1);

    const points = [];
    for (const w of works) {
      const sid = w.primary_location && w.primary_location.source && w.primary_location.source.id;
      if (!sid || !journalIdx.has(sid)) continue;

      const role = RKG.state.getAuthorshipRole(w);
      if (role === 'none') continue;

      const topic = RKG.state.getPrimaryTopic(w);
      const color = _topicMap.get(topic) || OTHER_COLOR;
      const r = _bubbleRadius(w.cited_by_count || 0, role, maxCites);
      const style = _styleForRole(color, role);

      points.push({
        x: w.publication_year,
        y: journalIdx.get(sid),
        r,
        _bg: style.bg, _border: style.border, _borderWidth: style.borderWidth,
        _work: w, _role: role, _topic: topic, _color: color,
      });
    }

    _renderLegend();
    _renderChart(points);
  }

  function _renderChart(points) {
    const ctx = document.getElementById('bubble-canvas');
    if (_chart) { _chart.destroy(); _chart = null; }

    const s = RKG.state.get();
    const xMin = s.filteredYearMin - 0.6;
    const xMax = s.filteredYearMax + 0.6;

    _chart = new Chart(ctx, {
      type: 'bubble',
      data: {
        datasets: [{
          data: points,
          backgroundColor: points.map(p => p._bg),
          borderColor: points.map(p => p._border),
          borderWidth: points.map(p => p._borderWidth),
          pointStyle: 'circle',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 24, right: 16, bottom: 8, left: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(255,254,250,0.97)',
            titleColor: '#1A1A1A',
            bodyColor: '#1A1A1A',
            borderColor: '#E5DFCF',
            borderWidth: 1,
            padding: 10,
            titleFont: TICK_FONT,
            bodyFont: TICK_FONT,
            callbacks: {
              label: ctx => {
                const p = ctx.raw;
                const w = p._work;
                const journal = (_journalsList[p.y] || {}).name || '';
                const roleLabel = { first: '제1저자', senior: '교신/마지막 저자', middle: '중간 저자' }[p._role] || '';
                const title = (w.title || 'Untitled').slice(0, 90);
                return [
                  title,
                  `${journal} · ${p.x}`,
                  `${w.cited_by_count || 0} cites · ${roleLabel}`,
                  p._topic ? `Topic: ${p._topic}` : '',
                ].filter(Boolean);
              },
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            min: xMin, max: xMax,
            ticks: { stepSize: 1, callback: v => Math.round(v), color: '#6B6B6B', font: TICK_FONT },
            grid: { color: 'rgba(0,0,0,0.04)' },
          },
          y: {
            min: -0.7, max: Math.max(_journalsList.length - 0.2, 0.5),
            ticks: {
              stepSize: 1,
              color: '#6B6B6B',
              font: TICK_FONT,
              padding: 6,
              callback: v => {
                const j = _journalsList[v];
                if (!j) return '';
                const cleaned = (j.name || '').replace(/^[^\w가-힣\(\[]+/u, '').trim();
                const name = cleaned.length > 28 ? cleaned.slice(0, 26) + '…' : cleaned;
                return j.if_2yr ? `${name} · ${j.if_2yr.toFixed(1)}` : name;
              },
            },
            grid: { color: 'rgba(0,0,0,0.04)' },
          },
        },
        onClick: (evt, items) => {
          if (!items.length) return;
          const idx = items[0].index;
          const p = _chart.data.datasets[0].data[idx];
          const w = p._work;
          if (w.doi) {
            const doi = w.doi.replace('https://doi.org/', '');
            window.open(`https://doi.org/${doi}`, '_blank');
          }
        },
      },
    });
  }

  return { init };
})();
