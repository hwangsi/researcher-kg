// Dashboard controller. Wires up tabs, stats, filters, and triggers viz updates.

window.RKG = window.RKG || {};

RKG.dashboard = (function() {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];

  let _activated = false;

  function fmtNum(n) {
    if (n == null) return '—';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function fmtFloat(n, digits = 2) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(digits);
  }

  function activate() {
    const s = RKG.state.get();
    const a = s.author;
    if (!a) return;

    // Author header
    $('#author-display-name').textContent = a.display_name;
    $('#author-affiliation').textContent = a._institutions.slice(0, 3).join(' · ');
    $('#author-orcid').textContent = a.orcid ? a.orcid.replace('https://', '') : '';

    // Year sliders
    const yMin = $('#year-min'), yMax = $('#year-max');
    yMin.min = yMax.min = s.yearMin;
    yMin.max = yMax.max = s.yearMax;
    yMin.value = s.yearMin;
    yMax.value = s.yearMax;
    updateYearLabel();

    $('#dashboard').classList.remove('hidden');

    if (!_activated) {
      _activated = true;
      _wireUpControls();

      // Initialize each viz module (they each subscribe to state)
      RKG.bubbleTimeline.init();
      RKG.coauthorNetwork.init();
      RKG.streamgraph.init();
      RKG.dotPlot.init();
      RKG.bubble3d.init();

      // Subscribe dashboard updates (stats, tables)
      RKG.state.subscribe(_renderAll);
    }

    _renderAll();
    $('#dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function _wireUpControls() {
    // Year sliders
    $('#year-min').addEventListener('input', _onYearChange);
    $('#year-max').addEventListener('input', _onYearChange);

    // Authorship role filter
    $$('#role-filter .role-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#role-filter .role-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        RKG.state.setAuthorshipRole(btn.dataset.role);
      });
    });

    // Co-author filter clear
    $('#clear-coauthor-filter').addEventListener('click', () => {
      RKG.state.setSelectedCoauthor(null);
    });

    // Network min papers slider
    $('#min-papers').addEventListener('input', e => {
      const n = +e.target.value;
      $('#min-papers-label').textContent = n;
      RKG.state.setMinCoauthorPapers(n);
    });

    // Tabs
    $$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        $$('.tab-panel').forEach(p => p.classList.add('hidden'));
        $(`#tab-${btn.dataset.tab}`).classList.remove('hidden');
        // Notify viz modules in case they need to redraw on first show
        const event = new CustomEvent('rkg:tab-shown', { detail: { tab: btn.dataset.tab } });
        document.dispatchEvent(event);
      });
    });

    // Reset button
    $('#reset-btn').addEventListener('click', () => {
      RKG.state.reset();
      $('#dashboard').classList.add('hidden');
      $('#author-name').focus();
    });
  }

  function _onYearChange() {
    const lo = +$('#year-min').value;
    const hi = +$('#year-max').value;
    RKG.state.setYearRange(lo, hi);
    updateYearLabel();
  }

  function updateYearLabel() {
    const s = RKG.state.get();
    $('#year-range-label').textContent = `${s.filteredYearMin} – ${s.filteredYearMax}`;
  }

  function _renderAll() {
    const s = RKG.state.get();
    if (!s.author) return;

    const works = RKG.state.getFilteredWorks();
    _renderStats(works);
    _renderJournals(works);
    _renderPapers(works);
    _renderActiveCoauthorFilter();
    updateYearLabel();
  }

  function _renderActiveCoauthorFilter() {
    const s = RKG.state.get();
    const el = $('#active-coauthor-filter');
    if (s.selectedCoauthor) {
      // find name
      const name = _findCoauthorName(s.selectedCoauthor) || s.selectedCoauthor;
      $('#active-coauthor-name').textContent = name;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  function _findCoauthorName(id) {
    const s = RKG.state.get();
    for (const w of s.works) {
      for (const auth of (w.authorships || [])) {
        if (auth.author && auth.author.id === id) return auth.author.display_name;
      }
    }
    return null;
  }

  function _renderStats(works) {
    const s = RKG.state.get();
    const totalCites = works.reduce((sum, w) => sum + (w.cited_by_count || 0), 0);

    const cites = works.map(w => w.cited_by_count || 0).sort((a, b) => b - a);
    let h = 0;
    for (let i = 0; i < cites.length; i++) {
      if (cites[i] >= i + 1) h = i + 1; else break;
    }

    const years = works.map(w => w.publication_year).filter(Boolean);
    const yearsActive = years.length ? (Math.max(...years) - Math.min(...years) + 1) : 0;

    const coauthors = new Set();
    for (const w of works) {
      for (const auth of (w.authorships || [])) {
        if (auth.author && auth.author.id && auth.author.id !== s.author.id) {
          coauthors.add(auth.author.id);
        }
      }
    }

    $('#stat-papers').textContent = works.length;
    $('#stat-citations').textContent = fmtNum(totalCites);
    $('#stat-hindex').textContent = h;
    $('#stat-years').textContent = yearsActive;
    $('#stat-coauthors').textContent = fmtNum(coauthors.size);
  }

  function _renderJournals(works) {
    const s = RKG.state.get();
    const counts = new Map();
    for (const w of works) {
      const sid = w.primary_location && w.primary_location.source && w.primary_location.source.id;
      if (!sid) continue;
      if (!counts.has(sid)) counts.set(sid, { papers: 0, cites: 0 });
      const o = counts.get(sid);
      o.papers++;
      o.cites += w.cited_by_count || 0;
    }
    const rows = [...counts.entries()]
      .map(([sid, c]) => {
        const stat = s.sourceStats.get(sid) || {};
        return { sid, name: stat.display_name || 'Unknown', if_2yr: stat.if_2yr, h_index: stat.h_index, ...c };
      })
      .sort((a, b) => b.papers - a.papers);

    $('#journals-tbody').innerHTML = rows.map(r => `
      <tr>
        <td><div class="font-medium journal-name">${r.name}</div></td>
        <td class="text-right mono">${r.papers}</td>
        <td class="text-right mono">${fmtNum(r.cites)}</td>
        <td class="text-right">
          ${r.if_2yr != null ? `<span class="pill pill-accent mono">${fmtFloat(r.if_2yr, 2)}</span>` : '<span class="text-muted">—</span>'}
        </td>
        <td class="text-right mono">${r.h_index != null ? r.h_index : '—'}</td>
      </tr>
    `).join('') || `<tr><td colspan="5" class="text-center text-muted py-6">데이터 없음</td></tr>`;
  }

  function _renderPapers(works) {
    const sorted = [...works].sort((a, b) => (b.publication_year || 0) - (a.publication_year || 0));
    const limit = 200;
    $('#papers-tbody').innerHTML = sorted.slice(0, limit).map(w => {
      const role = RKG.state.getAuthorshipRole(w);
      const journal = w.primary_location && w.primary_location.source && w.primary_location.source.display_name || '';
      const url = w.doi ? `https://doi.org/${w.doi.replace('https://doi.org/', '')}` : (w.id || '#');
      const rolePill = {
        first: '<span class="pill pill-first">제1</span>',
        senior: '<span class="pill pill-senior">교신</span>',
        middle: '<span class="pill pill-middle">중간</span>',
        none: '',
      }[role] || '';
      return `
        <tr>
          <td class="mono">${w.publication_year || '—'}</td>
          <td>${rolePill}</td>
          <td>
            <a href="${url}" target="_blank" class="font-medium hover:underline">${w.title || '(제목 없음)'}</a>
            ${journal ? `<div class="text-xs text-muted mt-0.5 journal-name">${journal}</div>` : ''}
          </td>
          <td class="text-right mono">${w.cited_by_count || 0}</td>
        </tr>
      `;
    }).join('');
    if (sorted.length > limit) {
      $('#papers-tbody').innerHTML += `<tr><td colspan="4" class="text-center text-muted py-3 text-xs">상위 ${limit}편만 표시 (전체 ${sorted.length}편)</td></tr>`;
    }
  }

  return { activate };
})();

// Boot
document.addEventListener('DOMContentLoaded', () => {
  RKG.search.init();
});
