'use strict';
// A lighter YouTube: ambient mode (the coloured glow behind the player) is
// switched off. It costs about a quarter of the CPU and GPU time spent on
// playback (measured). Runs in the page's own world before YouTube's scripts,
// handed out with the ad blocker's page code (scriptletsFor in shields.js).
//
// Ads on YouTube: network blocking with working decoys plus every filter-list
// scriptlet, fresh from the CDN (shields.js). The lists' current method asks
// YouTube for the video without ads, so there is nothing for it to detect.
// Running only parts of them (1.0.8: pruning ads out of responses) or skipping
// ads in the player (1.0.7) is what YouTube recognised and walled off.

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

module.exports = { isYouTube, pageCode };
