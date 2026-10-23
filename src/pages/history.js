'use strict';
(async () => {
  const { t, call, esc, icon, hostOf, faviconHtml, fixImages } = window.Page;
  const $ = (s) => document.querySelector(s);
  const PAGE = 150;
  let rows = [];
  let query = '';
  let exhausted = false;

  await window.Page.init();

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(Date.now() - 864e5);
    if (d.toDateString() === today.toDateString()) return t('hist.today');
    if (d.toDateString() === yesterday.toDateString()) return t('hist.yesterday');
    return d.toLocaleDateString(window.Page.lang, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  function render() {
    const list = $('#list');
    if (!rows.length) {
      list.innerHTML = `<div class="empty">${icon('history', 32)}${esc(t(query ? 'hist.noResults' : 'hist.empty'))}</div>`;
      $('#more').hidden = true;
      return;
    }
    let html = '';
    let currentDay = null;
    let open = false;
    for (const r of rows) {
      const day = dayLabel(r.time);
      if (day !== currentDay) {
        if (open) html += '</div>';
        html += `<div class="group-title">${esc(day)}</div><div class="card list">`;
        open = true;
        currentDay = day;
      }
      const time = new Date(r.time).toLocaleTimeString(window.Page.lang, { hour: '2-digit', minute: '2-digit' });
      html += `<div class="list-row" data-id="${r.id}" data-url="${esc(r.url)}">
        <span class="muted" style="width:46px;font-size:12.5px;font-variant-numeric:tabular-nums">${esc(time)}</span>
        <span class="fav">${faviconHtml(r.favicon)}</span>
        <a class="grow" href="${esc(r.url)}" title="${esc(r.url)}"><div class="title">${esc(r.title || r.url)}</div><div class="sub">${esc(hostOf(r.url))}</div></a>
        <div class="actions">
          <button class="icon-btn" data-act="site" title="${esc(t('hist.moreFromSite'))}">${icon('search', 15)}</button>
          <button class="icon-btn" data-act="delete" title="${esc(t('hist.remove'))}">${icon('trash', 15)}</button>
        </div></div>`;
    }
    if (open) html += '</div>';
    list.innerHTML = html;
    fixImages(list);
    $('#more').hidden = exhausted;
  }

  async function load(reset = true) {
    const before = reset || !rows.length ? Date.now() + 1 : rows[rows.length - 1].time;
    const batch = await call('history.list', { query, before, limit: PAGE });
    rows = reset ? batch : rows.concat(batch);
    exhausted = batch.length < PAGE;
    render();
  }

  let timer = 0;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = e.target.value.trim();
      load(true);
    }, 150);
  });
  $('#more-btn').addEventListener('click', () => load(false));
  $('#list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.preventDefault();
    const row = btn.closest('.list-row');
    if (btn.dataset.act === 'delete') {
      await call('history.deleteVisit', Number(row.dataset.id));
      rows = rows.filter((r) => r.id !== Number(row.dataset.id));
      render();
    } else {
      $('#q').value = hostOf(row.dataset.url);
      query = $('#q').value;
      load(true);
    }
  });
  window.Page.onEvent((type) => {
    if (type === 'refresh' && !query && document.hidden === false) load(true);
  });

  load(true);
})();
