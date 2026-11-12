'use strict';
// A lighter YouTube: ambient mode (the coloured glow behind the player) is
// switched off. It costs about a quarter of the CPU and GPU time spent on
// playback (measured). Runs in the page's own world before YouTube's scripts,
// handed out with the ad blocker's page code (scriptletsFor in shields.js).
//
// Ads on YouTube: network blocking with working decoys (shields.js) plus only
// those filter-list scriptlets that strip ad data from the page itself. The ones
// that rewrite the player's own requests and responses (and the anti-detection
// helpers that come with them) make YouTube hold each video back for about 10 s
// or never start it (measured in Imp 1.0.8). Imp 1.0.7 skipped ads in the player
// instead, which YouTube recognised and answered with its ad blocker wall.

const NO_AMBIENT = `(() => {
  const add = () => {
    const style = document.createElement('style');
    style.textContent = '#cinematics, #cinematics-container { display: none !important; }';
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.documentElement) add();
  else new MutationObserver((r, o) => { if (document.documentElement) { o.disconnect(); add(); } }).observe(document, { childList: true });
})();`;

const isYouTube = (hostname) => /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(hostname);

function pageCode({ lighter }) {
  return lighter ? NO_AMBIENT : '';
}

// Whether a filter-list scriptlet runs on YouTube (see above).
function keepScriptlet(script) {
  const at = script.lastIndexOf('(function ');
  const name = (/^\(function (\w+)\(/.exec(script.slice(at)) || [])[1] || '';
  const args = script.slice(script.lastIndexOf('(...['));
  if (name === 'setConstant' || name === 'jsonPrune') return true;
  if (/^jsonPrune(Fetch|Xhr)Response$/.test(name)) return !/player|playlist|get_watch/i.test(args);
  return false;
}

module.exports = { isYouTube, pageCode, keepScriptlet };
