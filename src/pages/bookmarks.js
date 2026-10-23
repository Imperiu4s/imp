'use strict';
(async () => {
  const { t, call, esc, icon, hostOf, faviconHtml, fixImages, toast } = window.Page;
  const $ = (s) => document.querySelector(s);
  let items = [];
  let folder = 'bar';
  let editing = null;
  let dragId = null;

  await window.Page.init();

  const isFolder = (b) => b.type === 'folder';
  const children = (parent) => items.filter((b) => String(b.parent) === String(parent));
  const folderName = (id) => (id === 'bar' ? t('bm.bar') : id === 'other' ? t('bm.other') : items.find((b) => b.id === id)?.title || '');

  function folderTree(parent, depth, out) {
    for (const f of children(parent).filter(isFolder)) {
      out.push({ id: f.id, title: f.title, depth });
      folderTree(f.id, depth + 1, out);
    }
    return out;
  }

  function allFolders() {
    return [
      { id: 'bar', title: t('bm.bar'), depth: 0 },
      ...folderTree('bar', 1, []),
      { id: 'other', title: t('bm.other'), depth: 0 },
      ...folderTree('other', 1, []),
    ];
  }

  function renderFolders() {
    $('#folders').innerHTML = allFolders()
      .map(
        (f) =>
          `<button class="folder ${f.depth ? 'sub' : ''} ${String(f.id) === String(folder) ? 'on' : ''}" data-folder="${f.id}" style="${f.depth > 1 ? `padding-left:${10 + f.depth * 18}px` : ''}">${icon(f.id === 'bar' ? 'star' : 'folder', 16)}<span>${esc(f.title)}</span></button>`,
      )
      .join('');
  }

  function renderItems() {
    const q = $('#q').value.trim().toLowerCase();
    const list = q
      ? items.filter((b) => !isFolder(b) && (b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)))
      : children(folder);
    const box = $('#items');
    if (!list.length) {
      box.innerHTML = `<div class="empty">${icon('bookmark', 32)}${esc(t(q ? 'bmk.noResults' : 'bmk.empty'))}</div>`;
      return;
    }
    box.innerHTML = list
      .map((b) =>
        isFolder(b)
          ? `<div class="list-row" data-id="${b.id}" draggable="true"><span class="fav">${icon('folder', 18)}</span>
            <a class="grow" href="#" data-open-folder="${b.id}"><div class="title">${esc(b.title)}</div><div class="sub">${esc(t('bmk.items', { n: children(b.id).length }))}</div></a>
            <div class="actions"><button class="icon-btn" data-act="edit" title="${esc(t('bmk.edit'))}">${icon('edit', 15)}</button>
            <button class="icon-btn" data-act="delete" title="${esc(t('common.delete'))}">${icon('trash', 15)}</button></div></div>`
          : `<div class="list-row" data-id="${b.id}" draggable="${q ? 'false' : 'true'}"><span class="fav">${faviconHtml(b.favicon)}</span>
            <a class="grow" href="${esc(b.url)}" title="${esc(b.url)}"><div class="title">${esc(b.title || b.url)}</div><div class="sub">${esc(hostOf(b.url))}${q ? ` · ${esc(folderName(b.parent))}` : ''}</div></a>
            <div class="actions"><button class="icon-btn" data-act="edit" title="${esc(t('bmk.edit'))}">${icon('edit', 15)}</button>
            <button class="icon-btn" data-act="delete" title="${esc(t('common.delete'))}">${icon('trash', 15)}</button></div></div>`,
      )
      .join('');
    fixImages(box);
  }

  function render() {
    renderFolders();
    renderItems();
  }

  async function load() {
    items = await call('bookmarks.list');
    if (folder !== 'bar' && folder !== 'other' && !items.some((b) => b.id === folder)) folder = 'bar';
    render();
  }

  function openEditor(item, type = 'bookmark') {
    editing = item ? { ...item } : { type, parent: folder };
    $('#edit-title').textContent = t(item ? (item.type === 'folder' ? 'bmk.editFolder' : 'bmk.edit') : type === 'folder' ? 'bmk.addFolder' : 'bmk.add');
    $('#f-title').value = item?.title || '';
    $('#f-url').value = item?.url || '';
    $('#url-label').hidden = editing.type === 'folder';
    $('#f-url').required = editing.type !== 'folder';
    $('#f-parent').innerHTML = allFolders()
      .filter((f) => !item || f.id !== item.id)
      .map((f) => `<option value="${f.id}" ${String(f.id) === String(editing.parent) ? 'selected' : ''}>${'— '.repeat(f.depth)}${esc(f.title)}</option>`)
      .join('');
    $('#edit').showModal();
    $('#f-title').focus();
  }

  $('#edit-cancel').addEventListener('click', () => $('#edit').close());
  $('#edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = $('#f-parent').value;
    const parent = raw === 'bar' || raw === 'other' ? raw : Number(raw);
    let url = $('#f-url').value.trim();
    if (url && !/^[a-z]+:/i.test(url)) url = `https://${url}`;
    const title = $('#f-title').value.trim();
    if (editing.id) await call('bookmarks.update', editing.id, { title, url: editing.type === 'folder' ? undefined : url, parent });
    else await call('bookmarks.add', { type: editing.type, title, url, parent });
    $('#edit').close();
  });

  $('#folders').addEventListener('click', (e) => {
    const b = e.target.closest('[data-folder]');
    if (!b) return;
    const raw = b.dataset.folder;
    folder = raw === 'bar' || raw === 'other' ? raw : Number(raw);
    $('#q').value = '';
    render();
  });

  $('#items').addEventListener('click', async (e) => {
    const openFolder = e.target.closest('[data-open-folder]');
    if (openFolder) {
      e.preventDefault();
      folder = Number(openFolder.dataset.openFolder);
      return render();
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.preventDefault();
    const id = Number(btn.closest('.list-row').dataset.id);
    const item = items.find((b) => b.id === id);
    if (btn.dataset.act === 'edit') openEditor(item);
    else if (btn.dataset.act === 'delete') {
      if (isFolder(item) && children(id).length && !confirm(t('bmk.deleteFolderConfirm'))) return;
      await call('bookmarks.remove', id);
    }
  });

  // drag to reorder within the folder (or drop onto a folder in the sidebar)
  $('#items').addEventListener('dragstart', (e) => {
    const row = e.target.closest('.list-row');
    dragId = row ? Number(row.dataset.id) : null;
  });
  $('#items').addEventListener('dragover', (e) => {
    if (dragId == null) return;
    e.preventDefault();
    document.querySelectorAll('.drop-before').forEach((el) => el.classList.remove('drop-before'));
    e.target.closest('.list-row')?.classList.add('drop-before');
  });
  $('#items').addEventListener('drop', async (e) => {
    e.preventDefault();
    const row = e.target.closest('.list-row');
    document.querySelectorAll('.drop-before').forEach((el) => el.classList.remove('drop-before'));
    if (dragId == null) return;
    const beforeId = row ? Number(row.dataset.id) : null;
    if (beforeId !== dragId) await call('bookmarks.move', dragId, folder, beforeId);
    dragId = null;
  });
  $('#folders').addEventListener('dragover', (e) => {
    if (dragId != null && e.target.closest('[data-folder]')) e.preventDefault();
  });
  $('#folders').addEventListener('drop', async (e) => {
    const target = e.target.closest('[data-folder]');
    if (!target || dragId == null) return;
    e.preventDefault();
    const raw = target.dataset.folder;
    const parent = raw === 'bar' || raw === 'other' ? raw : Number(raw);
    if (parent !== dragId) await call('bookmarks.move', dragId, parent, null);
    dragId = null;
  });

  $('#q').addEventListener('input', renderItems);
  $('#add-bm').addEventListener('click', () => openEditor(null, 'bookmark'));
  $('#add-folder').addEventListener('click', () => openEditor(null, 'folder'));
  $('#import').addEventListener('click', async () => {
    const n = await call('bookmarks.importHtml');
    if (n >= 0) toast(t('set.import.done', { n }));
  });
  $('#export').addEventListener('click', async () => {
    if (await call('bookmarks.exportHtml')) toast(t('set.export.done'));
  });

  window.Page.onEvent((type) => {
    if (type === 'bookmarks') load();
  });
  window.Page.onSettings(render);
  load();
})();
