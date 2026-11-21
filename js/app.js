import {
  CLOAK_PRESETS,
  SEARCH_ENGINES,
  loadSettings,
  saveSettings
} from './storage.js';
import {
  applyTheme,
  applyTabCloak,
  syncProxyCookies,
  launchAboutBlank,
  triggerPanic,
  wipeSessionData,
  applyAntiCloseGuard
} from './stealth.js';
import { TabbedBrowser } from './browser.js';
import { BrowserDevTools, fetchServerHealth } from './inspector.js';
import { CommandPalette } from './palette.js';
import { GameHub } from './gamehub.js';
import { LiveChat } from './chat.js';
import { StaffPanel } from './adminPanel.js';

const MR_BEAN_PHOTOS = [
  {
    url: '/img/bean-1.jpg',
    caption: 'Classic Mr. Bean grin — certified Bean Proxy mascot.'
  },
  {
    url: '/img/bean-2.jpg',
    caption: 'Rowan Atkinson channeling peak 2048 high-score energy.'
  },
  {
    url: '/img/bean-3.jpg',
    caption: 'Mr. Bean inspecting your browser tabs like a pro.'
  },
  {
    url: '/img/bean-4.jpg',
    caption: 'Mr. Bean checking Wisp transport latency in Brussels.'
  },
  {
    url: '/img/bean-5.jpg',
    caption: 'Red carpet vibes when the Ad-Blocker zaps 47 trackers.'
  },
  {
    url: '/img/bean-6.png',
    caption: 'Certified Bean Engineering™ — Teddy approved.'
  }
];

let settings = {
  transport: 'native',
  wispUrl: 'wss://wisp.mercurywork.shop/',
  autoAboutBlank: false,
  ...loadSettings()
};
let portalSettings = { maintenanceMode: false, maintenanceMessage: '' };
let currentUser = null;
let authMode = 'login';
let currentView = 'browser';
let isRecordingPanicKey = false;
let beanPhotoIdx = 0;

let browser = null;
let devTools = null;
let gameHub = null;
let liveChat = null;
let staffPanel = null;

// --- Toast Notification Helper ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const colors = {
    success: 'border-emerald-500/40 bg-emerald-950/90 text-emerald-200',
    error: 'border-rose-500/40 bg-rose-950/90 text-rose-200',
    info: 'border-white/15 bg-slate-900/95 text-slate-200'
  };

  const el = document.createElement('div');
  el.className = `toast-item px-3.5 py-2.5 rounded-xl border text-xs font-medium shadow-xl backdrop-blur ${
    colors[type] || colors.info
  }`;
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.25s ease';
    setTimeout(() => el.remove(), 260);
  }, 2800);
}

// --- Dismissible Live Banner & On-Screen Popup Modal ---
function showAnnouncementPopup(text, badgeLabel = '📢 Bean Proxy Announcement') {
  const clean = (text || '').trim();
  if (!clean) return;
  const modal = document.getElementById('announcement-modal');
  const badge = document.getElementById('ann-modal-badge');
  const body = document.getElementById('ann-modal-body');
  if (!modal || !body) return;
  if (badge) badge.textContent = badgeLabel;
  body.textContent = clean;
  modal.classList.remove('hidden');
}

function setAnnouncement(text, popModal = false) {
  const banner = document.getElementById('announcement-banner');
  const label = document.getElementById('announcement-text');
  const clean = (text || '').trim();
  if (banner && label) {
    label.textContent = clean;
    banner.classList.toggle('hidden', !clean);
  }
  if (popModal && clean) {
    showAnnouncementPopup(clean, '📢 Live Staff Broadcast');
  }
}

// --- Full-Site Maintenance Gate ---
function applyMaintenanceGate(nextPortalSettings) {
  if (nextPortalSettings) {
    portalSettings = { ...portalSettings, ...nextPortalSettings };
  }
  const overlay = document.getElementById('maintenance-overlay');
  const msgEl = document.getElementById('maintenance-overlay-msg');
  if (!overlay) return;

  const isStaff = currentUser && (currentUser.role === 'owner' || currentUser.role === 'admin');
  const shouldLock = Boolean(portalSettings.maintenanceMode) && !isStaff;
  if (msgEl) {
    msgEl.textContent =
      portalSettings.maintenanceMessage ||
      'Bean Proxy is currently undergoing maintenance. Only the Owner and Admins can enter right now.';
  }
  overlay.classList.toggle('hidden', !shouldLock);
}

