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
    '#0071E3', '#248A3D', '#B25000', '#8944AB',
    '#0092A8', '#D70015', '#5856D6', '#C7256E',
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
      background: 'rgba(255,255,255,0.97)', border: '1px solid #D2D2D7',
      padding: '9px 12px', borderRadius: '4px', fontSize: '12px',
      lineHeight: '1.6', zIndex: '1000', maxWidth: '240px',
      fontFamily: "Arial, sans-serif",
      color: '#1D1D1F', boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
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
      div.textContent = 'No topic data (check the year range or filters)';
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
    const cols = Math.min(2, topTopics.length);
    const legendRows = Math.ceil(topTopics.length / cols);
    const LEGEND_H = legendRows * 26 + 14;
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
    // 2 columns so each cell is wide enough to show full topic names without clipping
    const cellW = Math.floor(innerW / cols);
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
        .attr('width', 13).attr('height', 13).attr('rx', 2).attr('y', 0)
        .attr('fill', topicColor.get(t))
        .attr('class', `sg-legend-${_cssId(t)}`);

      // Max chars that fit in cellW at 12px Arial (avg ~6.8px/char), leave room for rect+gap
      const maxChars = Math.floor((cellW - 22) / 6.8);
      lg.append('text')
        .attr('x', 20).attr('y', 12)
        .attr('font-size', 12).attr('fill', '#333336')
        .attr('font-family', 'Arial, sans-serif')
        .attr('class', `sg-legend-text-${_cssId(t)}`)
        .text(t.length > maxChars ? t.slice(0, maxChars - 1) + '…' : t);
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
          <div style="font-weight:600;font-size:13px;margin-bottom:5px;">${year}</div>
          <div style="display:flex;align-items:center;">${dot}<span style="font-size:12px;">${d.key.length > 30 ? d.key.slice(0, 28) + '…' : d.key}</span></div>
          <div style="font-size:12px;color:#6E6E73;margin-top:3px;">${cnt} papers · ${pct}% of year</div>
          <div style="font-size:11px;color:#86868B;margin-top:2px;">${total} papers total that year</div>
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
      .call(ax => ax.select('.domain').attr('stroke', '#D2D2D7'))
      .call(ax => ax.selectAll('.tick line').attr('stroke', '#D2D2D7'))
      .call(ax => ax.selectAll('.tick text')
        .attr('fill', '#424245')
        .attr('font-size', 12)
        .attr('font-family', "Arial, sans-serif")
      );

    // --- Cursor line ---
    const cursorLine = g.append('line')
      .attr('y1', 0).attr('y2', innerH)
      .attr('stroke', '#1D1D1F').attr('stroke-width', 1)
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
