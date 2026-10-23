'use strict';
// Website compatibility fixes.
//
// Google refuses sign-in ("This browser or app may not be secure") from
// Chromium builds it doesn't recognise, treating them as apps with an embedded
// browser. On Google's sign-in pages Imp therefore presents itself as Firefox,
// a browser Google supports, so signing in works normally. Every other site
// sees the regular Chromium identity.

const GOOGLE_AUTH = /^accounts\.(google\.[a-z.]+|youtube\.com)$/i;
const DAY = 24 * 60 * 60 * 1000;

function isGoogleAuthHost(host) {
  return GOOGLE_AUTH.test(host || '');
}

// Firefox 136 shipped on 2025-03-04 and a new major version follows every four
// weeks. Stay one version behind the estimate so we never claim a future release.
function firefoxVersion(now = Date.now()) {
  const sinceBase = now - Date.UTC(2025, 2, 4);
  return 136 + Math.max(0, Math.floor(sinceBase / (28 * DAY)) - 1);
}

function firefoxUA() {
  const v = firefoxVersion();
  const platform = {
    win32: 'Windows NT 10.0; Win64; x64',
    darwin: 'Macintosh; Intel Mac OS X 10.15',
  }[process.platform] || 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`;
}

// Rewrites request headers in place for requests made on Google's sign-in pages.
function applyGoogleAuthHeaders(headers) {
  for (const k of Object.keys(headers)) {
    if (/^user-agent$/i.test(k) || /^sec-ch-ua/i.test(k)) delete headers[k];
  }
  headers['User-Agent'] = firefoxUA();
}

module.exports = { isGoogleAuthHost, firefoxUA, applyGoogleAuthHeaders };
