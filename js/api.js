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

  // Search authors by name, then locally filter by institution keyword match.
  async function searchAuthors(name, institution) {
    const data = await _fetch(`/authors?search=${encodeURIComponent(name)}&per-page=25`);
    const instLower = (institution || '').toLowerCase().trim();
    const tokens = instLower.split(/\s+/).filter(t => t.length >= 3);

    return data.results
      .map(a => {
        const affs = (a.affiliations || [])
          .map(x => x.institution && x.institution.display_name)
          .filter(Boolean);
        const last = (a.last_known_institutions || []).map(x => x.display_name);
        const allInsts = [...new Set([...affs, ...last])];
        return { ...a, _institutions: allInsts };
      })
      .filter(a => {
        if (!instLower) return true;
        const allLower = a._institutions.map(s => s.toLowerCase()).join(' | ');
        return tokens.some(t => allLower.includes(t));
      });
  }

  // Cursor-paginated fetch of all works for an author.
  // onProgress(count) called each page.
  async function fetchAllWorks(authorId, onProgress) {
    const works = [];
    let cursor = '*';
    let safety = 0;
    while (cursor && safety < 50) {
      const data = await _fetch(
        `/works?filter=author.id:${authorId}&per-page=200&cursor=${encodeURIComponent(cursor)}&sort=publication_year:desc`
      );
      works.push(...data.results);
      if (onProgress) onProgress(works.length);
      cursor = data.meta.next_cursor;
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

  return { searchAuthors, fetchAllWorks, fetchSourceStats };
})();
