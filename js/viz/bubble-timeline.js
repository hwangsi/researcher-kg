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
  let _tooltipEl = null;
  let _tooltipHideTimer = null;

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
      return { bg: _hexToRgba(color, 0.18), border: color, borderWidth: 2.5, pointStyle: 'circle' };
    } else if (role === 'senior') {
      return { bg: _hexToRgba(color, 0.75), border: _darken(color, 0.7), borderWidth: 1.5, pointStyle: 'star' };
    } else {
      return { bg: _hexToRgba(color, 0.35), border: _hexToRgba(color, 0.5), borderWidth: 0.5, pointStyle: 'triangle' };
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
        <span style="width:12px;height:12px;border-radius:50%;border:2.5px solid #7F77DD;background:rgba(127,119,221,0.2);display:inline-block;box-sizing:border-box;flex-shrink:0;"></span>
        <span class="text-muted">제1저자</span>
      </span>
      <span class="flex items-center gap-1.5">
        <svg width="13" height="13" viewBox="0 0 13 13" style="display:inline-block;flex-shrink:0;vertical-align:middle;">
          <polygon points="6.5,0.5 7.9,4.4 12.2,4.8 9.1,7.5 10.1,11.8 6.5,9.5 2.9,11.8 3.9,7.5 0.8,4.8 5.1,4.4" fill="#7F77DD"/>
        </svg>
        <span class="text-muted">교신저자</span>
      </span>
      <span class="flex items-center gap-1.5">
        <svg width="11" height="11" viewBox="0 0 11 11" style="display:inline-block;flex-shrink:0;vertical-align:middle;">
          <polygon points="5.5,0.5 10.5,10.5 0.5,10.5" fill="rgba(127,119,221,0.45)" stroke="rgba(127,119,221,0.65)" stroke-width="0.8"/>
        </svg>
        <span class="text-muted">중간저자</span>
      </span>
    `;

    el.innerHTML = topicHTML + roleHTML;
  }

  // ----- sticky external tooltip -----

  function _ensureTooltip(container) {
    if (_tooltipEl && _tooltipEl.isConnected) return _tooltipEl;
    _tooltipEl = document.createElement('div');
    Object.assign(_tooltipEl.style, {
      position: 'absolute', pointerEvents: 'auto', zIndex: '100',
      background: 'rgba(255,254,250,0.97)', border: '1px solid #E5DFCF',
      padding: '10px 13px', borderRadius: '5px', fontSize: '11.5px',
      lineHeight: '1.6', maxWidth: '320px', display: 'none', opacity: '1',
      fontFamily: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
      fontFeatureSettings: 'normal', fontVariant: 'normal',
      color: '#1A1A1A',
      boxShadow: '0 3px 14px rgba(0,0,0,0.1)',
      transition: 'opacity 0.12s',
    });
    _tooltipEl.addEventListener('mouseenter', () => {
      if (_tooltipHideTimer) { clearTimeout(_tooltipHideTimer); _tooltipHideTimer = null; }
    });
    _tooltipEl.addEventListener('mouseleave', () => {
      _tooltipEl.style.display = 'none';
    });
    container.appendChild(_tooltipEl);
    return _tooltipEl;
  }

  function _externalTooltip(context) {
    const { chart, tooltip } = context;
    const el = _ensureTooltip(chart.canvas.parentNode);

    if (tooltip.opacity === 0) {
      if (!_tooltipHideTimer) {
        _tooltipHideTimer = setTimeout(() => {
          if (_tooltipEl) _tooltipEl.style.display = 'none';
          _tooltipHideTimer = null;
        }, 250);
      }
      return;
    }
    if (_tooltipHideTimer) { clearTimeout(_tooltipHideTimer); _tooltipHideTimer = null; }
    if (!tooltip.dataPoints || !tooltip.dataPoints.length) return;

    const p = tooltip.dataPoints[0].raw;
    if (!p || !p._work) return;
    const w = p._work;
    const journal = (_journalsList[p.y] || {}).name || '';
    const roleLabel = { first: '제1저자', senior: '교신/마지막 저자', middle: '중간 저자' }[p._role] || '';
    const title = (w.title || 'Untitled').slice(0, 100);
    const doi = w.doi ? `https://doi.org/${w.doi.replace('https://doi.org/', '')}` : null;

    const AF = 'font-family:Arial,"Helvetica Neue",Helvetica,sans-serif;font-feature-settings:normal;font-variant:normal;';
    el.innerHTML = `
      <div style="${AF}font-weight:600;line-height:1.4;margin-bottom:5px;">
        ${doi
          ? `<a href="${doi}" target="_blank" rel="noopener" style="${AF}color:#0078D4;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${title}</a>`
          : `<span style="${AF}">${title}</span>`}
      </div>
      <div style="${AF}color:#5A5A5A;margin-bottom:3px;">${journal} · ${p.x}</div>
      <div style="${AF}color:#5A5A5A;">${w.cited_by_count || 0} 인용 · ${roleLabel}${p._topic ? ' · ' + p._topic : ''}</div>
      ${doi ? `<div style="${AF}color:#ADADAD;font-size:10px;margin-top:4px;">↗ 논문 링크 클릭 가능</div>` : ''}
    `;

    el.style.display = 'block';
    const containerW = chart.canvas.parentNode.offsetWidth;
    let left = tooltip.caretX + 16;
    if (left + 330 > containerW) left = tooltip.caretX - 338;
    if (left < 0) left = 4;
    el.style.left = left + 'px';
    el.style.top = Math.max(0, tooltip.caretY - 14) + 'px';
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
        _pointStyle: style.pointStyle,
        _work: w, _role: role, _topic: topic, _color: color,
      });
    }

    _renderLegend();
    _renderChart(points);
  }

  function _renderChart(points) {
    const ctx = document.getElementById('bubble-canvas');
    if (_chart) { _chart.destroy(); _chart = null; }
    if (_tooltipEl) { _tooltipEl.remove(); _tooltipEl = null; }
    if (_tooltipHideTimer) { clearTimeout(_tooltipHideTimer); _tooltipHideTimer = null; }

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
          pointStyle: points.map(p => p._pointStyle),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 24, right: 16, bottom: 8, left: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: _externalTooltip,
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
