// Helpers for putting external data into HTML. Text from OpenAlex, ORCID and PubMed is
// third-party input, and script injected through it could read the API key saved in this
// browser, so escape it before any innerHTML and check URLs before using them as links.

window.RKG = window.RKG || {};

RKG.util = (function() {
  'use strict';

  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  // Safe in HTML text and in quoted attribute values.
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
  }

  // Returns http(s) URLs unchanged; anything else (javascript:, data:) becomes '#'.
  function safeUrl(url) {
    const clean = String(url == null ? '' : url).trim();
    return /^https?:\/\//i.test(clean) ? clean : '#';
  }

  return { escapeHtml, safeUrl };
})();
