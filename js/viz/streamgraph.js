// Topic streamgraph. D3 stacked area, wiggle offset.
// X = year, stacked areas = top 8 topics by total paper count.
// Hover: vertical cursor line + tooltip (topic, year, count, %).
// Click a stream to isolate it; click again to reset.
// Responds to all state filters (year, role, coauthor).

window.RKG = window.RKG || {};

RKG.streamgraph = (function() {
  'use strict';

  const MAX_TOPICS = 8;
  const TOPIC_PALETTE = [
    '#7F77DD', '#1D9E75', '#EF9F27', '#D85A30',
    '#355374', '#6B4A7E', '#4A6B3F', '#B05A5A',
  ];
  const FADE_OPACITY = 0.08;
  const ACTIVE_OPACITY = 0.88;

  let _container = null;
  let _tooltip = null;
  let _selectedTopic = null;    // locally selected (click-to-isolate), NOT in global state

  let _prev = { works: null, yearMin: null, yearMax: null, role: null, coauthor: null };

  function init() {
    _container = document.getElementById('streamgraph-container');
    if (!_container) return;

    _tooltip = document.createElement('div');
    Object.assign(_tooltip.style, {
      position: 'fixed', pointerEvents: 'none', display: 'none',
      background: 'rgba(255,254,250,0.97)', border: '1px solid #E5DFCF',
      padding: '9px 12px', borderRadius: '4px', fontSize: '12px',
      lineHeight: '1.6', zIndex: '1000', maxWidth: '240px',
      fontFamily: "'Pretendard Variable', system-ui, sans-serif",
      color: '#1A1A1A', boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
    });
    document.body.appendChild(_tooltip);

    RKG.state.subscribe(_onStateChange);
    document.addEventListener('rkg:tab-shown', e => {
      if (e.detail.tab === 'streamgraph') _render();
    });
    if (RKG.state.get().author) _render();
  }

  function _onStateChange(s) {
    if (!s.author) return;
    const changed = (
      s.works !== _prev.works ||
      s.filteredYearMin !== _prev.yearMin ||
      s.filteredYearMax !== _prev.yearMax ||
      s.authorshipRole !== _prev.role ||
      s.selectedCoauthor !== _prev.coauthor
    );
    _prev = {
      works: s.works, yearMin: s.filteredYearMin, yearMax: s.filteredYearMax,
      role: s.authorshipRole, coauthor: s.selectedCoauthor,
    };
    if (changed) {
      _selectedTopic = null;  // reset isolation on data change
      _render();
    }
  }

  function _render() {
    if (!_container) return;
    const s = RKG.state.get();
    if (!s.author) return;

    d3.select(_container).selectAll('svg, .sg-empty').remove();

    const works = RKG.state.getFilteredWorks();
    const W = _container.clientWidth || 700;
    const H = _container.clientHeight || 400;

    // --- Top topics ---
    const topicTotals = new Map();
    for (const w of works) {
      const t = RKG.state.getPrimaryTopic(w);
      if (t && w.publication_year) {
        topicTotals.set(t, (topicTotals.get(t) || 0) + 1);
      }
    }

    if (!topicTotals.size) {
      const div = document.createElement('div');
      div.className = 'sg-empty';
      Object.assign(div.style, {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', fontSize: '13px', color: 'var(--ink-muted)',
      });
      div.textContent = '주제 데이터 없음 (연도 범위 또는 필터를 확인하세요)';
      _container.appendChild(div);
      return;
    }

    const topTopics = [...topicTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TOPICS)
      .map(([t]) => t);

    const topicColor = new Map(topTopics.map((t, i) => [t, TOPIC_PALETTE[i]]));

    // --- Year matrix ---
    const yearMin = s.filteredYearMin;
    const yearMax = s.filteredYearMax;
    const years = [];
    for (let y = yearMin; y <= yearMax; y++) years.push(y);

    const yearData = new Map(years.map(y => {
      const row = { year: y };
      for (const t of topTopics) row[t] = 0;
      return [y, row];
    }));

    for (const w of works) {
      const t = RKG.state.getPrimaryTopic(w);
      if (!t || !topicColor.has(t) || !w.publication_year) continue;
      const row = yearData.get(w.publication_year);
      if (row) row[t]++;
    }

    const data = years.map(y => yearData.get(y));

    // --- D3 stack ---
    const stack = d3.stack()
      .keys(topTopics)
      .offset(d3.stackOffsetWiggle)
      .order(d3.stackOrderInsideOut);

    const series = stack(data);

    // --- Layout ---
    const legendRows = Math.ceil(topTopics.length / 4);
    const LEGEND_H = legendRows * 26 + 10;
    const M = { top: 10, right: 20, bottom: 34, left: 44, legendTop: LEGEND_H };
    const innerW = W - M.left - M.right;
    const innerH = H - M.top - M.bottom - M.legendTop;

    const xScale = d3.scaleLinear()
      .domain([yearMin, yearMax])
      .range([0, innerW]);

    const yExtent = [
      d3.min(series, s => d3.min(s, d => d[0])),
      d3.max(series, s => d3.max(s, d => d[1])),
    ];
    const yScale = d3.scaleLinear()
      .domain(yExtent)
      .range([innerH, 0]);

    const area = d3.area()
      .x(d => xScale(d.data.year))
      .y0(d => yScale(d[0]))
      .y1(d => yScale(d[1]))
      .curve(d3.curveBasis);

    // --- SVG ---
    const svg = d3.select(_container).append('svg')
      .attr('width', W)
      .attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`);

    // --- Legend ---
    const cols = Math.min(4, topTopics.length);
    const cellW = Math.min(180, Math.floor(innerW / cols));
    const legendG = svg.append('g')
      .attr('transform', `translate(${M.left}, ${M.top})`);

    topTopics.forEach((t, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const lg = legendG.append('g')
        .attr('transform', `translate(${col * cellW}, ${row * 26})`)
        .style('cursor', 'pointer')
        .on('click', () => _toggleTopic(t, paths));

      lg.append('rect')
        .attr('width', 14).attr('height', 14).attr('rx', 2).attr('y', -1)
        .attr('fill', topicColor.get(t))
        .attr('class', `sg-legend-${_cssId(t)}`);

      lg.append('text')
        .attr('x', 20).attr('y', 11)
        .attr('font-size', 12).attr('fill', '#3A3A3A')
        .attr('font-family', "'Pretendard Variable', system-ui, sans-serif")
        .attr('class', `sg-legend-text-${_cssId(t)}`)
        .text(t.length > 22 ? t.slice(0, 20) + '…' : t);
    });

    // --- Chart group ---
    const g = svg.append('g')
      .attr('transform', `translate(${M.left}, ${M.top + M.legendTop})`);

    // --- Streams ---
    const paths = g.selectAll('.stream')
      .data(series)
      .enter().append('path')
      .attr('class', 'stream')
      .attr('d', area)
      .attr('fill', d => topicColor.get(d.key))
      .attr('fill-opacity', ACTIVE_OPACITY)
      .attr('stroke', d => topicColor.get(d.key))
      .attr('stroke-width', 0.5)
      .attr('stroke-opacity', 0.3)
      .style('cursor', 'pointer')
      .on('click', (event, d) => _toggleTopic(d.key, paths))
      .on('mousemove', function(event, d) {
        const [mx] = d3.pointer(event);
        const year = Math.round(xScale.invert(mx));
        if (year < yearMin || year > yearMax) { _hideTooltip(cursorLine); return; }

        const cx = xScale(year);
        cursorLine.attr('x1', cx).attr('x2', cx).attr('opacity', 0.55);

        const row = yearData.get(year);
        if (!row) { _hideTooltip(cursorLine); return; }

        const total = topTopics.reduce((sum, t) => sum + (row[t] || 0), 0);
        const cnt = row[d.key] || 0;
        const pct = total ? Math.round(cnt / total * 100) : 0;
        const dot = `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${topicColor.get(d.key)};margin-right:6px;vertical-align:-1px;"></span>`;

        _tooltip.innerHTML = `
          <div style="font-weight:600;font-size:13px;margin-bottom:5px;">${year}년</div>
          <div style="display:flex;align-items:center;">${dot}<span style="font-size:12px;">${d.key.length > 30 ? d.key.slice(0, 28) + '…' : d.key}</span></div>
          <div style="font-size:12px;color:#6B6B6B;margin-top:3px;">${cnt}편 · 전체의 ${pct}%</div>
          <div style="font-size:11px;color:#9B9B9B;margin-top:2px;">총 ${total}편 (해당 연도)</div>
        `;
        _tooltip.style.display = 'block';

        let tx = event.clientX + 16;
        if (tx + 250 > window.innerWidth) tx = event.clientX - 260;
        _tooltip.style.left = tx + 'px';
        _tooltip.style.top = (event.clientY - 10) + 'px';
      })
      .on('mouseleave', () => _hideTooltip(cursorLine));

    // Restore isolation state if user navigated away and back
    if (_selectedTopic) _applyIsolation(_selectedTopic, paths);

    // --- X axis ---
    const tickValues = years.filter((y, i) =>
      years.length <= 12 || y % 2 === 0 || i === 0 || i === years.length - 1
    );
    const xAxis = d3.axisBottom(xScale)
      .tickValues(tickValues)
      .tickFormat(d3.format('d'))
      .tickSize(4);

    g.append('g')
      .attr('transform', `translate(0, ${innerH})`)
      .call(xAxis)
      .call(ax => ax.select('.domain').attr('stroke', '#DDD7C5'))
      .call(ax => ax.selectAll('.tick line').attr('stroke', '#DDD7C5'))
      .call(ax => ax.selectAll('.tick text')
        .attr('fill', '#4A4A4A')
        .attr('font-size', 12)
        .attr('font-family', "'Pretendard Variable', system-ui, sans-serif")
      );

    // --- Cursor line ---
    const cursorLine = g.append('line')
      .attr('y1', 0).attr('y2', innerH)
      .attr('stroke', '#1A1A1A').attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .attr('opacity', 0)
      .attr('pointer-events', 'none');

    // Overlay for cursor tracking even in gaps
    g.append('rect')
      .attr('width', innerW).attr('height', innerH)
      .attr('fill', 'none').attr('pointer-events', 'all')
      .on('mouseleave', () => _hideTooltip(cursorLine));
  }

  function _toggleTopic(topic, paths) {
    if (_selectedTopic === topic) {
      _selectedTopic = null;
      paths.attr('fill-opacity', ACTIVE_OPACITY);
    } else {
      _selectedTopic = topic;
      _applyIsolation(topic, paths);
    }
  }

  function _applyIsolation(topic, paths) {
    paths.attr('fill-opacity', d => d.key === topic ? ACTIVE_OPACITY : FADE_OPACITY);
  }

  function _hideTooltip(cursorLine) {
    if (_tooltip) _tooltip.style.display = 'none';
    if (cursorLine) cursorLine.attr('opacity', 0);
  }

  function _cssId(str) {
    return str.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  }

  return { init };
})();
