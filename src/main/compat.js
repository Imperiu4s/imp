'use strict';
// Website compatibility: making Imp look exactly like the Chromium browser it is.
//
// Electron leaves out a few things every Chromium-based browser has. Sign-in
// pages, Google's above all, treat a "Chrome" that lacks them as an app with
// an embedded browser and refuse to sign in ("This browser or app may not be
// secure"). The missing pieces:
//  - the Sec-CH-UA client hints on page loads (Electron only sends them with
//    subresource requests): added here, for https pages;
//  - window.chrome.app / csi / loadTimes: added by the page preload;
//  - FedCM, which Electron advertises but cannot carry out, so "Sign in with
//    Google" buttons wait forever: switched off in main.js.
// (Imp 1.0.1–1.0.3 posed as Firefox on Google's sign-in pages instead; Google
// sees through that.)

const PLATFORM = { win32: 'Windows', darwin: 'macOS' }[process.platform] || 'Linux';

// Chromium's brand list for this version, GREASE brand included
// (components/embedder_support/user_agent_utils.cc). Only used until a real
// subresource request shows the exact header Chromium sends.
function computedHints() {
  const seed = Number(process.versions.chrome.split('.')[0]);
  const chars = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
  const grease = `"Not${chars[seed % chars.length]}A${chars[(seed + 1) % chars.length]}Brand";v="${['8', '99', '24'][seed % 3]}"`;
  const chromium = `"Chromium";v="${seed}"`;
  return {
    'sec-ch-ua': (seed % 2 ? [chromium, grease] : [grease, chromium]).join(', '),
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': `"${PLATFORM}"`,
  };
}

let hints = null;
let observed = false;

// Called for every request: page loads get the same client hints as the
// requests Chromium sends itself.
function addClientHints(details, headers) {
  const names = Object.keys(headers);
  const ua = names.find((k) => k.toLowerCase() === 'sec-ch-ua');
  if (ua) {
    if (!observed) {
      observed = true;
      const get = (n) => headers[names.find((k) => k.toLowerCase() === n)];
      hints = { 'sec-ch-ua': headers[ua], 'sec-ch-ua-mobile': get('sec-ch-ua-mobile') || '?0', 'sec-ch-ua-platform': get('sec-ch-ua-platform') || `"${PLATFORM}"` };
    }
    return;
  }
  if ((details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') && details.url.startsWith('https://')) {
    Object.assign(headers, (hints ||= computedHints()));
  }
}

module.exports = { addClientHints, computedHints };
