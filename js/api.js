// OpenAlex API wrapper. All requests go through polite pool.
// Replace POLITE_EMAIL with your email for better rate limits.

window.RKG = window.RKG || {};

RKG.api = (function() {
  'use strict';

  const POLITE_EMAIL = 'researcher-kg@example.com';
  const BASE = 'https://api.openalex.org';

  async function _fetch(path) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${BASE}${path}${sep}mailto=${encodeURIComponent(POLITE_EMAIL)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`OpenAlex ${res.status}: ${path}`);
    }
    return res.json();
  }

  // Search authors by name AND institution (server-side AND filter via OpenAlex institution IDs).
  // Falls back to local AND-token filter if institution lookup fails.
  async function searchAuthors(name, institution, specialty, koreaOnly) {
    const instKeyword = (institution || '').trim();
    const specLower  = (specialty  || '').toLowerCase().trim();
    const specTokens = specLower.split(/[\s,]+/).filter(t => t.length >= 3);

    // ── Step 1: Resolve institution → OpenAlex IDs (enables server-side AND) ──
    let extraFilters = [];   // filter clauses to AND together
    let resolvedInst = [];   // display names for UI feedback

    if (koreaOnly) {
      extraFilters.push('affiliations.institution.country_code:KR');
    }

    if (instKeyword.length >= 3) {
      try {
        const idata = await _fetch(
          `/institutions?search=${encodeURIComponent(instKeyword)}&per-page=5&select=id,display_name`
        );
        const hits = (idata.results || []).slice(0, 4);
        if (hits.length) {
          // pipe = OR between institution IDs; combined with name search = AND
          extraFilters.push(`affiliations.institution.id:${hits.map(h => h.id).join('|')}`);
          resolvedInst = hits.map(h => h.display_name);
        }
      } catch (_) { /* institution lookup failed; local fallback below */ }
    }

    const instFilter = extraFilters.length ? `&filter=${extraFilters.join(',')}` : '';

    // ── Step 2: Author search (name × institution AND on server) ──
    const perPage = instFilter ? 50 : 25;
    const data = await _fetch(
      `/authors?search=${encodeURIComponent(name)}${instFilter}&per-page=${perPage}`
    );

    // ── Step 3: Normalize ──
    const results = (data.results || []).map(a => {
      const affs = (a.affiliations || [])
        .map(x => x.institution && x.institution.display_name).filter(Boolean);
      const last = (a.last_known_institutions || []).map(x => x.display_name);
      const allInsts = [...new Set([...affs, ...last])];

      const conceptNames = (a.x_concepts || []).map(c => c.display_name || '');
      const topicNames   = (a.topics    || []).flatMap(t => [
        t.display_name,
        t.subfield && t.subfield.display_name,
        t.field    && t.field.display_name,
      ].filter(Boolean));
      const specialtyText = [...conceptNames, ...topicNames].join(' | ').toLowerCase();

      return { ...a, _institutions: allInsts, _specialtyText: specialtyText };
    });

    // ── Step 4: Local filters ──
    // Institution: only needed as fallback when server-side filter wasn't applied.
    // Uses ALL-token (AND) logic — stricter than the old OR approach.
    const instLower  = instKeyword.toLowerCase();
    const instTokens = instLower.split(/\s+/).filter(t => t.length >= 3);

    const filtered = results.filter(a => {
      if (instTokens.length && !resolvedInst.length) {
        // Fallback: every token must appear in at least one institution string
        const joined = a._institutions.map(s => s.toLowerCase()).join(' | ');
        if (!instTokens.every(t => joined.includes(t))) return false;
      }
      if (specTokens.length) {
        if (!specTokens.some(t => a._specialtyText.includes(t))) return false;
      }
      return true;
    });

    // Attach resolved institution names so search.js can show feedback
    filtered._resolvedInst = resolvedInst;
    return filtered;
  }

  // Cursor-paginated fetch of all works for an author.
  // Sort is intentionally omitted — sorting by a non-unique field like publication_year
  // causes non-deterministic cursor pagination (records skipped at page boundaries).
  // Default sort (by ID) is stable and ensures complete retrieval.
  // onProgress(count) called each page.
  const WORK_SELECT = [
    'id', 'doi', 'title', 'publication_year',
    'cited_by_count', 'primary_location',
    'authorships', 'topics', 'concepts',
  ].join(',');

  async function fetchAllWorks(authorId, onProgress) {
    const works = [];
    let cursor = '*';
    let safety = 0;
    while (cursor && safety < 100) {
      const data = await _fetch(
        `/works?filter=author.id:${authorId}&per-page=200&cursor=${encodeURIComponent(cursor)}&select=${WORK_SELECT}`
      );
      works.push(...data.results);
      if (onProgress) onProgress(works.length);
      cursor = data.meta && data.meta.next_cursor;
      if (!cursor) break;
      safety++;
    }
    return works;
  }

  // Batch fetch source (journal) details for IF info.
  // Input: iterable of OpenAlex source IDs (full URLs).
  // Returns: Map<sourceId, {display_name, host_org, if_2yr, if_source, h_index, works_count, issn_l}>.
  // if_source: 'JCR' when from JCR 2025 data, 'OA' when from OpenAlex 2yr citedness.
  async function fetchSourceStats(sourceIds) {
    const jcr = window.RKG && window.RKG.jcrData;
    const stats = new Map();
    const ids = [...sourceIds].filter(Boolean);
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const filterIds = chunk.map(x => x.replace('https://openalex.org/', '')).join('|');
      try {
        const data = await _fetch(`/sources?filter=ids.openalex:${filterIds}&per-page=50`);
        for (const s of data.results) {
          // Try JCR lookup: check issn_l then all ISSNs from OpenAlex
          let if_2yr = null;
          let if_source = 'OA';
          if (jcr) {
            const issns = [s.issn_l, ...(s.issn || [])].filter(Boolean);
            for (const issn of issns) {
              if (jcr[issn] != null) {
                if_2yr = jcr[issn];
                if_source = 'JCR';
                break;
              }
            }
          }
          // Fall back to OpenAlex 2yr mean citedness
          if (if_2yr === null && s.summary_stats && s.summary_stats['2yr_mean_citedness'] != null) {
            if_2yr = s.summary_stats['2yr_mean_citedness'];
          }
          stats.set(s.id, {
            display_name: s.display_name,
            host_org: s.host_organization_name || '',
            if_2yr,
            if_source,
            h_index: s.summary_stats ? s.summary_stats.h_index : null,
            works_count: s.works_count,
            issn_l: s.issn_l,
          });
        }
      } catch (e) {
        console.warn('source fetch failed for chunk', e);
      }
    }
    return stats;
  }

  async function searchByOrcid(orcid) {
    const clean = orcid.trim().replace(/^https?:\/\/orcid\.org\//, '');
    if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(clean)) {
      throw new Error('ORCID 형식이 올바르지 않습니다 (예: 0000-0002-9574-5069)');
    }
    const data = await _fetch(`/authors?filter=orcid:${encodeURIComponent(clean)}&per-page=5`);
    return data.results.map(a => {
      const affs = (a.affiliations || []).map(x => x.institution && x.institution.display_name).filter(Boolean);
      const last = (a.last_known_institutions || []).map(x => x.display_name);
      return { ...a, _institutions: [...new Set([...affs, ...last])] };
    });
  }

  return { searchAuthors, searchByOrcid, fetchAllWorks, fetchSourceStats };
})();
