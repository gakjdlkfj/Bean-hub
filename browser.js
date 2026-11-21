import {
  SEARCH_ENGINES,
  loadBookmarks,
  saveBookmarks,
  encodeProxyUrlClient
} from './storage.js';

const BEAN_QUOTES = [
  'Teddy approves of your stealth browsing.',
  'Minimalist green Mini Cooper energy.',
  'Zero trackers. Pure Bean velocity.',
  'Press Ctrl+K anytime for the Bean Command Palette.',
  'Keep calm and hit the Panic Key if needed.'
];

export class TabbedBrowser {
  constructor(options) {
    this.el = options.elements;
    this.getSettings = options.getSettings;
    this.onToast = options.onToast;
    this.onSwitchToGames = options.onSwitchToGames;
    this.proxyPrefix = '/proxy/';

    this.tabs = [];
    this.activeTabId = null;
    this.bookmarks = loadBookmarks();
    this.nextTabNum = 1;

    this.bindEvents();
    this.renderBookmarksBar();
    this.createTab(null, { activate: true });
  }

  setProxyPrefix(prefix) {
    if (prefix) this.proxyPrefix = prefix;
  }

  bindEvents() {
    this.el.newTabBtn.addEventListener('click', () => this.createTab(null, { activate: true }));
    this.el.backBtn.addEventListener('click', () => this.goBack());
    this.el.forwardBtn.addEventListener('click', () => this.goForward());
    this.el.reloadBtn.addEventListener('click', () => this.reloadActive());
    this.el.homeBtn.addEventListener('click', () => this.goHome());
    this.el.bookmarkBtn.addEventListener('click', () => this.toggleBookmarkForActive());
    this.el.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    this.el.copyUrlBtn.addEventListener('click', () => this.copyActiveUrl());

    this.el.omniboxForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.el.omniboxInput.value.trim();
      if (input) {
        this.navigateActive(input);
      }
    });

    this.el.omniboxInput.addEventListener('focus', () => {
      this.el.omniboxInput.select();
    });

    // Sync tab title & URL when proxied iframe sends postMessage from __proxy_hook.js
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.type !== 'BEAN_PROXY_NAV') return;

      const tab = this.tabs.find((t) => t.iframe && t.iframe.contentWindow === event.source);
      if (!tab) return;

      if (data.title) {
        tab.title = data.title;
      }
      if (data.url && data.url !== tab.url) {
        tab.url = data.url;
        const currentHistUrl = tab.history[tab.historyIndex];
        if (currentHistUrl !== data.url) {
          tab.history = tab.history.slice(0, tab.historyIndex + 1);
          tab.history.push(data.url);
          tab.historyIndex = tab.history.length - 1;
        }
      }
      tab.loading = false;
      this.renderTabs();
      if (tab.id === this.activeTabId) {
        this.syncToolbar();
      }
    });
  }

  /**
   * Resolve user omnibox input into either a valid URL or a search engine query URL.
   */
  resolveInputToUrl(rawInput) {
    const trimmed = rawInput.trim();
    if (!trimmed) return null;

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    // Domain-like pattern (e.g. "wikipedia.org", "news.ycombinator.com/newest", no spaces)
    const looksLikeDomain =
      !trimmed.includes(' ') &&
      /^[a-z0-9-]+(\.[a-z0-9-]+)+([:/?#].*)?$/i.test(trimmed);

    if (looksLikeDomain) {
      return `https://${trimmed}`;
    }

    const engineKey = this.getSettings().searchEngine || 'duckduckgo';
    const engine = SEARCH_ENGINES[engineKey] || SEARCH_ENGINES.duckduckgo;
    return engine.template.replace('{q}', encodeURIComponent(trimmed));
  }

  createTab(initialUrl = null, { activate = true } = {}) {
    const id = `tab-${Date.now()}-${this.nextTabNum++}`;
    const tab = {
      id,
      title: 'New Tab',
      url: null,
      history: [],
      historyIndex: -1,
      loading: false,
      iframe: null
    };

    this.tabs.push(tab);

    if (activate) {
      this.activateTab(id);
    } else {
      this.renderTabs();
    }

    if (initialUrl) {
      this.navigateTab(tab, initialUrl);
    }

    return tab;
  }

  activateTab(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;

    this.activeTabId = id;

    // Show only the active tab's iframe or the Speed Dial New Tab page
    for (const t of this.tabs) {
      if (t.iframe) {
        t.iframe.classList.toggle('hidden', t.id !== id || !t.url);
      }
    }

    const showNewTab = !tab.url;
    this.el.newTabView.classList.toggle('hidden', !showNewTab);
    if (showNewTab) {
      this.renderSpeedDial();
    }

    this.renderTabs();
    this.syncToolbar();
  }

  closeTab(id) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;

    const [removed] = this.tabs.splice(idx, 1);
    if (removed.iframe) {
      removed.iframe.remove();
    }

    if (this.tabs.length === 0) {
      this.createTab(null, { activate: true });
      return;
    }

    if (this.activeTabId === id) {
      const nextTab = this.tabs[Math.max(0, idx - 1)];
      this.activateTab(nextTab.id);
    } else {
      this.renderTabs();
    }
  }

  getActiveTab() {
    return this.tabs.find((t) => t.id === this.activeTabId) || null;
  }

  navigateActive(rawInput) {
    const tab = this.getActiveTab();
    if (!tab) return;
    this.navigateTab(tab, rawInput);
  }

  navigateTab(tab, rawInput, { pushHistory = true } = {}) {
    const targetUrl = this.resolveInputToUrl(rawInput);
    if (!targetUrl) return;

    if (!tab.iframe) {
      const iframe = document.createElement('iframe');
      iframe.className = 'proxy-frame hidden';
      iframe.setAttribute(
        'sandbox',
        'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-presentation'
      );
      iframe.setAttribute(
        'allow',
        'fullscreen; clipboard-read; clipboard-write; autoplay; encrypted-media'
      );
      iframe.setAttribute('allowfullscreen', '');
      iframe.addEventListener('load', () => {
        tab.loading = false;
        this.renderTabs();
        if (tab.id === this.activeTabId) {
          this.syncToolbar();
        }
      });
      this.el.viewport.appendChild(iframe);
      tab.iframe = iframe;
    }

    tab.url = targetUrl;
    tab.loading = true;
    try {
      tab.title = new URL(targetUrl).hostname.replace(/^www\./, '');
    } catch {
      tab.title = targetUrl;
    }

    if (pushHistory) {
      tab.history = tab.history.slice(0, tab.historyIndex + 1);
      tab.history.push(targetUrl);
      tab.historyIndex = tab.history.length - 1;
    }

    const proxiedSrc = `${this.proxyPrefix}${encodeProxyUrlClient(targetUrl)}`;
    tab.iframe.src = proxiedSrc;

    if (tab.id === this.activeTabId) {
      this.el.newTabView.classList.add('hidden');
      tab.iframe.classList.remove('hidden');
      this.syncToolbar();
    }
    this.renderTabs();
  }

  goBack() {
    const tab = this.getActiveTab();
    if (!tab || tab.historyIndex <= 0) return;
    tab.historyIndex -= 1;
    this.navigateTab(tab, tab.history[tab.historyIndex], { pushHistory: false });
  }

  goForward() {
    const tab = this.getActiveTab();
    if (!tab || tab.historyIndex >= tab.history.length - 1) return;
    tab.historyIndex += 1;
    this.navigateTab(tab, tab.history[tab.historyIndex], { pushHistory: false });
  }

  reloadActive() {
    const tab = this.getActiveTab();
    if (!tab || !tab.url || !tab.iframe) return;
    tab.loading = true;
    this.syncToolbar();
    tab.iframe.src = `${this.proxyPrefix}${encodeProxyUrlClient(tab.url)}`;
  }

  goHome() {
    const tab = this.getActiveTab();
    if (!tab) return;
    tab.url = null;
    tab.title = 'New Tab';
    tab.loading = false;
    if (tab.iframe) {
      tab.iframe.classList.add('hidden');
      tab.iframe.src = 'about:blank';
    }
    this.el.newTabView.classList.remove('hidden');
    this.renderSpeedDial();
    this.renderTabs();
    this.syncToolbar();
  }

  toggleFullscreen() {
    const target = this.el.viewport;
    if (!document.fullscreenElement) {
      target.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  async copyActiveUrl() {
    const tab = this.getActiveTab();
    if (!tab || !tab.url) {
      this.onToast?.('Open a website first to copy its URL.', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(tab.url);
      this.onToast?.('Copied target URL to clipboard.', 'success');
    } catch {
      this.onToast?.('Could not access clipboard.', 'error');
    }
  }

  isBookmarked(url) {
    if (!url) return false;
    return this.bookmarks.some((b) => b.url === url);
  }

  toggleBookmarkForActive() {
    const tab = this.getActiveTab();
    if (!tab || !tab.url) {
      this.onToast?.('Navigate to a page before bookmarking.', 'info');
      return;
    }

    const existingIdx = this.bookmarks.findIndex((b) => b.url === tab.url);
    if (existingIdx >= 0) {
      this.bookmarks.splice(existingIdx, 1);
      this.onToast?.('Removed bookmark.', 'info');
    } else {
      let hostTitle = tab.title;
      try {
        if (!hostTitle || hostTitle === 'New Tab') {
          hostTitle = new URL(tab.url).hostname;
        }
      } catch {
        hostTitle = 'Bookmark';
      }
      this.bookmarks.push({
        id: `bm-${Date.now()}`,
        title: hostTitle.slice(0, 26),
        url: tab.url,
        icon: '🔖'
      });
      this.onToast?.(`Bookmarked "${hostTitle.slice(0, 26)}"`, 'success');
    }

    saveBookmarks(this.bookmarks);
    this.renderBookmarksBar();
    this.renderSpeedDial();
    this.syncToolbar();
  }

  removeBookmark(id) {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    saveBookmarks(this.bookmarks);
    this.renderBookmarksBar();
    this.renderSpeedDial();
    this.syncToolbar();
  }

  syncToolbar() {
    const tab = this.getActiveTab();
    if (!tab) return;

    this.el.omniboxInput.value = tab.url || '';
    this.el.backBtn.disabled = tab.historyIndex <= 0;
    this.el.forwardBtn.disabled = tab.historyIndex >= tab.history.length - 1;
    this.el.reloadBtn.disabled = !tab.url;

    const bookmarked = this.isBookmarked(tab.url);
    this.el.bookmarkBtn.classList.toggle('text-amber-400', bookmarked);
    this.el.bookmarkBtn.classList.toggle('text-slate-400', !bookmarked);
    this.el.bookmarkBtn.title = bookmarked ? 'Remove Bookmark' : 'Add Bookmark';

    this.el.loadingBar.classList.toggle('loading-bar-active', Boolean(tab.loading));
    this.el.loadingBar.classList.toggle('opacity-100', Boolean(tab.loading));
    this.el.loadingBar.classList.toggle('opacity-0', !tab.loading);
  }

  renderTabs() {
    this.el.tabList.innerHTML = '';
    for (const tab of this.tabs) {
      const isActive = tab.id === this.activeTabId;
      const btn = document.createElement('div');
      btn.className = `tab-pill flex items-center gap-2 px-3 py-1.5 rounded-lg border border-transparent cursor-pointer min-w-[130px] max-w-[210px] text-xs shrink-0 ${
        isActive ? 'active' : 'text-slate-400'
      }`;
      btn.innerHTML = `
        <span class="w-2 h-2 rounded-full shrink-0 ${
          tab.loading ? 'bg-amber-400 animate-pulse' : isActive ? 'accent-bg' : 'bg-slate-600'
        }"></span>
        <span class="truncate flex-1 font-medium">${escapeHtml(tab.title || 'New Tab')}</span>
        <button class="tab-close p-0.5 rounded hover:bg-white/10 text-slate-400 hover:text-white leading-none" title="Close tab">&times;</button>
      `;

      btn.addEventListener('click', (e) => {
        if (e.target.closest('.tab-close')) {
          this.closeTab(tab.id);
        } else {
          this.activateTab(tab.id);
        }
      });

      // Middle click to close tab
      btn.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          this.closeTab(tab.id);
        }
      });

      this.el.tabList.appendChild(btn);
    }
  }

  renderBookmarksBar() {
    if (!this.el.bookmarksBar) return;
    this.el.bookmarksBar.innerHTML = '';

    for (const bm of this.bookmarks) {
      const chip = document.createElement('button');
      chip.className =
        'group flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-slate-300 hover:text-white hover:bg-white/10 transition shrink-0';
      chip.innerHTML = `
        <span>${bm.icon || '🌐'}</span>
        <span class="max-w-[120px] truncate">${escapeHtml(bm.title)}</span>
      `;
      chip.title = bm.url;
      chip.addEventListener('click', () => this.navigateActive(bm.url));
      this.el.bookmarksBar.appendChild(chip);
    }
  }

  renderSpeedDial() {
    if (!this.el.speedDialGrid) return;

    // Pick a fun Bean quote
    if (this.el.beanQuote) {
      const quote = BEAN_QUOTES[Math.floor(Math.random() * BEAN_QUOTES.length)];
      this.el.beanQuote.textContent = quote;
    }

    this.el.speedDialGrid.innerHTML = '';
    for (const bm of this.bookmarks) {
      const card = document.createElement('div');
      card.className =
        'speed-dial-card relative group rounded-xl p-4 cursor-pointer flex flex-col items-start gap-2';
      card.innerHTML = `
        <button class="bm-del opacity-0 group-hover:opacity-100 absolute top-2 right-2 text-slate-500 hover:text-rose-400 text-xs px-1.5 py-0.5 rounded bg-black/30 transition" title="Remove">&times;</button>
        <div class="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-xl">${bm.icon || '🌐'}</div>
        <div class="w-full">
          <div class="text-sm font-semibold text-slate-100 truncate">${escapeHtml(bm.title)}</div>
          <div class="text-[11px] text-slate-400 truncate">${escapeHtml(bm.url.replace(/^https?:\/\//, ''))}</div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.bm-del')) {
          this.removeBookmark(bm.id);
        } else {
          this.navigateActive(bm.url);
        }
      });

      this.el.speedDialGrid.appendChild(card);
    }

    // Add a special "Bean Game Hub" shortcut card on the Speed Dial
    const gameCard = document.createElement('div');
    gameCard.className =
      'speed-dial-card rounded-xl p-4 cursor-pointer flex flex-col items-start gap-2 border-dashed';
    gameCard.innerHTML = `
      <div class="w-10 h-10 rounded-lg accent-bg/20 flex items-center justify-center text-xl">🎮</div>
      <div class="w-full">
        <div class="text-sm font-semibold accent-text truncate">Bean Game Hub</div>
        <div class="text-[11px] text-slate-400 truncate">5 Offline Classics</div>
      </div>
    `;
    gameCard.addEventListener('click', () => this.onSwitchToGames?.());
    this.el.speedDialGrid.appendChild(gameCard);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
