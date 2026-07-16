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
      ? '<span class="loader" style="vertical-align: -2px;"></span> Searching'
      : 'Search';
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
      showStatus('Enter at least one of: author name, ORCID, institution, or specialty.', 'error');
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
          showStatus('The ORCID was found, but no author matches all the name/institution/specialty conditions you entered.', 'error');
        } else if (inst || specialty) {
          showStatus('No author matches all the name/institution/specialty conditions. Try relaxing them one at a time.', 'error');
        } else {
          showStatus('No matching authors found. Check the name spelling or institution keyword.', 'error');
        }
        return;
      }
      if (orcid && _candidates.length === 1) {
        selectAuthor(_candidates[0]);
        return;
      }
      renderCandidates();
    } catch (e) {
      showStatus(`Search error: ${e.message}`, 'error');
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
        noteEl.innerHTML = `Institution filter applied: <span style="color:#1D7A35;font-weight:500;">${resolvedInst.slice(0, 2).join(', ')}${resolvedInst.length > 2 ? ` +${resolvedInst.length - 2} more` : ''}</span>`;
        noteEl.classList.remove('hidden');
      } else {
        noteEl.classList.add('hidden');
      }
    }

    list.innerHTML = _candidates.map((a, i) => {
      const displayInsts = a._displayInstitutions || a._matchedInstitutions || a._institutions || [];
      const insts = displayInsts.slice(0, 3).join(' · ') || 'Unknown affiliation';
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
          ${areaLabels.length ? `<p class="text-xs mb-2" style="color:#0071E3;">&#9670; ${areaLabels.join(' · ')}</p>` : '<div class="mb-2"></div>'}
          ${specEvidence ? `<p class="text-xs mb-2" style="color:#1D7A35;">Specialty evidence: ${specEvidence.matchedCount}/${specEvidence.sampleSize} top papers match</p>` : ''}
          ${dupCount > 1 ? `<p class="text-xs mb-2" style="color:#B25000;">${dupCount} possible duplicate IDs — check to merge if needed</p>` : ''}
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

  const SPIN = '<span class="loader" style="vertical-align:-2px;"></span> ';

  function _normTitle(t) {
    return (t || '').toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim();
  }

  // Stage 3 — PubMed: MeSH enrichment + Medline-only recall (see CLAUDE.md).
  // Keyed ONLY on ORCID / DOIs — never name search. Returns minimal records
  // for Medline papers absent from OpenAlex (viz-safe: source.id is null).
  async function _enrichFromPubmed(works, orcid, orcidEntries, orcidDois) {
    if (!RKG.pubmed) return [];
    showStatus(`${SPIN}[3/3] Matching papers against PubMed...`);

    const orcidPmids = new Set(orcidEntries.map(e => e.pmid).filter(Boolean));
    const pmids = new Set(orcidPmids);
    if (orcid) {
      try {
        for (const id of await RKG.pubmed.pmidsByOrcid(orcid)) pmids.add(id);
      } catch (e) { console.warn('PubMed ORCID search failed (continuing)', e); }
    }
    const dois = works.map(w => w._doi).filter(Boolean);
    for (const id of await RKG.pubmed.pmidsByDois(dois, (done, total) =>
      showStatus(`${SPIN}[3/3] Matching DOIs on PubMed... (${done}/${total})`))) pmids.add(id);
    if (!pmids.size) return [];

    const articles = await RKG.pubmed.fetchArticles([...pmids], (done, total) =>
      showStatus(`${SPIN}[3/3] Loading MeSH from PubMed... (${done}/${total})`));

    const byDoi = new Map();
    const byTitleYear = new Map();
    for (const w of works) {
      if (w._doi) byDoi.set(w._doi, w);
      else if (w.title && w.publication_year) byTitleYear.set(`${_normTitle(w.title)}|${w.publication_year}`, w);
    }

    const medlineOnly = [];
    for (const [pmid, art] of articles) {
      const w = (art.doi && byDoi.get(art.doi))
        || (art.title && art.year && byTitleYear.get(`${_normTitle(art.title)}|${art.year}`));
      if (w) {
        w._pmid = pmid;
        if (art.mesh.length) w.mesh = art.mesh;
        w._sources.pubmed = true;
      } else if (orcidPmids.has(pmid) || (art.doi && orcidDois.has(art.doi))) {
        // Medline-indexed, absent from OpenAlex, confirmed by the author's own
        // ORCID record — high precision, so it bypasses the criteria filter.
        medlineOnly.push({
          id: 'pubmed:' + pmid,
          doi: art.doi ? 'https://doi.org/' + art.doi : null,
          _doi: art.doi,
          _pmid: pmid,
          title: art.title,
          publication_year: art.year,
          cited_by_count: 0,
          authorships: [],
          topics: [],
          concepts: [],
          primary_location: art.journal ? { source: { id: null, display_name: art.journal } } : null,
          mesh: art.mesh,
          _sources: { openalex: false, orcid: true, pubmed: true },
        });
      }
    }
    return medlineOnly;
  }

  // 3-stage works retrieval cascade (CLAUDE.md § "3-stage works retrieval pipeline"):
  // 1) ORCID registry (identity spine) → 2) OpenAlex (metadata engine, required core)
  // → 3) PubMed (MeSH + Medline recall). Stages 1 and 3 fail soft.
  async function _loadWorksAndActivate(author, idList) {
    const orcid = (author.orcid || '').replace(/^https?:\/\/orcid\.org\//, '') || null;

    // ---- Stage 1: ORCID registry ----
    let orcidEntries = [];
    if (orcid) {
      showStatus(`${SPIN}[1/3] Fetching works from the ORCID registry...`);
      try {
        orcidEntries = await RKG.api.fetchOrcidWorks(orcid);
      } catch (e) { console.warn('ORCID stage failed (continuing)', e); }
    }
    const orcidDois = new Set(orcidEntries.map(e => e.doi).filter(Boolean));

    // ---- Stage 2: OpenAlex ----
    const allWorks = [];
    const byId = new Map();
    const byDoi = new Map();
    const addWorks = list => {
      for (const w of list) {
        const doi = RKG.api.normalizeDoi(w.doi);
        if (byId.has(w.id) || (doi && byDoi.has(doi))) continue;
        w._doi = doi;
        w._sources = { openalex: true, orcid: !!(doi && orcidDois.has(doi)), pubmed: false };
        allWorks.push(w);
        byId.set(w.id, w);
        if (doi) byDoi.set(doi, w);
      }
    };
    const progress = c => showStatus(`${SPIN}[2/3] Loading works from OpenAlex... (${allWorks.length + c}${idList.length > 1 ? `, merging ${idList.length} IDs` : ''})`);
    for (const id of idList) {
      addWorks(await RKG.api.fetchAllWorks(id, progress));
    }
    if (orcid) {
      try {
        // Catch works under split author IDs not selected in the picker,
        // then hydrate ORCID-registry DOIs OpenAlex knows but didn't link to this author.
        addWorks(await RKG.api.fetchWorksByOrcid(orcid, progress));
        const missing = [...orcidDois].filter(d => !byDoi.has(d));
        if (missing.length) addWorks(await RKG.api.fetchWorksByDois(missing));
      } catch (e) { console.warn('OpenAlex ORCID pass failed (continuing)', e); }

      // The ORCID pass can surface works filed under split author IDs the user
      // didn't merge. Fold those IDs into _mergedIds so role detection, the
      // coauthor network (no-ego invariant), and criteria filtering all treat
      // them as the focal author.
      const focalIdSet = new Set(idList);
      for (const w of allWorks) {
        for (const a of (w.authorships || [])) {
          const aOrcid = a.author && a.author.orcid && a.author.orcid.replace(/^https?:\/\/orcid\.org\//, '');
          if (aOrcid === orcid && a.author.id) focalIdSet.add(a.author.id);
        }
      }
      if (focalIdSet.size > idList.length) {
        author._mergedIds = [...focalIdSet];
        RKG.state.setAuthor(author);
      }
    }

    const filteredWorks = RKG.api.filterWorksBySearchCriteria
      ? RKG.api.filterWorksBySearchCriteria(allWorks, author)
      : allWorks;
    if (allWorks.length && !filteredWorks.length) {
      throw new Error('Works were loaded, but none match the institution/specialty conditions you entered.');
    }

    // ---- Stage 3: PubMed (non-fatal) ----
    let finalWorks = filteredWorks;
    try {
      const medlineOnly = await _enrichFromPubmed(filteredWorks, orcid, orcidEntries, orcidDois);
      if (medlineOnly.length) finalWorks = [...filteredWorks, ...medlineOnly];
    } catch (e) { console.warn('PubMed stage failed (continuing)', e); }

    const sourceIds = new Set();
    for (const w of finalWorks) {
      const src = w.primary_location && w.primary_location.source && w.primary_location.source.id;
      if (src) sourceIds.add(src);
    }

    showStatus(`${SPIN}Fetching IF data for ${sourceIds.size} journals...`);
    const stats = await RKG.api.fetchSourceStats(sourceIds);

    RKG.state.setWorks(finalWorks);
    RKG.state.setSourceStats(stats);
    hideStatus();
    RKG.dashboard.activate();
  }

  async function selectAuthor(author) {
    $('#candidates-section').classList.add('hidden');
    showStatus(`<span class="loader" style="vertical-align:-2px;"></span> Loading works for ${author.display_name}...`);
    RKG.state.setAuthor(author);
    try {
      await _loadWorksAndActivate(author, [author.id]);
    } catch (e) {
      showStatus(`Data loading failed: ${e.message}`, 'error');
    }
  }

  async function mergeAndSelect(authors) {
    $('#candidates-section').classList.add('hidden');
    const merged = {
      id: 'merged:' + authors.map(a => a.id).join(','),
      display_name: authors[0].display_name + ` (${authors.length} IDs merged)`,
      _institutions: [...new Set(authors.flatMap(a => a._institutions))],
      _displayInstitutions: [...new Set(authors.flatMap(a => a._displayInstitutions || a._institutions))],
      _matchedInstitutions: [...new Set(authors.flatMap(a => a._matchedInstitutions || []))],
      _mergedIds: authors.map(a => a.id),
      works_count: authors.reduce((s, a) => s + (a.works_count || 0), 0),
      cited_by_count: authors.reduce((s, a) => s + (a.cited_by_count || 0), 0),
      orcid: (authors.find(a => a.orcid) || {}).orcid || null,
      _searchCriteria: authors[0]._searchCriteria || null,
    };
    showStatus(`<span class="loader" style="vertical-align:-2px;"></span> Loading works for ${merged.display_name}...`);
    RKG.state.setAuthor(merged);
    try {
      await _loadWorksAndActivate(merged, merged._mergedIds);
    } catch (e) {
      showStatus(`Data loading failed: ${e.message}`, 'error');
    }
  }

  return { init };
})();
