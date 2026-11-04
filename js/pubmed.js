// PubMed E-utilities wrapper — Stage 3 of the works retrieval pipeline.
// MeSH enrichment + Medline recall. NEVER searches by name alone (Korean-name
// disambiguation risk): every lookup is keyed on ORCID or DOIs from earlier stages.

window.RKG = window.RKG || {};

RKG.pubmed = (function() {
  'use strict';

  const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const MIN_INTERVAL_MS = 400; // keyless E-utilities limit: 3 req/s, with margin for network jitter
  const RETRY_DELAYS_MS = [2000, 4000]; // NCBI's 429 asks for Retry-After: 2
  let _lastCall = 0;
  let _retriesExhausted = false;

  const _sleep = ms => new Promise(r => setTimeout(r, ms));

  async function _pacedFetch(url) {
    const wait = _lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await _sleep(wait);
    _lastCall = Date.now();
    return fetch(url);
  }

  // NCBI's 429 has no CORS header, so the browser reports it as a failed fetch with no
  // status to read. Failed fetches, 429s and 5xxs are retried. Once a request runs out of
  // retries, later requests get none until one succeeds, so an outage fails fast instead
  // of stalling on every batch.
  async function _throttledFetch(url) {
    const delays = _retriesExhausted ? [] : RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt++) {
      let res = null;
      let failure = null;
      try {
        res = await _pacedFetch(url);
      } catch (e) {
        failure = e;
      }
      if (res && res.ok) {
        _retriesExhausted = false;
        return res;
      }
      if (res) failure = new Error(`PubMed ${res.status}`);
      if (res && res.status !== 429 && res.status < 500) throw failure;
      if (attempt >= delays.length) {
        _retriesExhausted = true;
        throw failure;
      }
      await _sleep(delays[attempt]);
    }
  }

  // ORCID → PMIDs via [auid] indexed field.
  async function pmidsByOrcid(orcid) {
    const clean = (orcid || '').trim().replace(/^https?:\/\/orcid\.org\//, '');
    if (!clean) return [];
    const res = await _throttledFetch(
      `${BASE}/esearch.fcgi?db=pubmed&retmax=3000&retmode=json&term=${encodeURIComponent(clean + '[auid]')}`
    );
    const data = await res.json();
    return (data.esearchresult && data.esearchresult.idlist) || [];
  }

  // DOIs → PMIDs via chunked OR queries. Returns combined PMID list;
  // per-paper attribution happens later in fetchArticles (DOI read from XML).
  // The returned array carries _failedBatches: chunks that failed after retries.
  async function pmidsByDois(dois, onProgress) {
    const clean = [...new Set((dois || []).filter(Boolean))];
    const pmids = new Set();
    let failedBatches = 0;
    for (let i = 0; i < clean.length; i += 40) {
      const chunk = clean.slice(i, i + 40);
      const term = chunk.map(d => `"${d}"[doi]`).join(' OR ');
      try {
        const res = await _throttledFetch(
          `${BASE}/esearch.fcgi?db=pubmed&retmax=200&retmode=json&term=${encodeURIComponent(term)}`
        );
        const data = await res.json();
        for (const id of (data.esearchresult && data.esearchresult.idlist) || []) pmids.add(id);
      } catch (e) {
        failedBatches++;
        console.warn('PubMed DOI chunk search failed', e);
      }
      if (onProgress) onProgress(Math.min(i + 40, clean.length), clean.length);
    }
    const result = [...pmids];
    result._failedBatches = failedBatches;
    return result;
  }

  // PMIDs → Map<pmid, {doi, mesh, title, year, journal}> via efetch XML.
  // The returned Map carries _failedBatches: chunks that failed after retries.
  async function fetchArticles(pmids, onProgress) {
    const articles = new Map();
    articles._failedBatches = 0;
    const ids = [...new Set((pmids || []).filter(Boolean))];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      try {
        const res = await _throttledFetch(
          `${BASE}/efetch.fcgi?db=pubmed&retmode=xml&id=${chunk.join(',')}`
        );
        const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
        for (const art of xml.querySelectorAll('PubmedArticle')) {
          const pmid = art.querySelector('MedlineCitation > PMID');
          if (!pmid) continue;
          const doiEl = [...art.querySelectorAll('PubmedData ArticleIdList ArticleId')]
            .find(el => el.getAttribute('IdType') === 'doi');
          const mesh = [...art.querySelectorAll('MeshHeadingList MeshHeading DescriptorName')]
            .map(el => el.textContent.trim()).filter(Boolean);
          const titleEl = art.querySelector('Article > ArticleTitle');
          const yearEl = art.querySelector('Article JournalIssue PubDate Year');
          const medlineDateEl = art.querySelector('Article JournalIssue PubDate MedlineDate');
          const yearFromMedline = medlineDateEl && (medlineDateEl.textContent.match(/\d{4}/) || [])[0];
          const journalEl = art.querySelector('Article > Journal > Title');
          articles.set(pmid.textContent.trim(), {
            doi: RKG.api.normalizeDoi(doiEl ? doiEl.textContent : ''),
            mesh,
            title: titleEl ? titleEl.textContent.trim() : null,
            year: yearEl ? +yearEl.textContent : (yearFromMedline ? +yearFromMedline : null),
            journal: journalEl ? journalEl.textContent.trim() : null,
          });
        }
      } catch (e) {
        articles._failedBatches++;
        console.warn('PubMed efetch chunk failed', e);
      }
      if (onProgress) onProgress(Math.min(i + 200, ids.length), ids.length);
    }
    return articles;
  }

  return { pmidsByOrcid, pmidsByDois, fetchArticles };
})();
