const STORAGE_KEYS = {
  SETTINGS: 'bean_proxy_settings_v1',
  BOOKMARKS: 'bean_proxy_bookmarks_v1'
};

function makeSvgIcon(bg, fg, letter) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/><text x="32" y="43" font-size="30" text-anchor="middle" fill="${fg}" font-family="Arial, sans-serif" font-weight="bold">${letter}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

export const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', template: 'https://html.duckduckgo.com/html/?q={q}' },
  google: { name: 'Google', template: 'https://www.google.com/search?q={q}' },
  brave: { name: 'Brave Search', template: 'https://search.brave.com/search?q={q}' },
  bing: { name: 'Bing', template: 'https://www.bing.com/search?q={q}' },
  wikipedia: { name: 'Wikipedia', template: 'https://en.wikipedia.org/wiki/Special:Search?search={q}' }
};

export const CLOAK_PRESETS = {
  none: { label: 'Bean Proxy (Default)', title: 'Bean Proxy — Stealth Portal', favicon: '' },
  drive: { label: 'Google Drive', title: 'My Drive - Google Drive', favicon: makeSvgIcon('#1a73e8', '#ffffff', 'D') },
  classroom: { label: 'Google Classroom', title: 'Home - Classroom', favicon: makeSvgIcon('#1e8e3e', '#ffffff', 'C') },
  canvas: { label: 'Canvas LMS', title: 'Dashboard', favicon: makeSvgIcon('#e13f2b', '#ffffff', 'L') },
  docs: { label: 'Google Docs', title: 'Untitled document - Google Docs', favicon: makeSvgIcon('#4285f4', '#ffffff', 'T') },
  calculator: { label: 'Graphing Calculator', title: 'Desmos | Graphing Calculator', favicon: makeSvgIcon('#2f72dc', '#ffffff', '∑') },
  wikipedia: { label: 'Wikipedia', title: 'Wikipedia, the free encyclopedia', favicon: makeSvgIcon('#f8f9fa', '#111111', 'W') }
};

export const DEFAULT_SETTINGS = {
  theme: 'emerald',
  searchEngine: 'duckduckgo',
  cloakPreset: 'none',
  customCloakTitle: '',
  customCloakFavicon: '',
  panicKey: '`',
  panicUrl: 'https://classroom.google.com',
  adblockEnabled: true,
  userAgent: 'chrome_win',
  antiCloseGuard: false,
  aboutBlankRedirectUrl: 'https://www.google.com'
};

export const DEFAULT_BOOKMARKS = [
  { id: 'bm-1', title: 'Wikipedia', url: 'https://en.wikipedia.org', icon: '📚' },
  { id: 'bm-2', title: 'DuckDuckGo', url: 'https://html.duckduckgo.com/html/', icon: '🦆' },
  { id: 'bm-3', title: 'Hacker News', url: 'https://news.ycombinator.com', icon: '🗞️' },
  { id: 'bm-4', title: 'GitHub', url: 'https://github.com', icon: '🐙' },
  { id: 'bm-5', title: 'Internet Archive', url: 'https://archive.org', icon: '🏛️' },
  { id: 'bm-6', title: 'MDN Web Docs', url: 'https://developer.mozilla.org', icon: '⚡' }
];

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadBookmarks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.BOOKMARKS);
    if (!raw) return [...DEFAULT_BOOKMARKS];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [...DEFAULT_BOOKMARKS];
  } catch {
    return [...DEFAULT_BOOKMARKS];
  }
}

export function saveBookmarks(bookmarks) {
  try {
    localStorage.setItem(STORAGE_KEYS.BOOKMARKS, JSON.stringify(bookmarks));
  } catch {
    // Ignore storage quota errors
  }
}

export function encodeProxyUrlClient(targetUrl) {
  const bytes = new TextEncoder().encode(targetUrl);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}