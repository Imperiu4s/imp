'use strict';
(async () => {
  const { t, call, esc, icon, hostOf, fmtBytes } = window.Page;
  const $ = (s) => document.querySelector(s);
  let items = [];

  await window.Page.init();

  function sub(d) {
    if (d.state === 'progressing') {
      if (d.paused) return t('dl.paused');
      const speed = d.speed ? ` · ${fmtBytes(d.speed)}/s` : '';
      const eta = d.speed && d.total ? ` · ${t('dlp.left', { s: Math.max(1, Math.round((d.total - d.received) / d.speed)) })}` : '';
      return `${fmtBytes(d.received)}${d.total ? ` / ${fmtBytes(d.total)}` : ''}${speed}${eta}`;
    }
    if (d.state === 'completed') return d.exists === false ? t('dl.deleted') : `${fmtBytes(d.received)} · ${hostOf(d.url)} · ${new Date(d.end || d.start).toLocaleString(window.Page.lang)}`;
    if (d.state === 'cancelled') return t('dl.cancelled');
    return t('dl.failed');
  }

  function actions(d) {
    if (d.state === 'progressing') {
      return `<button class="icon-btn" data-op="pause" title="${esc(t(d.paused ? 'dl.resume' : 'dl.pause'))}">${icon(d.paused ? 'play' : 'pause', 15)}</button>
        <button class="icon-btn" data-op="cancel" title="${esc(t('dl.cancel'))}">${icon('close', 15)}</button>`;
    }
    const open = d.state === 'completed' && d.exists !== false;
    return `${open ? `<button class="btn small" data-op="open">${esc(t('dlp.open'))}</button><button class="icon-btn" data-op="show" title="${esc(t('dl.show'))}">${icon('folder', 16)}</button>` : ''}
      <button class="icon-btn" data-op="remove" title="${esc(t('dl.remove'))}">${icon('trash', 15)}</button>`;
  }

  function render() {
    const q = $('#q').value.trim().toLowerCase();
    const list = items.filter((d) => !q || d.filename.toLowerCase().includes(q) || d.url.toLowerCase().includes(q));
    const box = $('#list');
    if (!list.length) {
      box.innerHTML = `<div class="empty">${icon('download', 32)}${esc(t(q ? 'dlp.noResults' : 'dl.empty'))}</div>`;
      return;
    }
    box.innerHTML = list
      .map((d) => {
        const ext = (d.filename.split('.').pop() || '').slice(0, 4);
        const pct = d.total ? Math.round((d.received / d.total) * 100) : 30;
        return `<div class="list-row state-${esc(d.state)} ${d.exists === false ? 'gone' : ''}" data-id="${esc(d.id)}">
          <div class="file-ic">${esc(ext)}</div>
          <div class="grow"><div class="title" title="${esc(d.path || d.filename)}">${esc(d.filename)}</div><div class="sub">${esc(sub(d))}</div>
          ${d.state === 'progressing' ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}</div>
          <div class="actions">${actions(d)}</div></div>`;
      })
      .join('');
  }

  async function load() {
    items = await call('downloads.list');
    render();
  }

  $('#list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-op]');
    if (!btn) return;
    const id = btn.closest('.list-row').dataset.id;
    await call(`downloads.${btn.dataset.op}`, id);
    load();
  });
  $('#q').addEventListener('input', render);
  $('#clear').addEventListener('click', async () => {
    await call('downloads.clear');
    load();
  });
  $('#open-folder').addEventListener('click', () => call('downloads.openFolder'));

  let pending = false;
  window.Page.onEvent((type) => {
    if (type !== 'downloads' || pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      load();
    }, 300);
  });
  load();
})();
