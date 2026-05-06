// Author search & candidate selection UI.

window.RKG = window.RKG || {};

RKG.search = (function() {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];

  let _candidates = [];

  function init() {
    $('#search-btn').addEventListener('click', runSearch);
    $('#author-name').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
    $('#author-institution').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
    $('#author-specialty').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
  }

  function showStatus(msg, kind = 'info') {
    const el = $('#status');
    el.classList.remove('hidden');
    const cls = kind === 'error' ? 'status-error' : (kind === 'success' ? 'status-success' : 'status-info');
    el.innerHTML = `<div class="rounded p-3 text-sm ${cls}">${msg}</div>`;
  }
  function hideStatus() { $('#status').classList.add('hidden'); }

  function setSearching(on) {
    $('#search-btn').disabled = on;
    $('#search-btn-text').innerHTML = on
      ? '<span class="loader" style="vertical-align: -2px;"></span> 검색 중'
      : '검색';
  }

  function fmtNum(n) {
    if (n == null) return '—';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  async function runSearch() {
    const name = $('#author-name').value.trim();
    const inst = $('#author-institution').value.trim();
    const specialty = $('#author-specialty').value.trim();
    if (!name) { showStatus('저자 이름을 입력하세요.', 'error'); return; }

    hideStatus();
    setSearching(true);
    $('#candidates-section').classList.add('hidden');
    $('#dashboard').classList.add('hidden');

    try {
      _candidates = await RKG.api.searchAuthors(name, inst, specialty);
      if (!_candidates.length) {
        if (specialty) {
          showStatus('전문 분야 조건에 맞는 저자를 찾지 못했습니다. 전문 분야 키워드를 지우거나 바꿔 보세요.', 'error');
        } else {
          showStatus('일치하는 저자를 찾지 못했습니다. 이름 철자나 기관 키워드를 확인해보세요.', 'error');
        }
        return;
      }
      renderCandidates();
    } catch (e) {
      showStatus(`검색 오류: ${e.message}`, 'error');
    } finally {
      setSearching(false);
    }
  }

  function renderCandidates() {
    const list = $('#candidates-list');
    $('#candidate-count').textContent =
      `${_candidates.length} candidate${_candidates.length === 1 ? '' : 's'}`;

    list.innerHTML = _candidates.map((a, i) => {
      const insts = a._institutions.slice(0, 3).join(' · ') || '소속 미상';
      const orcid = a.orcid ? a.orcid.replace('https://orcid.org/', '') : '';

      // Top research areas: prefer topics fields, fall back to x_concepts
      const topicLabels = (a.topics || [])
        .slice(0, 3)
        .map(t => t.subfield ? t.subfield.display_name : t.display_name)
        .filter(Boolean);
      const conceptLabels = (a.x_concepts || [])
        .filter(c => c.level === 1)
        .slice(0, 3)
        .map(c => c.display_name);
      const areaLabels = topicLabels.length ? topicLabels : conceptLabels;

      return `
        <div class="candidate-card card rounded p-4" data-idx="${i}">
          <div class="flex items-start justify-between gap-3 mb-1">
            <p class="font-medium text-base">${a.display_name}</p>
            ${orcid ? `<span class="mono text-[10px] text-muted whitespace-nowrap">${orcid}</span>` : ''}
          </div>
          <p class="text-xs text-muted mb-1">${insts}</p>
          ${areaLabels.length ? `<p class="text-xs text-muted mb-2" style="color:#8B2331;">&#9670; ${areaLabels.join(' · ')}</p>` : '<div class="mb-2"></div>'}
          <div class="flex gap-3 text-xs">
            <span><span class="text-muted">Works:</span> <span class="mono">${a.works_count}</span></span>
            <span><span class="text-muted">Cited:</span> <span class="mono">${fmtNum(a.cited_by_count)}</span></span>
            ${a.summary_stats && a.summary_stats.h_index
                ? `<span><span class="text-muted">h:</span> <span class="mono">${a.summary_stats.h_index}</span></span>`
                : ''}
          </div>
        </div>
      `;
    }).join('');

    $$('#candidates-list .candidate-card').forEach(el => {
      el.addEventListener('click', () => selectAuthor(_candidates[+el.dataset.idx]));
    });

    $('#candidates-section').classList.remove('hidden');
  }

  async function selectAuthor(author) {
    $('#candidates-section').classList.add('hidden');
    showStatus(`<span class="loader" style="vertical-align:-2px;"></span> ${author.display_name} 의 논문을 불러오는 중...`);

    RKG.state.setAuthor(author);

    try {
      const works = await RKG.api.fetchAllWorks(author.id, count => {
        showStatus(`<span class="loader" style="vertical-align:-2px;"></span> 논문 로딩 중... (${count}개)`);
      });

      // Collect source IDs and fetch IFs
      const sourceIds = new Set();
      for (const w of works) {
        const src = w.primary_location && w.primary_location.source && w.primary_location.source.id;
        if (src) sourceIds.add(src);
      }

      showStatus(`<span class="loader" style="vertical-align:-2px;"></span> ${sourceIds.size}개 저널의 IF 정보를 가져오는 중...`);
      const stats = await RKG.api.fetchSourceStats(sourceIds);

      RKG.state.setWorks(works);
      RKG.state.setSourceStats(stats);

      hideStatus();
      RKG.dashboard.activate();
    } catch (e) {
      showStatus(`데이터 로딩 실패: ${e.message}`, 'error');
    }
  }

  return { init };
})();
