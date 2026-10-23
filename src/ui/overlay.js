'use strict';
// Popups (menu, shields, downloads, suggestions, …) and bubbles (link status, toasts).
(() => {
  const { icon } = window.ImpIcons;
  const I18N = window.ImpI18n;
  const api = window.imp;
  const params = new URLSearchParams(location.search);
  const isPrivate = params.get('private') === '1';
  const isMac = params.get('platform') === 'darwin';
  const PAD = 18; // transparent margin around popups for their shadow (see POPUP_PAD in main)
  const MOD = isMac ? '⌘' : 'Ctrl';

  const popup = document.getElementById('popup');
  const bubble = document.getElementById('bubble');
  let lang = 'en';
  const t = (key, vars) => I18N.translate(lang, key, vars);
  let settings = null;
  let bookmarks = [];
  let current = null; // { id, type, data }
  let bubbleId = 0;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const action = (name, payload) => api.send('overlay:action', name, payload);
  const close = () => api.send('popup:close');

  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    document.body.dataset.theme = isPrivate ? 'private' : darkMQ.matches ? 'dark' : 'light';
    if (settings && !isPrivate) document.documentElement.style.setProperty('--accent', settings.appearance.accent);
  }
  darkMQ.addEventListener('change', applyTheme);
  applyTheme();

  // ------------------------------------------------------------------ sizing
  // setTimeout, not requestAnimationFrame: the overlay is detached (hidden) until
  // its size is known, and hidden documents get no animation frames.
  let sizeTimer = 0;
  function reportSize() {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      if (current && !popup.hidden) {
        const r = popup.getBoundingClientRect();
        api.send('overlay:size', { id: current.id, kind: 'popup', width: Math.ceil(r.width) + PAD * 2, height: Math.ceil(r.height) + PAD * 2 });
      } else if (!bubble.hidden) {
        const r = bubble.getBoundingClientRect();
        const toast = bubble.classList.contains('toast');
        api.send('overlay:size', { id: bubbleId, kind: 'bubble', width: Math.ceil(r.width) + (toast ? 16 : 0), height: Math.ceil(r.height) + (toast ? 28 : 0) });
      }
    });
  }
  new ResizeObserver(reportSize).observe(popup);
  new ResizeObserver(reportSize).observe(bubble);

  // ------------------------------------------------------------------ helpers
  function fmtBytes(n) {
    if (!n || n < 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
  }

  function favicon(url, fallback = 'globe', size = 16) {
    if (url) return `<img src="${esc(url)}" width="${size}" height="${size}" alt="" data-fallback="${fallback}">`;
    return icon(fallback, size);
  }

  function fixImages(root) {
    root.querySelectorAll('img[data-fallback]').forEach((img) => {
      img.addEventListener('error', () => {
        img.outerHTML = icon(img.dataset.fallback || 'globe', 16);
      });
    });
  }

  function row({ icon: ic, label, kbd = '', cls = '', attrs = '' }) {
    return `<button class="row ${cls}" ${attrs}>${ic ? icon(ic, 16) : ''}<span class="label">${esc(label)}</span>${kbd ? `<span class="kbd">${esc(kbd)}</span>` : ''}</button>`;
  }

  // ------------------------------------------------------------------ renderers
  const renderers = {
    suggest(data) {
      popup.className = 'popup suggest';
      popup.style.width = `${Math.round(data.width)}px`;
      const head = data.title ? `<div class="sug-head">${esc(data.title)}</div>` : '';
      popup.innerHTML =
        head +
        data.items
          .map((it, i) => {
            const ic = it.favicon ? favicon(it.favicon, it.icon) : icon(it.icon || 'globe', 16);
            const remove = it.removable ? `<button class="sug-x" title="${esc(t('omnibox.removeRecent'))}">${icon('close', 13)}</button>` : '';
            return `<div class="sug kind-${it.kind} ${i === data.selected ? 'selected' : ''}" data-i="${i}">
            <span class="sug-icon">${ic}</span><span class="sug-title">${esc(it.title)}</span><span class="sug-sub">${esc(it.sub || '')}</span>${remove}</div>`;
          })
          .join('');
      fixImages(popup);
      popup.querySelectorAll('.sug').forEach((el) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const index = Number(el.dataset.i);
          if (e.target.closest('.sug-x')) action('suggest-remove', { index });
          else action('suggest-pick', { index, middle: e.button === 1 });
        });
      });
    },

    menu(data) {
      popup.className = 'popup menu';
      popup.style.width = '300px';
      const z = Math.round((data.zoom || 1) * 100);
      const cmd = (ic, key, name, kbd, cls = '') => row({ icon: ic, label: t(key), kbd, cls, attrs: `data-cmd="${name}"` });
      const updateRow =
        data.update?.state === 'ready'
          ? `<div class="section">${row({ icon: 'sparkle', label: t('menu.restartUpdate', { v: data.update.version || '' }), cls: 'accent', attrs: 'data-cmd="restart-update"' })}</div>`
          : '';
      popup.innerHTML = `
        ${updateRow}
        <div class="section">
          ${cmd('plus', 'menu.newTab', 'new-tab', `${MOD}+T`)}
          ${cmd('window', 'menu.newWindow', 'new-window', `${MOD}+N`)}
          ${cmd('incognito', 'menu.newPrivate', 'new-private-window', `${MOD}+Shift+N`)}
        </div>
        <div class="section">
          <div class="zoom-row">
            <span class="label">${esc(t('menu.zoom'))}</span>
            <button class="icon-btn small" data-zoom="-1" title="${esc(t('menu.zoomOut'))}">${icon('minus', 15)}</button>
            <span class="value">${z}%</span>
            <button class="icon-btn small" data-zoom="1" title="${esc(t('menu.zoomIn'))}">${icon('plus', 15)}</button>
            <button class="icon-btn small" data-cmd="fullscreen" title="${esc(t('menu.fullscreen'))}">${icon('fullscreen', 15)}</button>
          </div>
        </div>
        <div class="section">
          ${cmd('history', 'menu.history', 'open-history', `${MOD}+H`)}
          ${cmd('download', 'menu.downloads', 'open-downloads', `${MOD}+J`)}
          ${cmd('bookmark', 'menu.bookmarks', 'open-bookmarks', `${MOD}+Shift+O`)}
          ${cmd('password', 'menu.passwords', 'open-passwords', '')}
        </div>
        <div class="section">
          ${cmd('search', 'menu.find', 'find', `${MOD}+F`)}
          ${cmd('command', 'menu.palette', 'command-palette', `${MOD}+Shift+A`)}
          ${cmd('split', 'menu.split', 'toggle-split', `${MOD}+Shift+E`)}
          ${cmd('sidebar', settings?.appearance.verticalTabs ? 'menu.horizontalTabs' : 'menu.verticalTabs', 'toggle-vertical-tabs', '')}
          ${data.web ? cmd('reader', 'menu.reader', 'reader', 'F9') : ''}
          ${data.web ? cmd('translate', 'menu.translate', 'translate', '') : ''}
          ${cmd('camera', 'menu.capture', 'screenshot', `${MOD}+Shift+S`)}
          ${cmd('printer', 'menu.print', 'print', `${MOD}+P`)}
          ${cmd('save', 'menu.savePage', 'save-page', `${MOD}+S`)}
        </div>
        <div class="section">
          ${cmd('zap', 'menu.taskManager', 'open-performance', 'Shift+Esc')}
          ${cmd('code', 'menu.devtools', 'devtools', 'F12')}
        </div>
        <div class="section">
          ${cmd('settings', 'menu.settings', 'open-settings', `${MOD}+,`)}
          ${cmd('info', 'menu.about', 'about', '')}
          ${cmd('power', 'menu.exit', 'quit', '')}
        </div>`;
      popup.querySelectorAll('[data-cmd]').forEach((el) => el.addEventListener('click', () => action('command', { name: el.dataset.cmd })));
      popup.querySelectorAll('[data-zoom]').forEach((el) => el.addEventListener('click', () => action('zoom', { dir: Number(el.dataset.zoom) })));
    },

    shields(data) {
      popup.className = 'popup shields';
      popup.style.width = '330px';
      const on = data.on;
      const since = new Date(data.stats.since).toLocaleDateString(lang);
      let body;
      if (!data.web) {
        body = `<div class="empty">${esc(t('shields.notWeb'))}</div>`;
      } else {
        const hosts = data.hosts.length
          ? `<details class="section"><summary class="row">${icon('chevronRight', 14)}<span class="label">${esc(t('shields.details'))}</span></summary>
              <div class="host-list">${data.hosts.map(([h, n]) => `<div><span>${esc(h)}</span><span>${n}</span></div>`).join('')}</div></details>`
          : '';
        body = `
          <div class="toggle-row">
            <span class="label">${esc(t(on ? 'shields.up' : 'shields.down'))}</span>
            <button class="switch ${on ? 'on' : ''}" id="sh-toggle" aria-label="toggle"></button>
          </div>
          ${on ? `<div class="big-stat"><b>${data.blocked}</b><span class="muted">${esc(t('shields.blockedHere'))}</span></div>` : `<div class="kv muted">${esc(t('shields.offHint'))}</div>`}
          ${on ? hosts : ''}
          <div class="section">
            <div class="kv">${icon(data.https ? 'lock' : 'warning', 15)}<span class="grow">${esc(t(data.https ? 'shields.httpsOk' : 'shields.httpsNo'))}</span></div>
            <div class="kv">${icon('shieldCheck', 15)}<span class="grow">${esc(t('shields.mode'))}</span><b>${esc(t(`shields.mode.${data.mode}`))}</b></div>
          </div>`;
      }
      popup.innerHTML = `
        <div class="shield-hero ${on ? '' : 'off'}">
          <div class="badge-ic">${icon(on ? 'shieldCheck' : 'shieldOff', 24)}</div>
          <div style="min-width:0"><div class="host">${esc(data.host || t('shields.title'))}</div>
          <div class="muted small">${esc(t('shields.total', { n: data.stats.blocked.toLocaleString(lang), since }))}</div></div>
        </div>
        ${body}
        <div class="section">${row({ icon: 'settings', label: t('shields.settings'), attrs: 'data-cmd="open-settings" data-arg="shields"' })}</div>`;
      popup.querySelector('#sh-toggle')?.addEventListener('click', () => action('shields-toggle', { on: !on }));
      popup.querySelector('[data-cmd]').addEventListener('click', (e) => action('command', { name: 'open-settings', arg: e.currentTarget.dataset.arg }));
    },

    downloads(data) {
      popup.className = 'popup downloads';
      popup.style.width = '360px';
      const items = data.items || [];
      const list = items.length
        ? items
            .map((d) => {
              const ext = (d.filename.split('.').pop() || '').slice(0, 4);
              let sub;
              let progress = '';
              if (d.state === 'progressing') {
                const pct = d.total ? Math.round((d.received / d.total) * 100) : null;
                sub = d.paused
                  ? t('dl.paused')
                  : `${fmtBytes(d.received)}${d.total ? ` / ${fmtBytes(d.total)}` : ''}${d.speed ? ` · ${fmtBytes(d.speed)}/s` : ''}`;
                progress = `<div class="progress"><i style="width:${pct ?? 30}%"></i></div>`;
              } else if (d.state === 'completed') sub = d.exists === false ? t('dl.deleted') : `${t('dl.done')} · ${fmtBytes(d.received)}`;
              else if (d.state === 'cancelled') sub = t('dl.cancelled');
              else sub = t('dl.failed');
              const actions =
                d.state === 'progressing'
                  ? `<button class="icon-btn small" data-op="pause" title="${esc(t(d.paused ? 'dl.resume' : 'dl.pause'))}">${icon(d.paused ? 'play' : 'pause', 14)}</button>
                     <button class="icon-btn small" data-op="cancel" title="${esc(t('dl.cancel'))}">${icon('close', 14)}</button>`
                  : d.state === 'completed' && d.exists !== false
                    ? `<button class="icon-btn small" data-op="show" title="${esc(t('dl.show'))}">${icon('folder', 15)}</button>`
                    : `<button class="icon-btn small" data-op="remove" title="${esc(t('dl.remove'))}">${icon('trash', 14)}</button>`;
              return `<div class="dl ${d.exists === false ? 'gone' : ''}" data-id="${esc(d.id)}" data-state="${d.state}">
                <div class="file-ic">${esc(ext) || icon('file', 16)}</div>
                <div class="meta"><div class="name" title="${esc(d.filename)}">${esc(d.filename)}</div><div class="sub">${esc(sub)}</div>${progress}</div>
                ${actions}</div>`;
            })
            .join('')
        : `<div class="empty">${esc(t('dl.empty'))}</div>`;
      popup.innerHTML = `
        <div class="head"><h3>${esc(t('dl.title'))}</h3>
          <button class="icon-btn small" data-cmd="open-downloads" title="${esc(t('dl.all'))}">${icon('external', 15)}</button></div>
        <div class="section" style="padding-top:0">${list}</div>
        <div class="section">${row({ icon: 'download', label: t('dl.all'), attrs: 'data-cmd="open-downloads"' })}</div>`;
      popup.querySelectorAll('[data-cmd]').forEach((el) => el.addEventListener('click', () => action('command', { name: 'open-downloads' })));
      popup.querySelectorAll('.dl').forEach((el) => {
        el.addEventListener('click', (e) => {
          const op = e.target.closest('[data-op]')?.dataset.op;
          if (op) {
            e.stopPropagation();
            action('download', { op, id: el.dataset.id });
          } else if (el.dataset.state === 'completed' && !el.classList.contains('gone')) {
            action('download', { op: 'open', id: el.dataset.id });
          }
        });
      });
    },

    bookmark(data) {
      popup.className = 'popup bookmark';
      popup.style.width = '330px';
      const item = data.item;
      if (!item) {
        popup.innerHTML = `<div class="empty">${esc(t('bm.removed'))}</div>`;
        setTimeout(close, 900);
        return;
      }
      const folderOpts = [
        { id: 'bar', title: t('bm.bar') },
        { id: 'other', title: t('bm.other') },
        ...data.folders,
      ]
        .map((f) => `<option value="${esc(f.id)}" ${String(f.id) === String(item.parent) ? 'selected' : ''}>${esc(f.title)}</option>`)
        .join('');
      popup.innerHTML = `
        <div class="head">${icon('starFill', 18, 'accent')}<h3>${esc(t(data.created ? 'bm.added' : 'bm.edit'))}</h3></div>
        <form class="form" id="bm-form">
          <label>${esc(t('bm.name'))}<input id="bm-title" value="${esc(item.title)}"></label>
          <label>${esc(t('bm.folder'))}<select id="bm-parent">${folderOpts}</select></label>
          <div class="buttons"><button type="button" class="btn ghost" id="bm-remove">${esc(t('bm.remove'))}</button>
          <button type="submit" class="btn primary">${esc(t('bm.done'))}</button></div>
        </form>`;
      const titleInput = popup.querySelector('#bm-title');
      setTimeout(() => {
        titleInput.focus();
        titleInput.select();
      }, 30);
      popup.querySelector('#bm-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const parentRaw = popup.querySelector('#bm-parent').value;
        const parent = parentRaw === 'bar' || parentRaw === 'other' ? parentRaw : Number(parentRaw);
        action('bookmark-save', { id: item.id, title: titleInput.value.trim() || item.url, parent });
      });
      popup.querySelector('#bm-remove').addEventListener('click', () => action('bookmark-remove', { id: item.id }));
    },

    bmfolder(data) {
      popup.className = 'popup bmfolder';
      popup.style.width = '300px';
      const stack = [{ folder: data.folder, title: data.title }];
      const draw = () => {
        const top = stack[stack.length - 1];
        const items = bookmarks.filter((b) => String(b.parent) === String(top.folder));
        const back = stack.length > 1 ? row({ icon: 'chevronLeft', label: top.title, attrs: 'data-back="1"' }) : '';
        const list = items.length
          ? items
              .map((b) =>
                b.type === 'folder'
                  ? `<button class="row" data-folder="${b.id}">${icon('folder', 16)}<span class="label">${esc(b.title)}</span>${icon('chevronRight', 14)}</button>`
                  : `<button class="row" data-id="${b.id}" title="${esc(b.url)}">${favicon(b.favicon)}<span class="label">${esc(b.title || b.url)}</span></button>`,
              )
              .join('')
          : `<div class="empty">${esc(t('bm.folderEmpty'))}</div>`;
        popup.innerHTML = `<div class="section">${back}${list}</div>`;
        fixImages(popup);
        popup.querySelector('[data-back]')?.addEventListener('click', () => {
          stack.pop();
          draw();
        });
        popup.querySelectorAll('[data-folder]').forEach((el) =>
          el.addEventListener('click', () => {
            const f = bookmarks.find((b) => b.id === Number(el.dataset.folder));
            stack.push({ folder: f.id, title: f.title });
            draw();
          }),
        );
        popup.querySelectorAll('[data-id]').forEach((el) => {
          el.addEventListener('click', (e) => action('bookmark-open', { id: Number(el.dataset.id), disposition: e.ctrlKey ? 'new-tab' : 'current', background: e.ctrlKey }));
          el.addEventListener('auxclick', (e) => {
            if (e.button === 1) action('bookmark-open', { id: Number(el.dataset.id), disposition: 'new-tab', background: true });
          });
        });
      };
      draw();
    },

    siteinfo(data) {
      popup.className = 'popup siteinfo';
      popup.style.width = '330px';
      let headIcon = 'lock';
      let headText = t('site.secure');
      let headCls = 'ok';
      if (data.internal) {
        headIcon = 'shieldCheck';
        headText = t('site.internal');
        headCls = '';
      } else if (data.file) {
        headIcon = 'file';
        headText = t('site.file');
        headCls = '';
      } else if (!data.secure) {
        headIcon = 'warning';
        headText = t('site.notSecureLong');
        headCls = 'bad';
      }
      const kinds = ['geolocation', 'camera', 'microphone', 'notifications', 'clipboard-read'];
      const KIND_ICONS = { geolocation: 'mapPin', camera: 'video', microphone: 'mic', notifications: 'bell', 'clipboard-read': 'clipboard' };
      const perms =
        data.origin && !data.internal
          ? kinds
              .map((k) => {
                const v = data.perms[k] || '';
                return `<div class="perm">${icon(KIND_ICONS[k], 15)}<span class="label">${esc(t(`permName.${k}`))}</span>
                <select data-kind="${k}"><option value="" ${!v ? 'selected' : ''}>${esc(t('perm.ask'))}</option>
                <option value="allow" ${v === 'allow' ? 'selected' : ''}>${esc(t('perm.allow'))}</option>
                <option value="block" ${v === 'block' ? 'selected' : ''}>${esc(t('perm.block'))}</option></select></div>`;
              })
              .join('')
          : '';
      popup.innerHTML = `
        <div class="head">${icon(headIcon, 18, headCls)}<h3 class="${headCls}">${esc(headText)}</h3></div>
        <div class="kv muted" style="padding-top:0">${esc(data.host || data.url)}</div>
        ${perms ? `<div class="section"><div class="group-title">${esc(t('site.permissions'))}</div>${perms}</div>` : ''}
        ${
          data.origin && !data.internal
            ? `<div class="section">
            <div class="kv">${icon('shieldCheck', 15)}<span class="grow">${esc(t('site.shields'))}</span><b>${esc(data.shieldsOn ? t('site.blockedN', { n: data.blocked }) : t('site.shieldsOff'))}</b></div>
            ${row({ icon: 'cookie', label: t('site.clearData'), attrs: 'id="site-clear"' })}
          </div>`
            : ''
        }
        <div class="section">${row({ icon: 'settings', label: t('site.settings'), attrs: 'id="site-settings"' })}</div>`;
      popup.querySelectorAll('select[data-kind]').forEach((sel) =>
        sel.addEventListener('change', () => action('perm-set', { origin: data.origin, kind: sel.dataset.kind, value: sel.value })),
      );
      popup.querySelector('#site-clear')?.addEventListener('click', () => action('site-clear', { origin: data.origin }));
      popup.querySelector('#site-settings').addEventListener('click', () => action('command', { name: 'open-settings', arg: 'permissions' }));
    },

    auth(data) {
      popup.className = 'popup auth';
      popup.style.width = '380px';
      popup.innerHTML = `
        <div class="head">${icon('key', 18, 'accent')}<h3>${esc(t('auth.title'))}</h3></div>
        <div class="kv muted" style="padding-top:0">${esc(t(data.proxy ? 'auth.proxy' : 'auth.desc', { host: data.host }))}${data.realm ? ` — „${esc(data.realm)}”` : ''}</div>
        <form class="form" id="auth-form">
          <label>${esc(t('auth.user'))}<input id="auth-user" autocomplete="username"></label>
          <label>${esc(t('auth.pass'))}<input id="auth-pass" type="password" autocomplete="current-password"></label>
          <div class="buttons"><button type="button" class="btn ghost" id="auth-cancel">${esc(t('common.cancel'))}</button>
          <button type="submit" class="btn primary">${esc(t('auth.signin'))}</button></div>
        </form>`;
      setTimeout(() => popup.querySelector('#auth-user').focus(), 30);
      popup.querySelector('#auth-form').addEventListener('submit', (e) => {
        e.preventDefault();
        action('auth-submit', { user: popup.querySelector('#auth-user').value, pass: popup.querySelector('#auth-pass').value });
      });
      popup.querySelector('#auth-cancel').addEventListener('click', close);
    },

    // Saved accounts under a login field of the page.
    pwfill(data) {
      popup.className = 'popup suggest pwfill';
      popup.style.width = `${Math.round(data.width || 280)}px`;
      popup.innerHTML =
        `<div class="sug-head">${esc(t('pw.savedFor'))}</div>` +
        data.items
          .map(
            (it, i) => `<div class="sug ${i === data.selected ? 'selected' : ''}" data-i="${i}">
            <span class="sug-icon">${icon('key', 16)}</span><span class="pw-user">${esc(it.username || t('pw.noUsername'))}</span>
            <span class="pw-dots">••••••••</span>${it.host ? `<span class="pw-host">${esc(it.host)}</span>` : ''}</div>`,
          )
          .join('') +
        `<div class="pw-foot"><button class="pw-manage">${icon('settings', 14)}${esc(t('pw.manage'))}</button></div>`;
      popup.querySelectorAll('.sug').forEach((el) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          action('pw-fill', { index: Number(el.dataset.i) });
        });
      });
      popup.querySelector('.pw-manage').addEventListener('mousedown', (e) => {
        e.preventDefault();
        action('pw-manage');
      });
    },

    // "Save password?" after signing in.
    pwsave(data) {
      popup.className = 'popup pwsave';
      popup.style.width = '360px';
      popup.innerHTML = `
        <div class="head">${icon('key', 18, 'accent')}<h3>${esc(t(data.update ? 'pw.updateTitle' : 'pw.saveTitle'))}</h3>
          <button class="icon-btn small" id="pw-close" title="${esc(t('common.close'))}">${icon('close', 15)}</button></div>
        <div class="kv muted pw-site">${icon('globe', 15)}<span class="grow">${esc(data.host)}</span></div>
        <form class="form" id="pw-form">
          <label>${esc(t('pw.username'))}<input id="pw-user" value="${esc(data.username)}" spellcheck="false" autocomplete="off"></label>
          <label>${esc(t('pw.password'))}<span class="pw-field"><input id="pw-pass" type="password" value="${esc(data.password)}" spellcheck="false" autocomplete="off">
            <button type="button" class="icon-btn small" id="pw-eye" title="${esc(t('pw.show'))}">${icon('eye', 15)}</button></span></label>
          <div class="buttons"><button type="button" class="btn ghost" id="pw-never">${esc(t('pw.never'))}</button>
          <button type="submit" class="btn primary">${esc(t(data.update ? 'pw.update' : 'pw.save'))}</button></div>
        </form>`;
      const pass = popup.querySelector('#pw-pass');
      popup.querySelector('#pw-eye').addEventListener('click', (e) => {
        const show = pass.type === 'password';
        pass.type = show ? 'text' : 'password';
        e.currentTarget.innerHTML = icon(show ? 'eyeOff' : 'eye', 15);
        e.currentTarget.title = t(show ? 'pw.hide' : 'pw.show');
      });
      popup.querySelector('#pw-form').addEventListener('submit', (e) => {
        e.preventDefault();
        action('pw-save', { username: popup.querySelector('#pw-user').value, password: pass.value });
      });
      popup.querySelector('#pw-never').addEventListener('click', () => action('pw-never'));
      popup.querySelector('#pw-close').addEventListener('click', close);
      // Shown by itself after signing in: tuck it away after a while if you
      // don't touch it (the key in the address bar brings it back).
      if (data.auto) {
        const timer = setTimeout(close, 20000);
        const keep = () => clearTimeout(timer);
        popup.addEventListener('pointerenter', keep, { once: true });
        popup.addEventListener('focusin', keep, { once: true });
      }
    },

    palette() {
      popup.className = 'popup palette';
      popup.style.width = `${Math.min(640, window.screen.availWidth - 80)}px`;
      popup.innerHTML = `<div class="palette-input">${icon('command', 18)}<input id="pal-input" placeholder="${esc(t('palette.placeholder'))}"></div>
        <div class="palette-list" id="pal-list"></div>`;
      const input = popup.querySelector('#pal-input');
      const listEl = popup.querySelector('#pal-list');
      let results = [];
      let selected = 0;
      let seq = 0;
      const commands = PALETTE_COMMANDS.map((c) => ({ ...c, label: t(c.key) }));

      const run = (r, e) => {
        if (!r) return;
        if (r.kind === 'cmd') {
          if (r.setting) {
            api.send('ui:setting', r.setting[0], r.setting[1]);
            close();
          } else action('command', { name: r.name });
        } else if (r.kind === 'tab') action('focus-tab', { id: r.id, windowId: r.windowId });
        else if (r.kind === 'url') action('open-url', { url: r.url, disposition: e?.ctrlKey ? 'new-tab' : 'current' });
        else if (r.kind === 'search') {
          api.send('nav:go', `?${r.query}`, { disposition: 'current' });
          close();
        }
      };

      const draw = () => {
        let html = '';
        let i = 0;
        let lastGroup = null;
        for (const r of results) {
          if (r.group !== lastGroup) {
            html += `<div class="group-title">${esc(t(`palette.${r.group}`))}</div>`;
            lastGroup = r.group;
          }
          const ic = r.kind === 'tab' || r.kind === 'url' ? favicon(r.favicon, r.kind === 'tab' ? 'window' : 'globe') : icon(r.icon || 'command', 16);
          html += `<button class="row ${i === selected ? 'selected' : ''}" data-i="${i}">${ic}<span class="label">${esc(r.label)}</span>${r.kbd ? `<span class="kbd">${esc(r.kbd)}</span>` : r.sub ? `<span class="kbd">${esc(r.sub)}</span>` : ''}</button>`;
          i++;
        }
        listEl.innerHTML = html || `<div class="empty">${esc(t('palette.nothing'))}</div>`;
        fixImages(listEl);
        listEl.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', (e) => run(results[Number(el.dataset.i)], e)));
        listEl.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
      };

      const query = async () => {
        const q = input.value.trim().toLowerCase();
        const mySeq = ++seq;
        const cmdHits = commands
          .filter((c) => !q || c.label.toLowerCase().includes(q) || c.name.includes(q))
          .slice(0, q ? 8 : 6)
          .map((c) => ({ kind: 'cmd', group: 'commands', name: c.name, setting: c.setting, label: c.label, icon: c.icon, kbd: c.kbd }));
        const res = await api.invoke('palette:query', q);
        if (mySeq !== seq || !res) return;
        const host = (u) => {
          try {
            return new URL(u).hostname.replace(/^www\./, '');
          } catch {
            return u;
          }
        };
        results = [
          ...res.tabs.map((x) => ({ ...x, group: 'tabs', label: x.title, sub: host(x.url) })),
          ...cmdHits,
          ...res.bookmarks.map((x) => ({ ...x, group: 'bookmarks', label: x.title || x.url, sub: host(x.url) })),
          ...res.history.map((x) => ({ ...x, group: 'history', label: x.title, sub: host(x.url) })),
        ];
        if (!q) results = [...cmdHits, ...res.tabs.map((x) => ({ ...x, group: 'tabs', label: x.title, sub: host(x.url) }))];
        if (q) {
          const engine = (window.ImpEngines[settings?.search.engine] || window.ImpEngines.duckduckgo).name;
          results.push({ kind: 'search', group: 'web', query: input.value.trim(), label: t('palette.search', { q: input.value.trim(), engine }), icon: 'search' });
        }
        selected = 0;
        draw();
      };

      input.addEventListener('input', query);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!results.length) return;
          selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
          draw();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          run(results[selected], e);
        }
      });
      setTimeout(() => input.focus(), 20);
      query();
    },
  };

  const PALETTE_COMMANDS = [
    { name: 'new-tab', key: 'menu.newTab', icon: 'plus', kbd: `${MOD}+T` },
    { name: 'new-window', key: 'menu.newWindow', icon: 'window', kbd: `${MOD}+N` },
    { name: 'new-private-window', key: 'menu.newPrivate', icon: 'incognito', kbd: `${MOD}+Shift+N` },
    { name: 'reopen-closed-tab', key: 'menu.reopenClosed', icon: 'history', kbd: `${MOD}+Shift+T` },
    { name: 'open-history', key: 'menu.history', icon: 'history', kbd: `${MOD}+H` },
    { name: 'open-downloads', key: 'menu.downloads', icon: 'download', kbd: `${MOD}+J` },
    { name: 'open-bookmarks', key: 'menu.bookmarks', icon: 'bookmark', kbd: `${MOD}+Shift+O` },
    { name: 'open-passwords', key: 'menu.passwords', icon: 'password', kbd: '' },
    { name: 'open-settings', key: 'menu.settings', icon: 'settings', kbd: `${MOD}+,` },
    { name: 'open-performance', key: 'menu.taskManager', icon: 'zap', kbd: 'Shift+Esc' },
    { name: 'toggle-split', key: 'menu.split', icon: 'split', kbd: `${MOD}+Shift+E` },
    { name: 'toggle-vertical-tabs', key: 'palette.toggleVertical', icon: 'sidebar', kbd: `${MOD}+Shift+V` },
    { name: 'toggle-bookmarks-bar', key: 'palette.toggleBookmarksBar', icon: 'bookmark', kbd: `${MOD}+Shift+B` },
    { name: 'reader', key: 'menu.reader', icon: 'reader', kbd: 'F9' },
    { name: 'screenshot', key: 'menu.capture', icon: 'camera', kbd: `${MOD}+Shift+S` },
    { name: 'screenshot-full', key: 'menu.captureFull', icon: 'image', kbd: '' },
    { name: 'translate', key: 'menu.translate', icon: 'translate', kbd: '' },
    { name: 'find', key: 'menu.find', icon: 'search', kbd: `${MOD}+F` },
    { name: 'print', key: 'menu.print', icon: 'printer', kbd: `${MOD}+P` },
    { name: 'save-page', key: 'menu.savePage', icon: 'save', kbd: `${MOD}+S` },
    { name: 'fullscreen', key: 'menu.fullscreen', icon: 'fullscreen', kbd: 'F11' },
    { name: 'mute-tab', key: 'palette.muteTab', icon: 'mute', kbd: `${MOD}+Shift+M` },
    { name: 'pin-tab', key: 'palette.pinTab', icon: 'pin', kbd: '' },
    { name: 'duplicate-tab', key: 'menu.duplicate', icon: 'plus', kbd: '' },
    { name: 'zoom-in', key: 'menu.zoomIn', icon: 'plus', kbd: `${MOD}++` },
    { name: 'zoom-out', key: 'menu.zoomOut', icon: 'minus', kbd: `${MOD}+-` },
    { name: 'zoom-reset', key: 'palette.zoomReset', icon: 'search', kbd: `${MOD}+0` },
    { name: 'devtools', key: 'menu.devtools', icon: 'code', kbd: 'F12' },
    { name: 'clear-data', key: 'palette.clearData', icon: 'trash', kbd: '' },
    { name: 'theme-dark', key: 'palette.themeDark', icon: 'moon', setting: ['appearance.theme', 'dark'] },
    { name: 'theme-light', key: 'palette.themeLight', icon: 'sun', setting: ['appearance.theme', 'light'] },
    { name: 'theme-system', key: 'palette.themeSystem', icon: 'monitor', setting: ['appearance.theme', 'system'] },
    { name: 'about', key: 'menu.about', icon: 'info', kbd: '' },
  ];

  // ------------------------------------------------------------------ popup lifecycle
  function show({ id, type, data, maxHeight }) {
    bubble.hidden = true;
    current = { id, type, data };
    popup.style.maxHeight = `${Math.max(120, (maxHeight || 600) - PAD * 2)}px`;
    popup.hidden = false;
    (renderers[type] || (() => {}))(data || {});
    reportSize();
  }

  function hide() {
    current = null;
    popup.hidden = true;
    popup.innerHTML = '';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) {
      e.preventDefault();
      close();
    }
  });

  api.on('popup:show', show);
  api.on('popup:update', ({ id, type, data }) => {
    if (!current || current.id !== id || current.type !== type) return;
    current.data = data;
    if (type === 'suggest' || type === 'pwfill') renderers[type](data);
    else if (type !== 'bookmark' && type !== 'palette') renderers[type]?.(data);
    reportSize();
  });
  api.on('popup:hide', ({ id }) => {
    if (!current || current.id === id) hide();
  });

  api.on('bubble:show', ({ id, kind, text, action: label }) => {
    if (current) return;
    bubbleId = id;
    bubble.className = `bubble ${kind}`;
    if (kind === 'toast') {
      bubble.innerHTML = `<span>${esc(text)}</span>${label ? `<button>${esc(label)}</button>` : ''}`;
      bubble.querySelector('button')?.addEventListener('click', () => api.send('bubble:action'));
    } else {
      bubble.textContent = text;
    }
    bubble.hidden = false;
    reportSize();
  });
  api.on('bubble:hide', () => {
    bubble.hidden = true;
  });

  api.on('state:init', (init) => {
    settings = init.settings;
    lang = init.lang;
    bookmarks = init.bookmarks || [];
    applyTheme();
  });
  api.on('state:settings', (s) => {
    settings = s;
    applyTheme();
  });
  api.on('state:lang', (l) => {
    lang = l;
  });
  api.on('state:bookmarks', (list) => {
    bookmarks = list;
  });

  api.send('overlay:ready');
})();