// --- Real Mr. Bean Photo Gallery ---
function renderBeanGallery() {
  const img = document.getElementById('bean-gallery-img');
  const caption = document.getElementById('bean-gallery-caption');
  const thumbs = document.getElementById('bean-gallery-thumbs');
  if (!img || !caption) return;

  const item = MR_BEAN_PHOTOS[beanPhotoIdx % MR_BEAN_PHOTOS.length];
  img.src = item.url;
  caption.textContent = item.caption;

  if (thumbs) {
    thumbs.innerHTML = MR_BEAN_PHOTOS.map(
      (p, idx) => `
        <button data-bean-idx="${idx}" class="w-10 h-10 rounded-lg overflow-hidden border-2 shrink-0 transition ${
          idx === beanPhotoIdx ? 'accent-border scale-105' : 'border-transparent opacity-60 hover:opacity-100'
        }">
          <img src="${p.url}" alt="Mr. Bean ${idx + 1}" class="w-full h-full object-cover" />
        </button>`
    ).join('');
    thumbs.querySelectorAll('[data-bean-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        beanPhotoIdx = Number(btn.getAttribute('data-bean-idx'));
        renderBeanGallery();
      });
    });
  }
}

// --- View Switcher ---
function switchView(viewName) {
  currentView = viewName;
  const views = {
    browser: document.getElementById('view-browser'),
    games: document.getElementById('view-games'),
    chat: document.getElementById('view-chat'),
    staff: document.getElementById('view-staff')
  };
  const navs = {
    browser: document.getElementById('nav-view-browser'),
    games: document.getElementById('nav-view-games'),
    chat: document.getElementById('nav-view-chat'),
    staff: document.getElementById('nav-view-staff')
  };

  for (const [key, el] of Object.entries(views)) {
    if (el) el.classList.toggle('hidden', key !== viewName);
  }
  for (const [key, btn] of Object.entries(navs)) {
    if (!btn) continue;
    const active = key === viewName;
    btn.classList.toggle('accent-bg', active);
    btn.classList.toggle('text-slate-950', active);
    btn.classList.toggle('text-slate-300', !active);
  }

  if (viewName === 'games') {
    gameHub?.ensureLoaded();
  }
  liveChat?.setVisible(viewName === 'chat');
  if (viewName === 'staff') {
    staffPanel?.refresh();
  }
}

// --- Auth UI & Session Sync ---
function syncAuthUi() {
  const btnLabel = document.getElementById('auth-btn-label');
  const staffNav = document.getElementById('nav-view-staff');

  if (currentUser) {
    const icon = currentUser.role === 'owner' ? '👑' : currentUser.role === 'admin' ? '🛡️' : '👤';
    btnLabel.textContent = `${icon} ${currentUser.username}`;
    const isStaff = currentUser.role === 'owner' || currentUser.role === 'admin';
    staffNav.classList.toggle('hidden', !isStaff);
    staffNav.textContent = currentUser.role === 'owner' ? '👑 Owner/Admin' : '🛡️ Admin';
  } else {
    btnLabel.textContent = 'Sign In';
    staffNav.classList.add('hidden');
    if (currentView === 'staff') switchView('browser');
  }

  const guestView = document.getElementById('auth-guest-view');
  const profileView = document.getElementById('auth-profile-view');
  if (currentUser) {
    guestView.classList.add('hidden');
    profileView.classList.remove('hidden');
    document.getElementById('profile-avatar').textContent = currentUser.username[0].toUpperCase();
    document.getElementById('profile-username').textContent = currentUser.username;
    document.getElementById('profile-role').textContent =
      currentUser.role === 'owner' ? '👑 OWNER' : currentUser.role === 'admin' ? '🛡️ ADMIN' : 'MEMBER';
  } else {
    guestView.classList.remove('hidden');
    profileView.classList.add('hidden');
  }
}

