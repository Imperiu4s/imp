'use strict';
// YouTube, faster. Both run in the page's own world before YouTube's scripts
// (handed out by scriptletsFor in shields.js, also inside embedded players).
//
// Ads: the filter lists cut the ads out of YouTube's responses, and YouTube
// answers that with slower video starts (about +0.6 s per video, measured).
// Instead the player gets its ads and Imp skips them on the spot: the ad is
// kept out of sight and muted, jumped to its end, and its skip button pressed.
// Video changes are then as quick as without ad blocking.
//
// Ambient mode (the coloured glow behind the player) is switched off: it costs
// about a quarter of the CPU and GPU time spent on playback (measured).

const AD_SKIPPER = `(() => {
  if (window.__impYouTubeAds) return;
  window.__impYouTubeAds = true;
  const css = '#movie_player.ad-showing video { visibility: hidden !important; }'
    + ' .ytp-ad-overlay-container, .ytp-ad-message-container, .ytp-ad-player-overlay-layout, .ytp-ad-text-overlay,'
    + ' ytd-player-legacy-desktop-watch-ads-renderer, #player-ads, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer,'
    + ' ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer) { display: none !important; }';
  let muted = null; // the video's own mute state while we keep an ad quiet
  const skip = () => {
    const player = document.getElementById('movie_player');
    const video = player && player.querySelector('video');
    if (!video) return;
    if (player.classList.contains('ad-showing')) {
      if (muted === null) muted = video.muted;
      video.muted = true;
      if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.2) video.currentTime = video.duration - 0.1;
      for (const b of document.querySelectorAll('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, [id^="skip-button"] button')) b.click();
    } else if (muted !== null) {
      video.muted = muted;
      muted = null;
    }
  };
  const start = () => {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    new MutationObserver(skip).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
    for (const type of ['loadedmetadata', 'durationchange', 'timeupdate', 'playing']) document.addEventListener(type, skip, true);
  };
  if (document.documentElement) start();
  else new MutationObserver((r, o) => { if (document.documentElement) { o.disconnect(); start(); } }).observe(document, { childList: true });
})();`;

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

// The page code for a YouTube page: ad skipping when ads are blocked there, and
// the lighter player when that setting is on.
function pageCode({ blockAds, lighter }) {
  return [blockAds ? AD_SKIPPER : '', lighter ? NO_AMBIENT : ''].filter(Boolean).join('\n');
}

module.exports = { isYouTube, pageCode };
