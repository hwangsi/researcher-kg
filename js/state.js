// Central state. All viz modules subscribe to changes.
// Mutations only via setters defined here. Direct access for reads is fine.

window.RKG = window.RKG || {};

RKG.state = (function() {
  'use strict';

  const _state = {
    author: null,           // selected author object from OpenAlex
    works: [],              // all works for selected author
    sourceStats: new Map(), // openalex source id -> {if_2yr, h_index, display_name, ...}

    // Filter state
    yearMin: null,
    yearMax: null,
    filteredYearMin: null,
    filteredYearMax: null,
    authorshipRole: 'all',     // 'all' | 'first' | 'senior' | 'middle'
    selectedCoauthor: null,    // author id to filter by, or null
    minCoauthorPapers: 2,      // for network threshold
  };

  const _listeners = new Set();

  function subscribe(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  }

  function emit() {
    _listeners.forEach(fn => {
      try { fn(_state); } catch (e) { console.error('listener error', e); }
    });
  }

  // ----- setters -----

  function setAuthor(author) {
    _state.author = author;
    _state.works = [];
    _state.sourceStats = new Map();
    _state.selectedCoauthor = null;
    _state.authorshipRole = 'all';
    emit();
  }

  function setWorks(works) {
    _state.works = works || [];
    if (_state.works.length) {
      const years = _state.works.map(w => w.publication_year).filter(Boolean);
      _state.yearMin = Math.min(...years);
      // Always extend upper bound to the current year so recent papers are never cut off.
      _state.yearMax = Math.max(Math.max(...years), new Date().getFullYear());
      _state.filteredYearMin = _state.yearMin;
      _state.filteredYearMax = _state.yearMax;
    }
    emit();
  }

  function setSourceStats(stats) {
    _state.sourceStats = stats || new Map();
    emit();
  }

  function setYearRange(lo, hi) {
    if (lo > hi) [lo, hi] = [hi, lo];
    _state.filteredYearMin = lo;
    _state.filteredYearMax = hi;
    emit();
  }

  function setAuthorshipRole(role) {
    _state.authorshipRole = role;
    emit();
  }

  function setSelectedCoauthor(id) {
    _state.selectedCoauthor = id;
    emit();
  }

  function setMinCoauthorPapers(n) {
    _state.minCoauthorPapers = n;
    emit();
  }

  function reset() {
    _state.author = null;
    _state.works = [];
    _state.sourceStats = new Map();
    _state.selectedCoauthor = null;
    _state.authorshipRole = 'all';
    emit();
  }

  // ----- selectors -----

  // Determine focal author's role in a paper.
  // Returns 'first' | 'senior' | 'middle' | 'none'
  function getAuthorshipRole(work) {
    if (!_state.author) return 'none';
    const focalIds = _state.author._mergedIds || [_state.author.id];
    const auths = work.authorships || [];
    const idx = auths.findIndex(a => a.author && focalIds.includes(a.author.id));
    if (idx === -1) return 'none';
    if (auths.length === 1) return 'first';
    if (idx === 0) return 'first';
    if (idx === auths.length - 1) return 'senior';
    return 'middle';
  }

  // Returns works after applying ALL active filters.
  function getFilteredWorks() {
    return _state.works.filter(w => {
      const y = w.publication_year;
      if (!y || y < _state.filteredYearMin || y > _state.filteredYearMax) return false;

      if (_state.authorshipRole !== 'all') {
        if (getAuthorshipRole(w) !== _state.authorshipRole) return false;
      }

      if (_state.selectedCoauthor) {
        const has = (w.authorships || []).some(a => a.author && a.author.id === _state.selectedCoauthor);
        if (!has) return false;
      }

      return true;
    });
  }

  // Primary topic for a work (display name string, or null).
  function getPrimaryTopic(work) {
    const topics = (work.topics && work.topics.length) ? work.topics : (work.concepts || []);
    return topics[0] ? topics[0].display_name : null;
  }

  // Get raw state object (read-only — DO NOT MUTATE).
  function get() { return _state; }

  return {
    subscribe,
    setAuthor, setWorks, setSourceStats,
    setYearRange, setAuthorshipRole, setSelectedCoauthor, setMinCoauthorPapers,
    reset,
    getAuthorshipRole, getFilteredWorks, getPrimaryTopic,
    get,
  };
})();