function setAuthMode(mode) {
  authMode = mode;
  const loginTab = document.getElementById('auth-tab-login');
  const regTab = document.getElementById('auth-tab-register');
  const submitBtn = document.getElementById('auth-submit-btn');
  const errBox = document.getElementById('auth-error');

  errBox.classList.add('hidden');
  const isLogin = mode === 'login';
  loginTab.classList.toggle('accent-bg', isLogin);
  loginTab.classList.toggle('text-slate-950', isLogin);
  loginTab.classList.toggle('text-slate-300', !isLogin);

  regTab.classList.toggle('accent-bg', !isLogin);
  regTab.classList.toggle('text-slate-950', !isLogin);
  regTab.classList.toggle('text-slate-300', isLogin);

  submitBtn.textContent = isLogin ? 'Sign In' : 'Create Account';
}

function openAuthModal() {
  syncAuthUi();
  document.getElementById('auth-error').classList.add('hidden');
  document.getElementById('auth-modal').classList.remove('hidden');
  if (!currentUser) {
    setTimeout(() => document.getElementById('auth-username')?.focus(), 20);
  }
}

function closeAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
}

async function fetchAuthSession() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user || null;
      const ps = data.portalSettings || {};
      applyMaintenanceGate(ps);
      if (ps.announcement) {
        setAnnouncement(ps.announcement, false);
      }
      const isStaff = currentUser && (currentUser.role === 'owner' || currentUser.role === 'admin');
      if (ps.startupAnnouncementEnabled && ps.startupAnnouncement && (!ps.maintenanceMode || isStaff)) {
        showAnnouncementPopup(ps.startupAnnouncement, '👑 Owner Startup Notice');
      }
    }
  } catch {
    currentUser = null;
  }
  syncAuthUi();
  liveChat?.connect();
}

// --- Settings Modal ---
function openSettingsModal() {
  document.getElementById('settings-modal').classList.remove('hidden');
  syncSettingsForm();
}

function closeSettingsModal() {
  isRecordingPanicKey = false;
  document.getElementById('panic-key-record-btn').textContent = settings.panicKey;
  document.getElementById('settings-modal').classList.add('hidden');
}

function syncSettingsForm() {
  document.getElementById('setting-search-engine').value = settings.searchEngine;
  document.getElementById('setting-transport').value = settings.transport || 'native';
  document.getElementById('setting-wisp-url').value = settings.wispUrl || 'wss://wisp.mercurywork.shop/';
  document.getElementById('setting-cloak-preset').value = settings.cloakPreset;
  document.getElementById('setting-custom-title').value = settings.customCloakTitle || '';
  document.getElementById('setting-custom-favicon').value = settings.customCloakFavicon || '';
  document.getElementById('setting-panic-url').value = settings.panicUrl;
  document.getElementById('panic-key-record-btn').textContent = settings.panicKey;
  document.getElementById('setting-adblock-toggle').checked = Boolean(settings.adblockEnabled);
  document.getElementById('setting-ua-select').value = settings.userAgent;
  document.getElementById('setting-anticlose-toggle').checked = Boolean(settings.antiCloseGuard);
  document.getElementById('setting-auto-blank-toggle').checked = Boolean(settings.autoAboutBlank);
  document.getElementById('setting-blank-redirect').value = settings.aboutBlankRedirectUrl || '';

  const customCloakBox = document.getElementById('custom-cloak-fields');
  customCloakBox.classList.toggle('hidden', settings.cloakPreset !== 'custom');

  document.querySelectorAll('[data-theme-pick]').forEach((btn) => {
    const active = btn.getAttribute('data-theme-pick') === settings.theme;
    btn.classList.toggle('ring-2', active);
    btn.classList.toggle('ring-white', active);
  });

  const badge = document.getElementById('adblock-status-dot');
  if (badge) {
    badge.className = `w-2 h-2 rounded-full ${
      settings.adblockEnabled ? 'bg-emerald-400' : 'bg-slate-500'
    }`;
  }
  const panicBadge = document.getElementById('panic-key-hint');
  if (panicBadge) {
    panicBadge.textContent = settings.panicKey === ' ' ? 'Space' : settings.panicKey;
  }

  const transportLabel = (settings.transport || 'native').toUpperCase();
  const pill = document.getElementById('nav-transport-pill');
  if (pill) pill.textContent = transportLabel;
  const statTrans = document.getElementById('stat-transport');
  if (statTrans) statTrans.textContent = transportLabel;
}

