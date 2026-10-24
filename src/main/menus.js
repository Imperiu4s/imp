'use strict';
// Native context menus for pages, tabs and bookmarks.
const { Menu, clipboard } = require('electron');
const bookmarks = require('./bookmarks');
const downloads = require('./downloads');
const omnibox = require('./omnibox');
const { t } = require('./i18n');

const SEP = { type: 'separator' };

function clean(items) {
  // drop leading/trailing/double separators
  const out = [];
  for (const item of items.filter(Boolean)) {
    if (item.type === 'separator' && (!out.length || out[out.length - 1].type === 'separator')) continue;
    out.push(item);
  }
  while (out.length && out[out.length - 1].type === 'separator') out.pop();
  return out;
}

function popup(win, items) {
  const template = clean(items);
  if (!template.length) return;
  Menu.buildFromTemplate(template).popup({ window: win.win });
}

function shorten(text, n = 28) {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function page(win, tab, p) {
  const wc = tab.wc;
  if (!wc) return;
  const items = [];
  const frame = p.frame && p.frame !== wc.mainFrame ? p.frame : null;

  if (p.misspelledWord) {
    for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
    if (!p.dictionarySuggestions.length) items.push({ label: t('menu.noSuggestions'), enabled: false });
    items.push({ label: t('menu.addToDictionary'), click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, SEP);
  }

  if (p.linkURL) {
    const link = p.linkURL;
    items.push(
      { label: t('menu.openLinkNewTab'), click: () => win.createTab({ url: link, active: false, index: win.indexAfterOpener(tab), openerId: tab.id }) },
      { label: t('menu.openLinkNewWindow'), click: () => win.manager.createWindow({ url: link }) },
      { label: t('menu.openLinkPrivate'), click: () => win.manager.createWindow({ url: link, private: true }) },
      {
        label: t('menu.openLinkSplit'),
        click: () => {
          const other = win.createTab({ url: link, active: false, index: win.indexAfterOpener(tab), openerId: tab.id });
          if (win.split) win.split = null;
          win.toggleSplit(other.id);
        },
      },
      SEP,
      { label: t('menu.copyLink'), click: () => clipboard.writeText(link) },
      { label: t('menu.saveLinkAs'), click: () => wc.downloadURL(link) },
      SEP,
    );
  }

  if (p.mediaType === 'image' && p.srcURL) {
    const src = p.srcURL;
    items.push(
      { label: t('menu.openImageNewTab'), click: () => win.createTab({ url: src, active: false, index: win.indexAfterOpener(tab), openerId: tab.id }) },
      { label: t('menu.saveImageAs'), click: () => wc.downloadURL(src) },
      { label: t('menu.copyImage'), click: () => wc.copyImageAt(p.x, p.y) },
      { label: t('menu.copyImageAddress'), click: () => clipboard.writeText(src) },
      SEP,
    );
  }

  if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL) {
    if (p.mediaType === 'video') {
      items.push({
        label: t('menu.pip'),
        click: () => {
          const code = frame
            ? `(document.querySelector('video') || {}).requestPictureInPicture?.()`
            : `(() => { const el = document.elementFromPoint(${p.x}, ${p.y}); const v = (el && (el.closest('video') || el.querySelector?.('video'))) || document.querySelector('video'); return v && v.requestPictureInPicture(); })()`;
          (frame || wc).executeJavaScript(code, true).catch(() => {});
        },
      });
    }
    if (!p.srcURL.startsWith('blob:')) {
      items.push(
        { label: t(p.mediaType === 'video' ? 'menu.saveVideoAs' : 'menu.saveAudioAs'), click: () => wc.downloadURL(p.srcURL) },
        { label: t('menu.copyMediaAddress'), click: () => clipboard.writeText(p.srcURL) },
      );
    }
    items.push(SEP);
  }

  if (p.isEditable) {
    const f = p.editFlags;
    items.push(
      { label: t('menu.undo'), enabled: f.canUndo, click: () => wc.undo() },
      { label: t('menu.redo'), enabled: f.canRedo, click: () => wc.redo() },
      SEP,
      { label: t('menu.cut'), enabled: f.canCut, click: () => wc.cut() },
      { label: t('menu.copy'), enabled: f.canCopy, click: () => wc.copy() },
      { label: t('menu.paste'), enabled: f.canPaste, click: () => wc.paste() },
      { label: t('menu.pastePlain'), enabled: f.canPaste, click: () => wc.pasteAndMatchStyle() },
      { label: t('menu.selectAll'), enabled: f.canSelectAll, click: () => wc.selectAll() },
      SEP,
    );
  } else if (p.selectionText && p.selectionText.trim()) {
    const text = p.selectionText.trim();
    items.push(
      { label: t('menu.copy'), click: () => wc.copy() },
      {
        label: t('menu.searchFor', { engine: omnibox.engine().name, text: shorten(text) }),
        click: () => win.createTab({ url: omnibox.searchUrl(text), index: win.indexAfterOpener(tab), openerId: tab.id }),
      },
      SEP,
    );
  }

  if (!p.linkURL && !p.isEditable && !p.selectionText && p.mediaType === 'none') {
    const nh = wc.navigationHistory;
    items.push(
      { label: t('menu.back'), enabled: nh.canGoBack(), click: () => tab.goBack() },
      { label: t('menu.forward'), enabled: nh.canGoForward(), click: () => tab.goForward() },
      { label: t('menu.reload'), click: () => tab.reload() },
      SEP,
      { label: t('menu.savePageAs'), click: () => win.savePage(tab) },
      { label: t('menu.print'), click: () => wc.print() },
      { label: t('menu.capture'), click: () => win.screenshot(tab, false) },
      { label: t('menu.captureFull'), click: () => win.screenshot(tab, true) },
      tab.readerable ? { label: t('menu.reader'), click: () => win.toggleReader(tab) } : null,
      /^https?:/.test(tab.url) ? { label: t('menu.translate'), click: () => win.command('translate') } : null,
      /^https?:/.test(tab.url) ? { label: t('menu.viewSource'), click: () => win.command('view-source') } : null,
      SEP,
    );
  }

  items.push({ label: t('menu.inspect'), click: () => wc.inspectElement(p.x, p.y) });
  popup(win, items);
}

function tab(win, tabObj) {
  if (!tabObj) return;
  const id = tabObj.id;
  const inSplit = win.isInSplit(tabObj);
  const idx = win.tabs.indexOf(tabObj);
  popup(win, [
    { label: t('menu.newTabRight'), click: () => win.createTab({ index: idx + 1 }) },
    SEP,
    { label: t('menu.reload'), click: () => tabObj.reload() },
    { label: t('menu.duplicate'), click: () => win.duplicateTab(id) },
    { label: t(tabObj.pinned ? 'menu.unpin' : 'menu.pin'), click: () => win.pinTab(id, !tabObj.pinned) },
    { label: t(tabObj.muted ? 'menu.unmute' : 'menu.mute'), click: () => tabObj.setMuted(!tabObj.muted) },
    tabObj.url.startsWith('http') && !win.isPrivate
      ? {
          label: t(bookmarks.findByUrl(tabObj.url) ? 'menu.removeBookmark' : 'menu.bookmarkTab'),
          click: () => bookmarks.toggle(tabObj.url, tabObj.title),
        }
      : null,
    SEP,
    inSplit
      ? { label: t('menu.exitSplit'), click: () => win.toggleSplit() }
      : id !== win.activeId
        ? {
            label: t('menu.openInSplit'),
            click: () => {
              win.split = null;
              win.toggleSplit(id);
            },
          }
        : null,
    id !== win.activeId && !inSplit && !tabObj.sleeping ? { label: t('menu.sleepTab'), click: () => win.sleepTab(id) } : null,
    !win.isPrivate && win.tabs.length > 1 ? { label: t('menu.moveToNewWindow'), click: () => win.moveTabToNewWindow(id) } : null,
    SEP,
    { label: t('menu.closeTab'), click: () => win.closeTab(id) },
    { label: t('menu.closeOthers'), enabled: win.tabs.length > 1, click: () => win.closeOtherTabs(id) },
    { label: t('menu.closeRight'), enabled: idx < win.tabs.length - 1, click: () => win.closeTabsToRight(id) },
    SEP,
    { label: t('menu.reopenClosed'), enabled: win.manager.closedTabs.length > 0, click: () => win.manager.reopenClosed(win) },
  ]);
}

function bookmark(win, id) {
  const item = bookmarks.find(id);
  if (!item) return;
  if (item.type === 'folder') {
    const children = bookmarks.list().filter((b) => b.parent === id && b.type === 'bookmark');
    popup(win, [
      {
        label: t('menu.openAll', { n: children.length }),
        enabled: children.length > 0,
        click: () => children.forEach((c, i) => win.createTab({ url: c.url, active: i === 0 })),
      },
      SEP,
      { label: t('menu.editBookmarks'), click: () => win.openInternal('bookmarks') },
      { label: t('menu.delete'), click: () => bookmarks.remove(id) },
    ]);
    return;
  }
  popup(win, [
    { label: t('menu.open'), click: () => win.activeTab()?.load(item.url) },
    { label: t('menu.openLinkNewTab'), click: () => win.createTab({ url: item.url, active: false }) },
    { label: t('menu.openLinkNewWindow'), click: () => win.manager.createWindow({ url: item.url }) },
    { label: t('menu.openLinkPrivate'), click: () => win.manager.createWindow({ url: item.url, private: true }) },
    SEP,
    { label: t('menu.copyLink'), click: () => clipboard.writeText(item.url) },
    { label: t('menu.editBookmarks'), click: () => win.openInternal('bookmarks') },
    { label: t('menu.delete'), click: () => bookmarks.remove(id) },
  ]);
}

// The ^ button of an item on the download bar.
function download(win, id) {
  const d = downloads.find(id);
  if (!d) return;
  const running = d.state === 'progressing';
  const done = d.state === 'completed' && (!d.path || require('node:fs').existsSync(d.path));
  popup(win, [
    done && { label: t('menu.open'), click: () => downloads.open(id) },
    done && { label: t('dl.show'), click: () => downloads.show(id) },
    running && { label: t(d.paused ? 'dl.resume' : 'dl.pause'), click: () => downloads.pause(id) },
    running && { label: t('dl.cancel'), click: () => downloads.cancel(id) },
    SEP,
    !running && { label: t('dl.remove'), click: () => downloads.remove(id) },
    { label: t('dl.all'), click: () => win.openInternal('downloads') },
  ]);
}

module.exports = { page, tab, bookmark, download };
