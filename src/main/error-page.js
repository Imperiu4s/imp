'use strict';
// Builds the self-contained error pages that are injected into failed loads.
const { t } = require('./i18n');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const MESSAGES = {
  '-105': 'err.dns',
  '-137': 'err.dns',
  '-106': 'err.offline',
  '-21': 'err.offline',
  '-102': 'err.refused',
  '-118': 'err.timeout',
  '-7': 'err.timeout',
  '-101': 'err.reset',
  '-100': 'err.reset',
  '-109': 'err.unreachable',
  '-324': 'err.empty',
  '-310': 'err.redirects',
  '-20': 'err.blocked',
};

function messageKey(code) {
  if (code <= -200 && code > -300) return 'err.cert';
  return MESSAGES[String(code)] || 'err.generic';
}

function render({ kind, url, code, desc, accent = '#8B5CF6' }) {
  let host = url;
  try {
    host = new URL(url).hostname || url;
  } catch {}
  let title;
  let body;
  let buttons;
  if (kind === 'crash') {
    title = t('err.crashTitle');
    body = t('err.crashBody');
    buttons = `<button id="primary">${esc(t('err.reload'))}</button>`;
  } else if (kind === 'https') {
    title = t('err.httpsTitle');
    body = t('err.httpsBody', { host });
    buttons = `<button id="secondary" class="ghost">${esc(t('err.continueHttp'))}</button><button id="primary">${esc(t('err.goBack'))}</button>`;
  } else {
    title = t('err.title');
    body = t(messageKey(code), { host });
    buttons = `<button id="primary">${esc(t('err.reload'))}</button>`;
  }
  const detail = kind === 'network' ? `<p class="code">${esc(desc || '')} (${esc(code)})</p>` : '';
  return `<head><meta charset="utf-8"><title>${esc(host)}</title><style>
    :root{color-scheme:light dark;--accent:${esc(accent)}}
    body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.55 system-ui,"Segoe UI",sans-serif;background:Canvas;color:CanvasText}
    main{max-width:560px;padding:32px}
    .icon{width:56px;height:56px;border-radius:16px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);margin-bottom:20px}
    h1{font-size:24px;margin:0 0 10px;font-weight:650}
    p{margin:0 0 8px;opacity:.82}
    .code{font:12px ui-monospace,Consolas,monospace;opacity:.55;margin-top:14px}
    .row{display:flex;gap:10px;margin-top:24px}
    button{font:inherit;font-weight:600;border:0;border-radius:10px;padding:9px 18px;background:var(--accent);color:#fff;cursor:pointer}
    button.ghost{background:transparent;color:inherit;border:1px solid color-mix(in srgb,CanvasText 22%,transparent)}
    </style></head><body><main>
    <div class="icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></svg></div>
    <h1>${esc(title)}</h1><p>${esc(body)}</p>${detail}
    <div class="row">${buttons}</div></main></body>`;
}

// Script executed inside the error page. Buttons talk back through console
// messages because the error page has no privileged bridge.
function script(opts) {
  const html = render(opts);
  return `(() => {
    document.documentElement.innerHTML = ${JSON.stringify(html)};
    const p = document.getElementById('primary');
    const s = document.getElementById('secondary');
    if (p) p.onclick = () => console.log(${JSON.stringify(opts.kind === 'https' ? '__imp_back__' : '__imp_retry__')});
    if (s) s.onclick = () => console.log('__imp_http__');
  })();`;
}

module.exports = { script, esc };
