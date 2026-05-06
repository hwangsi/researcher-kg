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

  // Search authors by name, then locally filter by institution and specialty keyword match.
  async function searchAuthors(name, institution, specialty) {
    const data = await _fetch(`/authors?search=${encodeURIComponent(name)}&per-page=25`);
    const instLower = (institution || '').toLowerCase().trim();
    const instTokens = instLower.split(/\s+/).filter(t => t.length >= 3);
    const specLower = (specialty || '').toLowerCase().trim();
    const specTokens = specLower.split(/[\s,]+/).filter(t => t.length >= 3);

    return data.results
      .map(a => {
        const affs = (a.affiliations || [])
          .map(x => x.institution && x.institution.display_name)
          .filter(Boolean);
        const last = (a.last_known_institutions || []).map(x => x.display_name);
        const allInsts = [...new Set([...affs, ...last])];

        // Build a searchable string from x_concepts and topics fields
        const conceptNames = (a.x_concepts || []).map(c => c.display_name || '');
        const topicNames = (a.topics || []).flatMap(t => [
          t.display_name,
          t.subfield && t.subfield.display_name,
          t.field && t.field.display_name,
        ].filter(Boolean));
        const specialtyText = [...conceptNames, ...topicNames].join(' | ').toLowerCase();

        return { ...a, _institutions: allInsts, _specialtyText: specialtyText };
      })
      .filter(a => {
        const instOk = !instLower || instTokens.some(t => a._institutions.map(s => s.toLowerCase()).join(' | ').includes(t));
        const specOk = !specLower || specTokens.some(t => a._specialtyText.includes(t));
        return instOk && specOk;
      });
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
  // Returns: Map<sourceId, {display_name, host_org, if_2yr, h_index, works_count, issn_l}>.
  async function fetchSourceStats(sourceIds) {
    const stats = new Map();
    const ids = [...sourceIds].filter(Boolean);
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const filterIds = chunk.map(x => x.replace('https://openalex.org/', '')).join('|');
      try {
        const data = await _fetch(`/sources?filter=ids.openalex:${filterIds}&per-page=50`);
        for (const s of data.results) {
          stats.set(s.id, {
            display_name: s.display_name,
            host_org: s.host_organization_name || '',
            if_2yr: s.summary_stats && s.summary_stats['2yr_mean_citedness'] != null
              ? s.summary_stats['2yr_mean_citedness']
              : null,
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
