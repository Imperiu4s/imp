'use strict';
(async () => {
  const { t, call, esc, icon, fmtBytes, faviconHtml, fixImages } = window.Page;
  const $ = (s) => document.querySelector(s);

  await window.Page.init();

  const KB = 1024;
  const typeName = (p) => {
    if (p.ui) return t('perf.p.ui');
    switch (p.type) {
      case 'Browser':
        return t('perf.p.browser');
      case 'GPU':
        return t('perf.p.gpu');
      case 'Utility':
        return `${t('perf.p.utility')}${p.name ? ` · ${p.name}` : ''}`;
      case 'Tab':
        return t('perf.p.renderer');
      default:
        return p.type;
    }
  };

  async function refresh() {
    const m = await call('perf.metrics');
    // Private memory is what each process really costs (working set double-counts shared pages).
    for (const p of m.processes) if (p.privateMemory) p.memory = p.privateMemory;
    const byPid = new Map(m.processes.map((p) => [p.pid, p]));
    const total = m.processes.reduce((s, p) => s + p.memory, 0) * KB;
    const sleeping = m.tabs.filter((x) => x.sleeping).length;
    $('#m-mem').textContent = fmtBytes(total);
    $('#m-tabs').textContent = String(m.tabs.length);
    $('#m-sleep').textContent = String(sleeping);
    $('#m-eff').textContent = t(m.efficiency ? 'perf.on' : 'perf.off');

    // tabs sharing a renderer process are listed with the process total
    const maxMem = Math.max(1, ...m.tabs.map((x) => byPid.get(x.pid)?.memory || 0));
    const tabRows = m.tabs
      .sort((a, b) => (byPid.get(b.pid)?.memory || 0) - (byPid.get(a.pid)?.memory || 0))
      .map((x) => {
        const p = byPid.get(x.pid);
        const mem = p ? p.memory * KB : 0;
        const status = x.sleeping
          ? `<span class="pill sleep">${esc(t('perf.status.sleeping'))}</span>`
          : x.active
            ? `<span class="pill active">${esc(t('perf.status.active'))}</span>`
            : `<span class="pill">${esc(t('perf.status.background'))}</span>`;
        return `<tr data-id="${x.id}"><td class="name"><div class="title"><span class="fav">${faviconHtml(x.favicon, 16)}</span><span title="${esc(x.url)}">${esc(x.title)}</span>${x.private ? icon('incognito', 14) : ''}</div>
          ${mem ? `<div class="bar" style="width:${Math.max(2, (p.memory / maxMem) * 100)}%"></div>` : ''}</td>
          <td>${status}</td>
          <td class="num">${x.sleeping ? '—' : esc(fmtBytes(mem))}</td>
          <td class="num">${x.sleeping || !p ? '—' : `${p.cpu.toFixed(1)}%`}</td>
          <td class="act">
            <button class="icon-btn" data-act="go" title="${esc(t('perf.go'))}">${icon('external', 15)}</button>
            ${!x.sleeping && !x.active ? `<button class="icon-btn" data-act="sleep" title="${esc(t('perf.sleep'))}">${icon('moon', 15)}</button>` : ''}
            <button class="icon-btn" data-act="close" title="${esc(t('perf.close'))}">${icon('close', 15)}</button></td></tr>`;
      })
      .join('');
    $('#tabs').innerHTML = `<tr><th>${esc(t('perf.col.tab'))}</th><th>${esc(t('perf.col.status'))}</th><th class="num">${esc(t('perf.col.memory'))}</th><th class="num">CPU</th><th></th></tr>${tabRows}`;
    fixImages($('#tabs'));

    const tabPids = new Set(m.tabs.map((x) => x.pid).filter(Boolean));
    const procRows = m.processes
      .filter((p) => !tabPids.has(p.pid))
      .sort((a, b) => b.memory - a.memory)
      .map((p) => `<tr><td class="name">${esc(typeName(p))}</td><td class="num">${esc(String(p.pid))}</td><td class="num">${esc(fmtBytes(p.memory * KB))}</td><td class="num">${p.cpu.toFixed(1)}%</td></tr>`)
      .join('');
    $('#procs').innerHTML = `<tr><th>${esc(t('perf.col.process'))}</th><th class="num">PID</th><th class="num">${esc(t('perf.col.memory'))}</th><th class="num">CPU</th></tr>${procRows}`;
  }

  $('#tabs').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.closest('tr').dataset.id);
    if (btn.dataset.act === 'sleep') await call('perf.sleepTab', id);
    else if (btn.dataset.act === 'close') await call('perf.closeTab', id);
    else await call('perf.activateTab', id);
    refresh();
  });
  $('#sleep-all').addEventListener('click', async () => {
    const n = await call('perf.sleepAll');
    window.Page.toast(t('perf.sleptN', { n }));
    refresh();
  });

  refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 2000);
})();
