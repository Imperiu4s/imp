'use strict';
(async () => {
  const { t, call, esc, icon, toast } = window.Page;
  const $ = (s) => document.querySelector(s);
  let logins = [];
  let never = [];
  let editing = null;
  const revealed = new Map(); // id -> password shown in the list

  await window.Page.init();

  // A coloured letter for each site (no network request for favicons).
  function avatar(host) {
    let h = 0;
    for (const c of host) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `<span class="avatar" style="background:hsl(${h} 55% 52%)">${esc((host.replace(/^www\./, '')[0] || '?'))}</span>`;
  }

  function renderItems() {
    const q = $('#q').value.trim().toLowerCase();
    const list = q ? logins.filter((l) => l.host.toLowerCase().includes(q) || l.username.toLowerCase().includes(q)) : logins;
    $('#count').textContent = t('pwm.count', { n: logins.length });
    $('#delete-all').hidden = !logins.length;
    const box = $('#items');
    if (!list.length) {
      box.innerHTML = `<div class="empty">${icon('password', 32)}${esc(t(q ? 'pwm.noResults' : 'pwm.empty'))}</div>`;
      return;
    }
    box.innerHTML = list
      .map((l) => {
        const shown = revealed.has(l.id);
        return `<div class="list-row pw-row" data-id="${l.id}">${avatar(l.host)}
          <div class="grow"><div class="title">${esc(l.host)}</div><div class="sub">${esc(l.username || t('pw.noUsername'))}</div></div>
          <span class="secret ${shown ? 'shown' : ''}">${shown ? esc(revealed.get(l.id)) : '••••••••••'}</span>
          <div class="actions">
            <button class="icon-btn keep" data-act="reveal" title="${esc(t(shown ? 'pw.hide' : 'pw.show'))}">${icon(shown ? 'eyeOff' : 'eye', 16)}</button>
            <button class="icon-btn" data-act="copy-user" title="${esc(t('pwm.copyUser'))}">${icon('copy', 15)}</button>
            <button class="icon-btn" data-act="copy-pass" title="${esc(t('pwm.copyPass'))}">${icon('key', 15)}</button>
            <button class="icon-btn" data-act="edit" title="${esc(t('pwm.edit'))}">${icon('edit', 15)}</button>
            <button class="icon-btn" data-act="delete" title="${esc(t('common.delete'))}">${icon('trash', 15)}</button>
          </div></div>`;
      })
      .join('');
  }

  function renderNever() {
    $('#never-box').hidden = !never.length;
    $('#never').innerHTML = never
      .map(
        (o) => `<div class="list-row never-row"><span class="fav">${icon('globe', 18)}</span><div class="grow">${esc(o.replace(/^https?:\/\//, ''))}</div>
        <button class="btn small" data-never="${esc(o)}">${esc(t('common.remove'))}</button></div>`,
      )
      .join('');
  }

  function render() {
    renderItems();
    renderNever();
  }

  async function load() {
    const data = await call('passwords.list');
    logins = data.logins;
    never = data.never;
    for (const id of revealed.keys()) if (!logins.some((l) => l.id === id)) revealed.delete(id);
    render();
  }

  // ---- edit / add dialog ----
  const setEye = (show) => {
    $('#f-pass').type = show ? 'text' : 'password';
    $('#f-eye').innerHTML = icon(show ? 'eyeOff' : 'eye', 16);
    $('#f-eye').title = t(show ? 'pw.hide' : 'pw.show');
  };

  async function openEditor(login) {
    editing = login || null;
    $('#edit-title').textContent = t(login ? 'pwm.edit' : 'pwm.add');
    $('#f-url').value = login ? login.origin : '';
    $('#f-user').value = login ? login.username : '';
    $('#f-pass').value = login ? (await call('passwords.reveal', login.id)) || '' : '';
    $('#f-pass').required = !login;
    setEye(false);
    $('#edit').showModal();
    (login ? $('#f-pass') : $('#f-url')).focus();
  }

  $('#f-eye').addEventListener('click', () => setEye($('#f-pass').type === 'password'));
  $('#edit-cancel').addEventListener('click', () => $('#edit').close());
  $('#edit').addEventListener('close', () => {
    $('#f-pass').value = '';
  });
  $('#edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let url = $('#f-url').value.trim();
    if (url && !/^[a-z]+:\/\//i.test(url)) url = `https://${url}`;
    const username = $('#f-user').value;
    const password = $('#f-pass').value;
    const ok = editing
      ? await call('passwords.update', editing.id, { url, username, password: password || undefined })
      : await call('passwords.add', { url, username, password });
    if (!ok) return toast(t('pwm.invalidUrl'));
    if (editing) revealed.delete(editing.id);
    $('#edit').close();
  });

  // ---- list actions ----
  $('#items').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.closest('.pw-row').dataset.id);
    const login = logins.find((l) => l.id === id);
    if (!login) return;
    switch (btn.dataset.act) {
      case 'reveal':
        if (revealed.has(id)) revealed.delete(id);
        else revealed.set(id, (await call('passwords.reveal', id)) ?? '');
        return renderItems();
      case 'copy-user':
      case 'copy-pass':
        if (await call('passwords.copy', id, btn.dataset.act === 'copy-user' ? 'username' : 'password')) toast(t('pwm.copied'));
        return;
      case 'edit':
        return openEditor(login);
      case 'delete':
        if (confirm(t('pwm.deleteConfirm', { site: login.host }))) await call('passwords.remove', id);
        return;
      default:
    }
  });

  $('#never').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-never]');
    if (btn) call('passwords.removeNever', btn.dataset.never);
  });

  $('#q').addEventListener('input', renderItems);
  $('#add').addEventListener('click', () => openEditor(null));
  $('#delete-all').addEventListener('click', async () => {
    if (confirm(t('pwm.deleteAllConfirm', { n: logins.length }))) await call('passwords.removeAll');
  });
  $('#import').addEventListener('click', async () => {
    const res = await call('passwords.importCsv');
    if (!res) return;
    toast(res.error ? t('pwm.importFailed') : t('pwm.imported', res));
  });
  $('#export').addEventListener('click', async () => {
    if (!logins.length || !confirm(t('pwm.exportConfirm'))) return;
    if (await call('passwords.exportCsv')) toast(t('pwm.exported'));
  });

  window.Page.onEvent((type) => {
    if (type === 'passwords') load();
  });
  window.Page.onSettings(render);
  load();
})();
