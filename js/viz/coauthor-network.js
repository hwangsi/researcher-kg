// Co-author co-occurrence network. D3 force-directed layout.
// Nodes = co-authors (NOT including focal author).
// Edges = co-authors who appeared on the same paper.
// Click a node → set selectedCoauthor (filters bubble timeline).

window.RKG = window.RKG || {};

RKG.coauthorNetwork = (function() {
  'use strict';

  let _currentNodes = [];
  let _currentEdges = [];

  const W = 800, H = 600;

  const TOPIC_PALETTE = [
    '#7F77DD', '#1D9E75', '#EF9F27', '#D85A30',
    '#355374', '#6B4A7E', '#4A6B3F',
  ];
  const OTHER_COLOR = '#888780';

  let _container = null;
  let _svg = null;
  let _g = null;
  let _gEdges = null;
  let _gNodes = null;
  let _gLabels = null;
  let _simulation = null;

  // Track state to decide rebuild vs selection-only update.
  let _prev = {
    author: null, works: null,
    yearMin: null, yearMax: null,
    role: null, minPapers: null,
  };

  function init() {
    _container = document.getElementById('network-container');
    _setupSVG();
    RKG.state.subscribe(_onStateChange);
    document.addEventListener('rkg:tab-shown', e => {
      if (e.detail.tab === 'network') _resize();
    });
    window.addEventListener('resize', _resize);
    // Initial render if state already has an author (called during dashboard.activate)
    if (RKG.state.get().author) _onStateChange(RKG.state.get());
  }

  function _setupSVG() {
    _svg = d3.select(_container).append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    _g = _svg.append('g');
    _gEdges = _g.append('g').attr('class', 'edges');
    _gNodes = _g.append('g').attr('class', 'nodes');
    _gLabels = _g.append('g').attr('class', 'labels');

    _svg.call(d3.zoom()
      .scaleExtent([0.3, 3])
      .on('zoom', e => _g.attr('transform', e.transform))
    );
  }

  function _resize() {
    // viewBox handles scaling; nothing to do unless we want to refit.
  }

  function _onStateChange(s) {
    if (!s.author) return;

    const needsRebuild = (
      s.author !== _prev.author ||
      s.works !== _prev.works ||
      s.filteredYearMin !== _prev.yearMin ||
      s.filteredYearMax !== _prev.yearMax ||
      s.authorshipRole !== _prev.role ||
      s.minCoauthorPapers !== _prev.minPapers
    );

    _prev = {
      author: s.author, works: s.works,
      yearMin: s.filteredYearMin, yearMax: s.filteredYearMax,
      role: s.authorshipRole, minPapers: s.minCoauthorPapers,
    };

    if (needsRebuild) {
      _build();
    } else {
      _updateSelection();
    }
  }

  // ----- network works (year + role filters, NOT coauthor filter) -----

  function _networkWorks() {
    const s = RKG.state.get();
    return s.works.filter(w => {
      const y = w.publication_year;
      if (!y || y < s.filteredYearMin || y > s.filteredYearMax) return false;
      if (s.authorshipRole !== 'all' && RKG.state.getAuthorshipRole(w) !== s.authorshipRole) return false;
      return true;
    });
  }

  // ----- graph construction -----

  function _buildGraph(works, focalId, minPapers) {
    const nodeInfo = new Map();   // id -> {name, inst, count, topicCounts}
    const pairs = new Map();      // "id1__id2" -> count

    for (const w of works) {
      const others = (w.authorships || [])
        .filter(a => a.author && a.author.id && a.author.id !== focalId)
        .map(a => ({
          id: a.author.id,
          name: a.author.display_name,
          inst: (a.institutions && a.institutions[0] && a.institutions[0].display_name) || '',
        }));

      const topic = RKG.state.getPrimaryTopic(w);

      // Count individuals
      for (const o of others) {
        if (!nodeInfo.has(o.id)) {
          nodeInfo.set(o.id, { id: o.id, name: o.name, inst: o.inst, count: 0, topicCounts: new Map() });
        }
        const info = nodeInfo.get(o.id);
        info.count++;
        if (topic) info.topicCounts.set(topic, (info.topicCounts.get(topic) || 0) + 1);
      }

      // Count pairs
      const ids = others.map(o => o.id);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = [ids[i], ids[j]].sort().join('__');
          pairs.set(key, (pairs.get(key) || 0) + 1);
        }
      }
    }

    // Filter nodes by min papers threshold
    const visibleNodes = [...nodeInfo.values()].filter(n => n.count >= minPapers);
    const visibleIds = new Set(visibleNodes.map(n => n.id));

    // Assign primary topic per node
    for (const n of visibleNodes) {
      let best = null, max = 0;
      for (const [k, v] of n.topicCounts) {
        if (v > max) { max = v; best = k; }
      }
      n.primaryTopic = best;
    }

    // Build topic → color mapping (top N topics get palette colors)
    const topicTotals = new Map();
    for (const n of visibleNodes) {
      if (n.primaryTopic) topicTotals.set(n.primaryTopic, (topicTotals.get(n.primaryTopic) || 0) + n.count);
    }
    const topicColor = new Map();
    [...topicTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOPIC_PALETTE.length)
      .forEach(([t], i) => topicColor.set(t, TOPIC_PALETTE[i]));

    for (const n of visibleNodes) {
      n.color = topicColor.get(n.primaryTopic) || OTHER_COLOR;
      n.r = Math.min(28, 8 + Math.sqrt(n.count) * 3);
    }

    // Build edges only between visible nodes
    const edges = [];
    for (const [key, value] of pairs) {
      const [s, t] = key.split('__');
      if (visibleIds.has(s) && visibleIds.has(t)) {
        edges.push({ source: s, target: t, value });
      }
    }

    return { nodes: visibleNodes, edges, topicColor };
  }

  // ----- build & render -----

  function _build() {
    const s = RKG.state.get();
    const works = _networkWorks();
    const { nodes, edges, topicColor } = _buildGraph(works, s.author.id, s.minCoauthorPapers);
    _currentNodes = nodes;
    _currentEdges = edges;

    _updateNetworkStats(nodes.length, edges.length, topicColor);

    if (_simulation) _simulation.stop();
    _gEdges.selectAll('*').remove();
    _gNodes.selectAll('*').remove();
    _gLabels.selectAll('*').remove();

    if (!nodes.length) {
      _gLabels.append('text')
        .attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle')
        .attr('fill', '#6B6B6B').attr('font-size', 14)
        .text('표시할 공저자가 없습니다 (최소 공저 횟수를 줄여보세요)');
      return;
    }

    const linkSel = _gEdges.selectAll('line')
      .data(edges).enter().append('line')
      .attr('class', 'coauthor-edge')
      .attr('stroke', d => {
        const a = nodes.find(n => n.id === d.source);
        const b = nodes.find(n => n.id === d.target);
        return (a && b && a.color === b.color) ? a.color : OTHER_COLOR;
      })
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', d => Math.min(4, 0.8 + Math.log2(d.value + 1) * 0.7))
      .attr('stroke-linecap', 'round');

    const nodeSel = _gNodes.selectAll('circle')
      .data(nodes).enter().append('circle')
      .attr('class', 'coauthor-node')
      .attr('r', d => d.r)
      .attr('fill', d => d.color)
      .attr('stroke', d => _darken(d.color, 0.6))
      .attr('stroke-width', 1.5)
      .on('click', (event, d) => {
        const cur = RKG.state.get().selectedCoauthor;
        if (cur === d.id) {
          RKG.state.setSelectedCoauthor(null);
        } else {
          RKG.state.setSelectedCoauthor(d.id);
          _showSidebar(d);
        }
      })
      .call(d3.drag()
        .on('start', (event, d) => {
          if (!event.active) _simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => {
          if (!event.active) _simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        }));

    nodeSel.append('title').text(d => `${d.name}\n${d.inst || ''}\n공저 ${d.count}회${d.primaryTopic ? '\n주제: ' + d.primaryTopic : ''}`);

    const labelSel = _gLabels.selectAll('text')
      .data(nodes).enter().append('text')
      .attr('class', 'coauthor-label')
      .attr('text-anchor', 'middle')
      .attr('font-size', d => Math.max(7, Math.min(10, 6.5 + d.r * 0.08)))
      .text(d => d.name);

    _simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.id).distance(d => 110 - Math.min(60, d.value * 6)).strength(0.4))
      .force('charge', d3.forceManyBody().strength(d => -180 - d.r * 6))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide().radius(d => d.r + 6).iterations(2))
      .on('tick', () => {
        linkSel
          .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        nodeSel.attr('cx', d => d.x).attr('cy', d => d.y);
        labelSel.attr('x', d => d.x).attr('y', d => d.y + d.r + 12);
      });

    _updateSelection();
  }

  // ----- selection update (no rebuild) -----

  function _updateSelection() {
    const sel = RKG.state.get().selectedCoauthor;

    const nodes = _gNodes.selectAll('circle');
    const labels = _gLabels.selectAll('text');
    const edges = _gEdges.selectAll('line');

    if (!sel) {
      const sidebar = document.getElementById('network-sidebar');
      if (sidebar) sidebar.classList.add('hidden');
      nodes.classed('faded', false).classed('selected', false);
      labels.classed('faded', false);
      edges.classed('faded', false);
      return;
    }

    // Find connected node IDs
    const connected = new Set([sel]);
    edges.each(d => {
      const sId = d.source.id || d.source;
      const tId = d.target.id || d.target;
      if (sId === sel) connected.add(tId);
      if (tId === sel) connected.add(sId);
    });

    nodes
      .classed('selected', d => d.id === sel)
      .classed('faded', d => !connected.has(d.id));

    labels.classed('faded', d => !connected.has(d.id));

    edges.classed('faded', d => {
      const sId = d.source.id || d.source;
      const tId = d.target.id || d.target;
      return sId !== sel && tId !== sel;
    });
  }

  // ----- helpers -----

  function _showSidebar(node) {
    const el = document.getElementById('network-sidebar');
    if (!el) return;

    // Edges connected to this node (after D3 resolves IDs to objects)
    const connected = _currentEdges
      .filter(e => {
        const sId = typeof e.source === 'object' ? e.source.id : e.source;
        const tId = typeof e.target === 'object' ? e.target.id : e.target;
        return sId === node.id || tId === node.id;
      })
      .map(e => {
        const sId = typeof e.source === 'object' ? e.source.id : e.source;
        const tId = typeof e.target === 'object' ? e.target.id : e.target;
        const otherId = sId === node.id ? tId : sId;
        const other = _currentNodes.find(n => n.id === otherId);
        return { name: other ? other.name : '?', count: e.value };
      })
      .sort((a, b) => b.count - a.count);

    el.classList.remove('hidden');
    el.innerHTML = `
      <div style="padding:12px 14px; border-bottom:1px solid var(--rule);">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:4px; margin-bottom:6px;">
          <p style="font-weight:600; font-size:13px; line-height:1.35;">${node.name}</p>
          <button data-close-sidebar style="background:none; border:none; cursor:pointer; color:var(--ink-muted); font-size:18px; line-height:1; flex-shrink:0; padding:0 2px;">&times;</button>
        </div>
        ${node.inst ? `<p style="font-size:11px; color:var(--ink-muted); margin-bottom:4px; line-height:1.4;">${node.inst}</p>` : ''}
        <p style="font-size:11px; color:var(--ink-muted);">본인과 공저 <strong style="color:var(--ink);">${node.count}회</strong></p>
      </div>
      <div style="padding:10px 14px;">
        <p style="font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-muted); margin-bottom:8px;">함께 공저한 연구자</p>
        ${connected.length ? connected.map((c, i) => `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:5px 0; border-top:1px solid var(--rule);">
            <span style="font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:152px;" title="${c.name}">${i + 1}. ${c.name}</span>
            <span style="font-size:11px; font-family:'JetBrains Mono',monospace; color:var(--ink-muted); flex-shrink:0; margin-left:4px;">${c.count}</span>
          </div>`).join('') : '<p style="font-size:11px; color:var(--ink-muted);">없음</p>'}
      </div>`;

    el.querySelector('[data-close-sidebar]').addEventListener('click', () => {
      RKG.state.setSelectedCoauthor(null);
    });
  }

  function _darken(hex, factor = 0.7) {
    const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
    const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
    const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
    return `rgb(${r},${g},${b})`;
  }

  function _updateNetworkStats(nNodes, nEdges, topicColor) {
    const el = document.getElementById('network-stats');
    if (el) el.textContent = `${nNodes} co-authors · ${nEdges} edges · ${topicColor.size} clusters`;
  }

  return { init };
})();
