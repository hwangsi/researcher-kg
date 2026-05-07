// Author search & candidate selection UI.

window.RKG = window.RKG || {};

RKG.search = (function() {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];

  let _candidates = [];
  let _selectedIds = new Set(); // indices into _candidates

  function init() {
    $('#search-btn').addEventListener('click', runSearch);
    ['#author-name', '#author-institution', '#author-specialty', '#author-orcid-input'].forEach(id => {
      $(id).addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
    });
    $('#merge-selected-btn').addEventListener('click', () => {
      if (_selectedIds.size < 2) return;
      mergeAndSelect([..._selectedIds].map(i => _candidates[i]));
    });
    $('#clear-selection-btn').addEventListener('click', () => {
      _selectedIds = new Set();
      $$('#candidates-list .candidate-check').forEach(cb => { cb.checked = false; });
      _updateMergeBtn();
    });
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

  function _updateMergeBtn() {
    const n = _selectedIds.size;
    $('#merge-selected-btn').disabled = n < 2;
    $('#merge-count').textContent = n;
  }

  async function runSearch() {
    const orcid = $('#author-orcid-input').value.trim();
    const name = $('#author-name').value.trim();
    const inst = $('#author-institution').value.trim();
    const specialty = $('#author-specialty').value.trim();
    const koreaOnly = !!($('#korea-only-chk') && $('#korea-only-chk').checked);

    if (!orcid && !name && !inst && !specialty) {
      showStatus('저자 이름, ORCID, 소속, 전문 분야 중 하나 이상을 입력하세요.', 'error');
      return;
    }

    hideStatus();
    setSearching(true);
    $('#candidates-section').classList.add('hidden');
    $('#dashboard').classList.add('hidden');

    try {
      _candidates = await RKG.api.searchAuthors({ name, institution: inst, specialty, orcid, koreaOnly });
      if (!_candidates.length) {
        if (orcid) {
          showStatus('ORCID는 조회됐더라도 함께 입력한 이름·소속·전문 분야 조건을 모두 만족하는 저자가 없습니다.', 'error');
        } else if (inst || specialty) {
          showStatus('입력한 이름·소속·전문 분야 조건을 모두 만족하는 저자를 찾지 못했습니다. 조건을 하나씩 완화해보세요.', 'error');
        } else {
          showStatus('일치하는 저자를 찾지 못했습니다. 이름 철자나 기관 키워드를 확인해보세요.', 'error');
        }
        return;
      }
      if (orcid && _candidates.length === 1) {
        selectAuthor(_candidates[0]);
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
    _selectedIds = new Set();
    _updateMergeBtn();

    const list = $('#candidates-list');
    $('#candidate-count').textContent =
      `${_candidates.length} candidate${_candidates.length === 1 ? '' : 's'}`;

    const resolvedInst = _candidates._resolvedInst || [];
    const noteEl = $('#inst-filter-note');
    if (noteEl) {
      if (resolvedInst.length) {
        noteEl.innerHTML = `기관 필터 적용됨: <span style="color:#2D5A1F;font-weight:500;">${resolvedInst.slice(0, 2).join(', ')}${resolvedInst.length > 2 ? ` 외 ${resolvedInst.length - 2}개` : ''}</span>`;
        noteEl.classList.remove('hidden');
      } else {
        noteEl.classList.add('hidden');
      }
    }

    list.innerHTML = _candidates.map((a, i) => {
      const displayInsts = a._displayInstitutions || a._matchedInstitutions || a._institutions || [];
      const insts = displayInsts.slice(0, 3).join(' · ') || '소속 미상';
      const orcid = a.orcid ? a.orcid.replace('https://orcid.org/', '') : '';
      const dupCount = (a._duplicateGroupIds || []).length;

      const topicLabels = (a.topics || [])
        .slice(0, 3)
        .map(t => t.subfield ? t.subfield.display_name : t.display_name)
        .filter(Boolean);
      const conceptLabels = (a.x_concepts || [])
        .filter(c => c.level === 1)
        .slice(0, 3)
        .map(c => c.display_name);
      const areaLabels = [...new Set(topicLabels.length ? topicLabels : conceptLabels)];
      const specEvidence = a._specialtyEvidence;

      return `
        <div class="candidate-card card rounded p-4 relative" data-idx="${i}">
          <input type="checkbox" class="candidate-check absolute top-3 right-3 w-4 h-4 cursor-pointer" data-idx="${i}">
          <div class="flex items-start gap-3 mb-1 pr-6">
            <p class="font-medium text-base flex-1">${a.display_name}</p>
            ${orcid ? `<span class="mono text-[10px] text-muted whitespace-nowrap">${orcid}</span>` : ''}
          </div>
          <p class="text-xs text-muted mb-1">${insts}</p>
          ${areaLabels.length ? `<p class="text-xs mb-2" style="color:#8B2331;">&#9670; ${areaLabels.join(' · ')}</p>` : '<div class="mb-2"></div>'}
          ${specEvidence ? `<p class="text-xs mb-2" style="color:#2D5A1F;">전공 근거: 주요 논문 ${specEvidence.matchedCount}/${specEvidence.sampleSize}건 일치</p>` : ''}
          ${dupCount > 1 ? `<p class="text-xs mb-2" style="color:#6A4A00;">중복 가능 ID ${dupCount}개: 필요하면 체크해서 병합</p>` : ''}
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
      el.addEventListener('click', e => {
        if (e.target.type === 'checkbox') return;
        selectAuthor(_candidates[+el.dataset.idx]);
      });
    });

    $$('#candidates-list .candidate-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx = +cb.dataset.idx;
        if (cb.checked) _selectedIds.add(idx); else _selectedIds.delete(idx);
        _updateMergeBtn();
      });
    });

    $('#candidates-section').classList.remove('hidden');
  }

  async function _loadWorksAndActivate(author, idList) {
    const allWorks = [];
    const seen = new Set();
    for (const id of idList) {
      const w = await RKG.api.fetchAllWorks(id, c => {
        showStatus(`<span class="loader" style="vertical-align:-2px;"></span> 논문 로딩 중... (${allWorks.length + c}개${idList.length > 1 ? ', ' + idList.length + '개 ID 병합 중' : ''})`);
      });
      for (const work of w) {
        const key = work.doi || work.id;
        if (!seen.has(key)) { seen.add(key); allWorks.push(work); }
      }
    }

    const filteredWorks = RKG.api.filterWorksBySearchCriteria
      ? RKG.api.filterWorksBySearchCriteria(allWorks, author)
      : allWorks;
    if (allWorks.length && !filteredWorks.length) {
      throw new Error('선택한 저자의 논문은 불러왔지만 입력한 소속·전공 조건을 만족하는 논문이 없습니다.');
    }

    const sourceIds = new Set();
    for (const w of filteredWorks) {
      const src = w.primary_location && w.primary_location.source && w.primary_location.source.id;
      if (src) sourceIds.add(src);
    }

    showStatus(`<span class="loader" style="vertical-align:-2px;"></span> ${sourceIds.size}개 저널의 IF 정보를 가져오는 중...`);
    const stats = await RKG.api.fetchSourceStats(sourceIds);

    RKG.state.setWorks(filteredWorks);
    RKG.state.setSourceStats(stats);
    hideStatus();
    RKG.dashboard.activate();
  }

  async function selectAuthor(author) {
    $('#candidates-section').classList.add('hidden');
    showStatus(`<span class="loader" style="vertical-align:-2px;"></span> ${author.display_name} 의 논문을 불러오는 중...`);
    RKG.state.setAuthor(author);
    try {
      await _loadWorksAndActivate(author, [author.id]);
    } catch (e) {
      showStatus(`데이터 로딩 실패: ${e.message}`, 'error');
    }
  }

  async function mergeAndSelect(authors) {
    $('#candidates-section').classList.add('hidden');
    const merged = {
      id: 'merged:' + authors.map(a => a.id).join(','),
      display_name: authors[0].display_name + ` (${authors.length} IDs 병합)`,
      _institutions: [...new Set(authors.flatMap(a => a._institutions))],
      _displayInstitutions: [...new Set(authors.flatMap(a => a._displayInstitutions || a._institutions))],
      _matchedInstitutions: [...new Set(authors.flatMap(a => a._matchedInstitutions || []))],
      _mergedIds: authors.map(a => a.id),
      works_count: authors.reduce((s, a) => s + (a.works_count || 0), 0),
      cited_by_count: authors.reduce((s, a) => s + (a.cited_by_count || 0), 0),
      orcid: (authors.find(a => a.orcid) || {}).orcid || null,
      _searchCriteria: authors[0]._searchCriteria || null,
    };
    showStatus(`<span class="loader" style="vertical-align:-2px;"></span> ${merged.display_name} 의 논문을 불러오는 중...`);
    RKG.state.setAuthor(merged);
    try {
      await _loadWorksAndActivate(merged, merged._mergedIds);
    } catch (e) {
      showStatus(`데이터 로딩 실패: ${e.message}`, 'error');
    }
  }

  return { init };
})();
