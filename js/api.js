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

  function _normalizeOrcid(orcid) {
    const clean = (orcid || '').trim().replace(/^https?:\/\/orcid\.org\//, '');
    if (!clean) return '';
    if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(clean)) {
      throw new Error('ORCID 형식이 올바르지 않습니다 (예: 0000-0002-9574-5069)');
    }
    return clean;
  }

  function _tokens(text) {
    return (text || '').toLowerCase().trim().split(/[\s,;|/]+/).filter(t => t.length >= 3);
  }

  const SPECIALTY_ALIASES = {
    radiology: [
      'radiology', 'radiologic', 'radiological', 'radiography',
      'medical imaging', 'diagnostic imaging',
      'mri', 'ct', 'computed tomography',
      'ultrasound', 'sonography', 'x-ray', 'xray',
      'interventional radiology', 'neuroradiology',
    ],
  };

  const RADIOLOGY_SOURCE_RE = /\b(radiolog\w*|roentgen\w*|medical imaging|clinical imaging|magnetic resonance imaging|nuclear medicine|ultrasound in medicine|computer assisted tomography|imaging and radiation oncology)\b/i;
  const RADIOLOGY_TOPIC_RE = /\b(radiolog\w*|radiography|diagnostic imaging|medical imaging|magnetic resonance imaging|computed tomography|ultrasonography|sonography|x-ray|roentgen\w*|nuclear medicine|interventional radiology|neuroradiology)\b/i;
  const RADIOLOGY_TITLE_RE = /\b(radiolog\w*|radiographic|radiologic|computed tomography|ultrasonography|sonography|x-ray|roentgen\w*|magnetic resonance imaging|mri|ct)\b/i;
  const NON_RADIOLOGY_SOURCE_RE = /\b(polymer|macromolecular|chemical communications|analytical chemistry|chromatography|bulletin of the korean chemical society|ecs meeting abstracts)\b/i;

  function _normText(text) {
    return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function _normalizeAuthor(a) {
    const affRecords = (a.affiliations || [])
      .map(x => x.institution)
      .filter(x => x && x.display_name)
      .map(x => ({ id: x.id || '', display_name: x.display_name }));
    const lastRecords = (a.last_known_institutions || [])
      .filter(x => x && x.display_name)
      .map(x => ({ id: x.id || '', display_name: x.display_name }));
    const recordMap = new Map();
    for (const rec of [...affRecords, ...lastRecords]) {
      const key = rec.id || rec.display_name;
      if (!recordMap.has(key)) recordMap.set(key, rec);
    }
    const institutionRecords = [...recordMap.values()];
    const allInsts = institutionRecords.map(x => x.display_name);
    const allInstIds = institutionRecords.map(x => x.id).filter(Boolean);

    const conceptNames = (a.x_concepts || []).map(c => c.display_name || '');
    const topicNames = (a.topics || []).flatMap(t => [
      t.display_name,
      t.subfield && t.subfield.display_name,
      t.field && t.field.display_name,
      t.domain && t.domain.display_name,
    ].filter(Boolean));
    const specialtyText = [...conceptNames, ...topicNames].join(' | ').toLowerCase();

    return {
      ...a,
      _institutions: allInsts,
      _institutionIds: allInstIds,
      _institutionRecords: institutionRecords,
      _displayInstitutions: allInsts,
      _specialtyText: specialtyText,
    };
  }

  async function _resolveInstitution(keyword) {
    const instKeyword = (keyword || '').trim();
    if (instKeyword.length < 3) return [];
    try {
      const idata = await _fetch(
        `/institutions?search=${encodeURIComponent(instKeyword)}&per-page=5&select=id,display_name`
      );
      return (idata.results || []).slice(0, 4);
    } catch (_) {
      return [];
    }
  }

  async function _fetchCandidateAuthors(criteria, resolvedInst) {
    const filters = [];
    if (criteria.koreaOnly) {
      filters.push('affiliations.institution.country_code:KR');
    }
    if (criteria.orcid) {
      filters.push(`orcid:${encodeURIComponent(criteria.orcid)}`);
    }
    if (resolvedInst.length) {
      filters.push(`affiliations.institution.id:${resolvedInst.map(h => h.id).join('|')}`);
    }

    const filterParam = filters.length ? `&filter=${filters.join(',')}` : '';
    const perPage = filterParam ? 50 : 25;
    const searchParam = criteria.name ? `search=${encodeURIComponent(criteria.name)}&` : '';
    const data = await _fetch(`/authors?${searchParam}per-page=${perPage}${filterParam}`);
    return data.results || [];
  }

  function _matchesCriteria(author, criteria, includeSpecialty) {
    if (criteria.orcid) {
      const authorOrcid = _normalizeOrcid(author.orcid || '');
      if (authorOrcid !== criteria.orcid) return false;
    }

    if (criteria.name) {
      const nameTokens = _tokens(criteria.name);
      const display = _normText(author.display_name);
      if (nameTokens.length && !nameTokens.every(t => display.includes(t))) return false;
    }

    if (criteria.instTokens.length) {
      const joined = author._institutions.map(s => s.toLowerCase()).join(' | ');
      const idMatched = criteria.resolvedInstIds.some(id => (author._institutionIds || []).includes(id));
      const tokenMatched = criteria.instTokens.every(t => joined.includes(t));
      if (!idMatched && !tokenMatched) return false;
    }

    if (includeSpecialty && criteria.specTokens.length) {
      if (!criteria.specTokens.every(t => author._specialtyText.includes(t))) return false;
    }

    return true;
  }

  function _withMatchedInstitutions(author, criteria) {
    if (!criteria.instTokens.length) {
      return { ...author, _matchedInstitutions: [], _displayInstitutions: author._institutions };
    }

    const matched = [];
    for (const rec of author._institutionRecords || []) {
      const text = _normText(rec.display_name);
      const idMatched = rec.id && criteria.resolvedInstIds.includes(rec.id);
      const tokenMatched = criteria.instTokens.every(t => text.includes(t));
      if (idMatched || tokenMatched) matched.push(rec.display_name);
    }

    const uniqueMatched = [...new Set(matched)];
    return {
      ...author,
      _matchedInstitutions: uniqueMatched,
      _displayInstitutions: uniqueMatched.length ? uniqueMatched : author._institutions,
    };
  }

  function _institutionTokenSet(author) {
    const text = (author._institutions || []).join(' ');
    return new Set(_tokens(text));
  }

  function _dedupeAndGroup(authors) {
    const byId = new Map();
    for (const author of authors) {
      if (!byId.has(author.id)) byId.set(author.id, author);
    }

    const unique = [...byId.values()];
    const byName = new Map();
    const byOrcid = new Map();
    for (const author of unique) {
      const nameKey = _normText(author.display_name);
      if (!byName.has(nameKey)) byName.set(nameKey, []);
      byName.get(nameKey).push(author);

      if (author.orcid) {
        const orcidKey = _normalizeOrcid(author.orcid);
        if (!byOrcid.has(orcidKey)) byOrcid.set(orcidKey, []);
        byOrcid.get(orcidKey).push(author);
      }
    }

    const enriched = unique.map(author => {
      const possible = new Set();
      const sameName = byName.get(_normText(author.display_name)) || [];
      const instTokens = _institutionTokenSet(author);

      for (const other of sameName) {
        if (other.id === author.id) continue;
        const otherInstTokens = _institutionTokenSet(other);
        const hasSharedInst = [...instTokens].some(t => otherInstTokens.has(t));
        if (hasSharedInst || !instTokens.size || !otherInstTokens.size) possible.add(other.id);
      }

      if (author.orcid) {
        const sameOrcid = byOrcid.get(_normalizeOrcid(author.orcid)) || [];
        for (const other of sameOrcid) {
          if (other.id !== author.id) possible.add(other.id);
        }
      }

      const ids = [author.id, ...possible];
      return {
        ...author,
        _duplicateGroupIds: ids.length > 1 ? ids : [],
      };
    });

    enriched.sort((a, b) => {
      const dupA = a._duplicateGroupIds.length ? 0 : 1;
      const dupB = b._duplicateGroupIds.length ? 0 : 1;
      if (dupA !== dupB) return dupA - dupB;
      return (b.works_count || 0) - (a.works_count || 0);
    });

    return enriched;
  }

  function _specialtyGroups(criteria) {
    return criteria.specTokens.map(token => SPECIALTY_ALIASES[token] || [token]);
  }

  function _workText(work) {
    const source = work.primary_location && work.primary_location.source;
    const sourceName = source && source.display_name;
    const topicNames = (work.topics || []).flatMap(t => [
      t.display_name,
      t.subfield && t.subfield.display_name,
      t.field && t.field.display_name,
      t.domain && t.domain.display_name,
    ].filter(Boolean));
    const conceptNames = (work.concepts || []).map(c => c.display_name || '');
    return _normText([work.title, sourceName, ...topicNames, ...conceptNames].join(' | '));
  }

  function _workSourceName(work) {
    const source = work.primary_location && work.primary_location.source;
    return (source && source.display_name) || '';
  }

  function _workTopicText(work) {
    const topicNames = (work.topics || []).flatMap(t => [
      t.display_name,
      t.subfield && t.subfield.display_name,
      t.field && t.field.display_name,
      t.domain && t.domain.display_name,
    ].filter(Boolean));
    const conceptNames = (work.concepts || []).map(c => c.display_name || '');
    return [...topicNames, ...conceptNames].join(' | ');
  }

  function _workAuthorInstitutionText(work, focalIds) {
    const auths = work.authorships || [];
    const parts = [];
    for (const authorship of auths) {
      const authorId = authorship.author && authorship.author.id;
      if (!focalIds.includes(authorId)) continue;
      for (const inst of authorship.institutions || []) {
        if (inst.display_name) parts.push(inst.display_name);
      }
      for (const raw of authorship.raw_affiliation_strings || []) {
        if (raw) parts.push(raw);
      }
    }
    return _normText(parts.join(' | '));
  }

  function _workAuthorInstitutionIds(work, focalIds) {
    const auths = work.authorships || [];
    const ids = [];
    for (const authorship of auths) {
      const authorId = authorship.author && authorship.author.id;
      if (!focalIds.includes(authorId)) continue;
      for (const inst of authorship.institutions || []) {
        if (inst.id) ids.push(inst.id);
      }
    }
    return ids;
  }

  function _workMatchesInstitution(work, focalIds, criteria) {
    if (!criteria || !criteria.instTokens || !criteria.instTokens.length) return true;
    const instText = _workAuthorInstitutionText(work, focalIds);
    const instIds = _workAuthorInstitutionIds(work, focalIds);
    const idMatched = criteria.resolvedInstIds.some(id => instIds.includes(id));
    const tokenMatched = criteria.instTokens.every(t => instText.includes(t));
    return idMatched || tokenMatched;
  }

  function _matchesRadiologyWork(work) {
    const sourceName = _workSourceName(work);
    if (NON_RADIOLOGY_SOURCE_RE.test(sourceName)) return false;
    if (RADIOLOGY_SOURCE_RE.test(sourceName)) return true;
    if (RADIOLOGY_TOPIC_RE.test(_workTopicText(work))) return true;
    return RADIOLOGY_TITLE_RE.test(work.title || '');
  }

  function _matchesRadiologyWorkForAuthor(work, focalIds) {
    if (_matchesRadiologyWork(work)) return true;
    return RADIOLOGY_TOPIC_RE.test(_workAuthorInstitutionText(work, focalIds));
  }

  function _matchesSpecialtyWork(work, groups, criteria) {
    if (criteria && criteria.specTokens.includes('radiology')) {
      if (!_matchesRadiologyWork(work)) return false;
      const otherGroups = groups.filter((_, i) => criteria.specTokens[i] !== 'radiology');
      if (!otherGroups.length) return true;
      const text = _workText(work);
      return otherGroups.every(group => group.some(term => text.includes(term)));
    }

    const text = _workText(work);
    return groups.every(group => group.some(term => text.includes(term)));
  }

  function filterWorksBySearchCriteria(works, author) {
    const criteria = author && author._searchCriteria;
    if (!criteria) return works || [];

    const focalIds = author._mergedIds || [author.id];
    const groups = criteria.specTokens && criteria.specTokens.length ? _specialtyGroups(criteria) : [];

    return (works || []).filter(work => {
      if (!_workMatchesInstitution(work, focalIds, criteria)) return false;
      if (groups.length && criteria.specTokens.includes('radiology') && !_matchesRadiologyWorkForAuthor(work, focalIds)) return false;
      if (groups.length && !criteria.specTokens.includes('radiology') && !_matchesSpecialtyWork(work, groups, criteria)) return false;
      return true;
    });
  }

  async function _fetchWorksSample(authorId) {
    const data = await _fetch(
      `/works?filter=author.id:${authorId}&per-page=50&sort=cited_by_count:desc&select=${WORK_SELECT}`
    );
    return data.results || [];
  }

  function _passesSpecialtyEvidence(sampleSize, matchedCount) {
    if (!sampleSize) return false;
    if (sampleSize < 5) return matchedCount >= 1;
    if (sampleSize < 20) return matchedCount >= 2;
    return matchedCount >= 3 && (matchedCount / sampleSize) >= 0.12;
  }

  async function _filterByWorkSpecialty(authors, criteria) {
    if (!criteria.specTokens.length) return authors;

    const groups = _specialtyGroups(criteria);
    const checked = [];
    for (const author of authors) {
      let works = [];
      try {
        works = await _fetchWorksSample(author.id);
      } catch (_) {
        works = [];
      }
      const matched = works.filter(w => _matchesSpecialtyWork(w, groups, criteria));
      const sampleSize = works.length;
      const matchedCount = matched.length;
      if (_passesSpecialtyEvidence(sampleSize, matchedCount)) {
        checked.push({
          ...author,
          _specialtyEvidence: {
            sampleSize,
            matchedCount,
            ratio: sampleSize ? matchedCount / sampleSize : 0,
            examples: matched.slice(0, 3).map(w => w.title).filter(Boolean),
          },
        });
      }
    }

    checked.sort((a, b) => {
      const ar = a._specialtyEvidence ? a._specialtyEvidence.ratio : 0;
      const br = b._specialtyEvidence ? b._specialtyEvidence.ratio : 0;
      if (br !== ar) return br - ar;
      return (b.works_count || 0) - (a.works_count || 0);
    });

    return checked;
  }

  // Unified author search. Every provided criterion is applied as an AND condition.
  async function searchAuthors(input) {
    const criteria = {
      name: (input && input.name || '').trim(),
      institution: (input && input.institution || '').trim(),
      specialty: (input && input.specialty || '').trim(),
      orcid: _normalizeOrcid(input && input.orcid),
      koreaOnly: !!(input && input.koreaOnly),
    };
    criteria.instTokens = _tokens(criteria.institution);
    criteria.specTokens = _tokens(criteria.specialty);

    if (!criteria.orcid && !criteria.name && !criteria.institution && !criteria.specialty) {
      throw new Error('저자 이름, ORCID, 소속, 전문 분야 중 하나 이상을 입력하세요.');
    }

    const resolvedInst = await _resolveInstitution(criteria.institution);
    criteria.resolvedInstIds = resolvedInst.map(h => h.id);
    const raw = await _fetchCandidateAuthors(criteria, resolvedInst);
    const normalized = raw.map(_normalizeAuthor);
    const baseFiltered = normalized
      .filter(author => _matchesCriteria(author, criteria, false))
      .map(author => _withMatchedInstitutions(author, criteria));
    const specialtyFiltered = await _filterByWorkSpecialty(baseFiltered, criteria);
    const grouped = _dedupeAndGroup(specialtyFiltered);
    grouped.forEach(author => { author._searchCriteria = criteria; });

    grouped._resolvedInst = resolvedInst.map(h => h.display_name);
    grouped._criteria = criteria;
    return grouped;
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

  return { searchAuthors, searchByOrcid, fetchAllWorks, fetchSourceStats, filterWorksBySearchCriteria };
})();