function updateSettings(patch) {
  settings = { ...settings, ...patch };
  saveSettings(settings);
  applyTheme(settings.theme);
  applyTabCloak(settings);
  syncProxyCookies(settings);
  applyAntiCloseGuard(settings.antiCloseGuard);
  syncSettingsForm();
}

// --- Bootstrap ---
async function init() {
  applyTheme(settings.theme);
  applyTabCloak(settings);
  syncProxyCookies(settings);
  applyAntiCloseGuard(settings.antiCloseGuard);

  // Auto about:blank on open (only when not already inside an iframe)
  if (settings.autoAboutBlank && window.self === window.top) {
    const launched = launchAboutBlank(settings.aboutBlankRedirectUrl, (msg, type) => {
      setTimeout(() => showToast(msg, type), 400);
    });
    if (launched) return;
  }

  const cloakSelect = document.getElementById('setting-cloak-preset');
  cloakSelect.innerHTML =
    Object.entries(CLOAK_PRESETS)
      .map(([id, item]) => `<option value="${id}">${item.label}</option>`)
      .join('') + '<option value="custom">Custom Cloak…</option>';

  const searchSelect = document.getElementById('setting-search-engine');
  searchSelect.innerHTML = Object.entries(SEARCH_ENGINES)
    .map(([id, item]) => `<option value="${id}">${item.name}</option>`)
    .join('');

  browser = new TabbedBrowser({
    elements: {
      tabList: document.getElementById('tab-list'),
      newTabBtn: document.getElementById('new-tab-btn'),
      backBtn: document.getElementById('nav-back'),
      forwardBtn: document.getElementById('nav-forward'),
      reloadBtn: document.getElementById('nav-reload'),
      homeBtn: document.getElementById('nav-home'),
      omniboxForm: document.getElementById('omnibox-form'),
      omniboxInput: document.getElementById('omnibox-input'),
      bookmarkBtn: document.getElementById('nav-bookmark'),
      copyUrlBtn: document.getElementById('nav-copy-url'),
      fullscreenBtn: document.getElementById('nav-fullscreen'),
      bookmarksBar: document.getElementById('bookmarks-bar'),
      viewport: document.getElementById('browser-viewport'),
      newTabView: document.getElementById('new-tab-view'),
      speedDialGrid: document.getElementById('speed-dial-grid'),
      beanQuote: document.getElementById('bean-quote'),
      loadingBar: document.getElementById('loading-bar')
    },
    getSettings: () => settings,
    onToast: showToast,
    onSwitchToGames: () => switchView('games')
  });

  renderBeanGallery();
  document.getElementById('bean-photo-prev')?.addEventListener('click', () => {
    beanPhotoIdx = (beanPhotoIdx - 1 + MR_BEAN_PHOTOS.length) % MR_BEAN_PHOTOS.length;
    renderBeanGallery();
  });
  document.getElementById('bean-photo-next')?.addEventListener('click', () => {
    beanPhotoIdx = (beanPhotoIdx + 1) % MR_BEAN_PHOTOS.length;
    renderBeanGallery();
  });

  gameHub = new GameHub(document.getElementById('game-hub-root'), showToast);

  liveChat = new LiveChat({
    root: document.getElementById('chat-root'),
    getUser: () => currentUser,
    onOpenAuth: openAuthModal,
    onToast: showToast,
    onAnnouncement: (text, pop) => setAnnouncement(text, pop),
    onGamesUpdated: () => gameHub?.ensureLoaded(true),
    onSettingsUpdated: (ps) => applyMaintenanceGate(ps),
    onUnreadChange: (count) => {
      const badge = document.getElementById('chat-unread-badge');
      if (!badge) return;
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.toggle('hidden', count === 0);
    }
  });

  staffPanel = new StaffPanel({
    root: document.getElementById('staff-root'),
    getUser: () => currentUser,
    onToast: showToast,
    onAnnouncement: (text, pop) => setAnnouncement(text, pop),
    onGamesUpdated: () => gameHub?.ensureLoaded(true),
    onSettingsUpdated: (ps) => applyMaintenanceGate(ps),
    onPreviewPopup: (text, title) => showAnnouncementPopup(text, title)
  });

  devTools = new BrowserDevTools({
    elements: {
      drawer: document.getElementById('inspector-drawer'),
      toggleBtn: document.getElementById('btn-inspector'),
      closeBtn: document.getElementById('inspector-close'),
      clearBtn: document.getElementById('inspector-clear'),
      refreshBtn: document.getElementById('inspector-refresh'),
      tbody: document.getElementById('inspector-tbody'),
      consoleForm: document.getElementById('dt-console-form'),
      consoleInput: document.getElementById('dt-console-input')
    },
    getBrowser: () => browser,
    getSettings: () => settings,
    onUpdateSettings: updateSettings,
    onToast: showToast
  });

  document.getElementById('nav-transport-pill')?.addEventListener('click', () => {
    devTools.open('transport');
  });

  document.getElementById('announcement-banner-dismiss')?.addEventListener('click', () => {
    document.getElementById('announcement-banner')?.classList.add('hidden');
  });
  document.getElementById('ann-modal-dismiss')?.addEventListener('click', () => {
    document.getElementById('announcement-modal')?.classList.add('hidden');
  });
  document.getElementById('announcement-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'announcement-modal') {
      document.getElementById('announcement-modal').classList.add('hidden');
    }
  });

  const speedDialForm = document.getElementById('speed-dial-form');
  const speedDialInput = document.getElementById('speed-dial-input');
  speedDialForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = speedDialInput.value.trim();
    if (val) {
      speedDialInput.value = '';
      browser.navigateActive(val);
    }
  });

  const palette = new CommandPalette(
    {
      backdrop: document.getElementById('palette-backdrop'),
      input: document.getElementById('palette-input'),
      list: document.getElementById('palette-list')
    },
    (query) => {
      const cmds = [
        {
          icon: '➕',
          title: 'New Browser Tab',
          subtitle: 'Open a fresh Bean Proxy tab',
          shortcut: 'Alt+T',
          run: () => {
            switchView('browser');
            browser.createTab(null, { activate: true });
          }
        },
        {
          icon: '🎮',
          title: 'Open Bean Game Hub',
          subtitle: 'Play offline classics & custom games',
          run: () => switchView('games')
        },
        {
          icon: '💬',
          title: 'Open Bean Lounge (Chat, Voice & Screen Share)',
          subtitle: 'Groups, live chat, voice channels, and screen sharing',
          run: () => switchView('chat')
        },
        {
          icon: '🛠️',
          title: 'Toggle Browser DevTools',
          subtitle: 'Console, Elements, Network, Storage, and Wisp/Transport',
          run: () => devTools.toggle()
        },
        {
          icon: '⚡',
          title: 'Change Wisp Server & Transport',
          subtitle: `Current: ${(settings.transport || 'native').toUpperCase()}`,
          run: () => devTools.open('transport')
        },
        {
          icon: '👻',
          title: 'Launch about:blank Cloaked Window',
          subtitle: 'Hide Bean Proxy from browser history',
          run: () => launchAboutBlank(settings.aboutBlankRedirectUrl, showToast)
        },
        {
          icon: '⚙️',
          title: 'Open Stealth & Proxy Settings',
          subtitle: 'Configure Panic Key, UA, Cloaking, Wisp, and Themes',
          run: () => openSettingsModal()
        },
        {
          icon: '🚨',
          title: 'Trigger Panic Escape Now',
          subtitle: `Redirect to ${settings.panicUrl}`,
          shortcut: settings.panicKey,
          run: () => triggerPanic(settings)
        }
      ];

      if (currentUser && (currentUser.role === 'owner' || currentUser.role === 'admin')) {
        cmds.splice(3, 0, {
          icon: currentUser.role === 'owner' ? '👑' : '🛡️',
          title: currentUser.role === 'owner' ? 'Open Owner & Admin Panel' : 'Open Admin Panel',
          subtitle: 'Add games, announcements, admins, moderation, and audit log',
          run: () => switchView('staff')
        });
      }

      if (query) {
        cmds.unshift({
          icon: '🚀',
          title: `Browse "${query}"`,
          subtitle: 'Open in current Bean Proxy tab',
          shortcut: 'Enter',
          run: () => {
            switchView('browser');
            browser.navigateActive(query);
          }
        });
      }
      return cmds;
    }
  );

  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.proxyPrefix) browser.setProxyPrefix(cfg.proxyPrefix);
      const uaSelect = document.getElementById('setting-ua-select');
      if (cfg.userAgents?.length) {
        uaSelect.innerHTML = cfg.userAgents
          .map((ua) => `<option value="${ua.id}">${ua.label}</option>`)
          .join('');
      }
    }
  } catch {
    // ignore
  }

  syncSettingsForm();
  await fetchAuthSession();

  document.getElementById('nav-view-browser').addEventListener('click', () => switchView('browser'));
  document.getElementById('nav-view-games').addEventListener('click', () => switchView('games'));
  document.getElementById('nav-view-chat').addEventListener('click', () => switchView('chat'));
  document.getElementById('nav-view-staff').addEventListener('click', () => switchView('staff'));
  document.getElementById('btn-auth').addEventListener('click', openAuthModal);
  document.getElementById('btn-palette').addEventListener('click', () => palette.open());
  document.getElementById('btn-about-blank').addEventListener('click', () =>
    launchAboutBlank(settings.aboutBlankRedirectUrl, showToast)
  );
  document.getElementById('btn-panic-now').addEventListener('click', () => triggerPanic(settings));
  document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
  document.getElementById('settings-close').addEventListener('click', closeSettingsModal);
  document.getElementById('settings-modal').addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') closeSettingsModal();
  });

  document.getElementById('auth-close').addEventListener('click', closeAuthModal);
  document.getElementById('auth-modal').addEventListener('click', (e) => {
    if (e.target.id === 'auth-modal') closeAuthModal();
  });
  document.getElementById('auth-tab-login').addEventListener('click', () => setAuthMode('login'));
  document.getElementById('auth-tab-register').addEventListener('click', () => setAuthMode('register'));

  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    const errBox = document.getElementById('auth-error');
    errBox.classList.add('hidden');

    const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errBox.textContent = data.error || 'Authentication failed.';
        errBox.classList.remove('hidden');
        return;
      }
      currentUser = data.user;
      document.getElementById('auth-password').value = '';
      syncAuthUi();
      applyMaintenanceGate();
      closeAuthModal();
      liveChat.connect();
      showToast(`Welcome, ${currentUser.username}!`, 'success');
    } catch {
      errBox.textContent = 'Could not reach server.';
      errBox.classList.remove('hidden');
    }
  });

  // Maintenance Lock Screen Owner/Admin Sign-In Form
  document.getElementById('maintenance-login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('maint-username').value.trim();
    const password = document.getElementById('maint-password').value;
    const errBox = document.getElementById('maint-login-error');
    errBox.classList.add('hidden');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errBox.textContent = data.error || 'Sign in failed.';
        errBox.classList.remove('hidden');
        return;
      }
      if (data.user.role !== 'owner' && data.user.role !== 'admin') {
        await fetch('/api/auth/logout', { method: 'POST' });
        errBox.textContent = 'Only Owner or Admin accounts can enter during Maintenance Mode.';
        errBox.classList.remove('hidden');
        return;
      }
      currentUser = data.user;
      document.getElementById('maint-password').value = '';
      syncAuthUi();
      applyMaintenanceGate();
      liveChat.connect();
      showToast(`Unlocked Maintenance Mode as ${currentUser.username}`, 'success');
    } catch {
      errBox.textContent = 'Could not reach server.';
      errBox.classList.remove('hidden');
    }
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    liveChat.disconnect();
    syncAuthUi();
    applyMaintenanceGate();
    liveChat.render();
    closeAuthModal();
    showToast('Signed out.', 'info');
  });

  searchSelect.addEventListener('change', (e) => updateSettings({ searchEngine: e.target.value }));
  document.getElementById('setting-transport').addEventListener('change', (e) => {
    updateSettings({ transport: e.target.value });
    showToast(`Transport set to ${e.target.value.toUpperCase()}`, 'success');
  });
  document.getElementById('setting-wisp-url').addEventListener('change', (e) => {
    updateSettings({ wispUrl: e.target.value.trim() || 'wss://wisp.mercurywork.shop/' });
    showToast('Wisp Server URL updated.', 'success');
  });
  cloakSelect.addEventListener('change', (e) => updateSettings({ cloakPreset: e.target.value }));
  document.getElementById('setting-custom-title').addEventListener('input', (e) =>
    updateSettings({ customCloakTitle: e.target.value })
  );
  document.getElementById('setting-custom-favicon').addEventListener('input', (e) =>
    updateSettings({ customCloakFavicon: e.target.value })
  );
  document.getElementById('setting-panic-url').addEventListener('change', (e) =>
    updateSettings({ panicUrl: e.target.value.trim() || 'https://classroom.google.com' })
  );
  document.getElementById('setting-blank-redirect').addEventListener('change', (e) =>
    updateSettings({ aboutBlankRedirectUrl: e.target.value.trim() })
  );
  document.getElementById('setting-auto-blank-toggle').addEventListener('change', (e) => {
    updateSettings({ autoAboutBlank: e.target.checked });
    showToast(
      e.target.checked ? 'Auto about:blank enabled for next visit.' : 'Auto about:blank disabled.',
      'info'
    );
  });
  document.getElementById('setting-adblock-toggle').addEventListener('change', (e) => {
    updateSettings({ adblockEnabled: e.target.checked });
    showToast(`Ad-Blocker ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
  });
  document.getElementById('setting-ua-select').addEventListener('change', (e) => {
    updateSettings({ userAgent: e.target.value });
    showToast('User-Agent updated.', 'success');
  });
  document.getElementById('setting-anticlose-toggle').addEventListener('change', (e) =>
    updateSettings({ antiCloseGuard: e.target.checked })
  );

  document.querySelectorAll('[data-theme-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      updateSettings({ theme: btn.getAttribute('data-theme-pick') });
    });
  });

  const panicRecordBtn = document.getElementById('panic-key-record-btn');
  panicRecordBtn.addEventListener('click', () => {
    isRecordingPanicKey = true;
    panicRecordBtn.textContent = 'Press any key…';
  });

  document.getElementById('adblock-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('adblock-domain-input');
    const domain = input.value.trim();
    if (!domain) return;
    try {
      const res = await fetch('/api/adblock/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', domain })
      });
      if (res.ok) {
        input.value = '';
        showToast(`Blocked domain: ${domain}`, 'success');
        pollHealth();
      }
    } catch {
      showToast('Failed to add domain.', 'error');
    }
  });

  document.getElementById('btn-nuke-session').addEventListener('click', async () => {
    const ok = await wipeSessionData();
    showToast(ok ? 'All proxy cookies and network logs cleared.' : 'Failed to wipe session.', ok ? 'success' : 'error');
    pollHealth();
  });

  window.addEventListener('keydown', (e) => {
    if (isRecordingPanicKey) {
      e.preventDefault();
      isRecordingPanicKey = false;
      updateSettings({ panicKey: e.key });
      showToast(`Panic Key set to "${e.key}"`, 'success');
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      palette.toggle();
      return;
    }

    if (e.altKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      switchView('browser');
      browser.createTab(null, { activate: true });
      return;
    }

    const tag = (document.activeElement?.tagName || '').toLowerCase();
    const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === settings.panicKey && (!isTyping || e.key === 'Escape')) {
      if (palette.isOpen && e.key === 'Escape') return;
      e.preventDefault();
      triggerPanic(settings);
    }
  });

  function updateClock() {
    const el = document.getElementById('speed-dial-clock');
    if (!el) return;
    el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  updateClock();
  setInterval(updateClock, 15000);

  async function pollHealth() {
    const health = await fetchServerHealth();
    if (!health) return;
    const blockedEl = document.getElementById('stat-blocked-count');
    const cookiesEl = document.getElementById('stat-cookie-count');
    const rulesEl = document.getElementById('stat-rules-count');
    if (blockedEl) blockedEl.textContent = String(health.adblock?.blockedCount ?? 0);
    if (cookiesEl) cookiesEl.textContent = String(health.sessionCookies ?? 0);
    if (rulesEl) rulesEl.textContent = String(health.adblock?.totalDomains ?? 0);
  }
  pollHealth();
  setInterval(pollHealth, 8000);
}

document.addEventListener('DOMContentLoaded', init);
