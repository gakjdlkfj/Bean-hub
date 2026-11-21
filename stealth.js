import { CLOAK_PRESETS } from './storage.js';

const DEFAULT_BEAN_FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#090b10"/><circle cx="32" cy="32" r="22" fill="#10b981"/><text x="32" y="42" font-size="28" text-anchor="middle" fill="#090b10" font-family="Arial, sans-serif" font-weight="bold">B</text></svg>'
  );

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'emerald');
}

export function setCookie(name, value, days = 30) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

/**
 * Sync Ad-Blocker and User-Agent settings to browser cookies read by the Express proxy.
 */
export function syncProxyCookies(settings) {
  setCookie('proxy_adblock', settings.adblockEnabled ? 'true' : 'false');
  setCookie('proxy_ua', settings.userAgent || 'chrome_win');
}

/**
 * Apply Tab Cloaking (document.title and <link rel="icon">).
 */
export function applyTabCloak(settings) {
  let title = CLOAK_PRESETS.none.title;
  let favicon = DEFAULT_BEAN_FAVICON;

  if (settings.cloakPreset === 'custom') {
    title = settings.customCloakTitle?.trim() || CLOAK_PRESETS.none.title;
    favicon = settings.customCloakFavicon?.trim() || DEFAULT_BEAN_FAVICON;
  } else if (CLOAK_PRESETS[settings.cloakPreset]) {
    const preset = CLOAK_PRESETS[settings.cloakPreset];
    title = preset.title;
    favicon = preset.favicon || DEFAULT_BEAN_FAVICON;
  }

  document.title = title;

  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = favicon;
}

/**
 * Launch the entire Bean Proxy portal inside a clean about:blank fullscreen iframe.
 */
export function launchAboutBlank(redirectOriginalUrl, onToast) {
  const popup = window.open('about:blank', '_blank');
  if (!popup || popup.closed) {
    if (onToast) {
      onToast('Popup blocked! Allow popups for this site to use about:blank mode.', 'error');
    }
    return false;
  }

  const doc = popup.document;
  doc.open();
  doc.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(document.title || 'My Drive - Google Drive')}</title>
  <link rel="icon" href="${escapeHtml(document.querySelector("link[rel~='icon']")?.href || '')}" />
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #090b10; }
    iframe { width: 100%; height: 100%; border: none; display: block; }
  </style>
</head>
<body>
  <iframe src="${escapeHtml(window.location.href)}" allowfullscreen allow="fullscreen; clipboard-read; clipboard-write; autoplay"></iframe>
</body>
</html>`);
  doc.close();

  if (redirectOriginalUrl) {
    window.location.replace(redirectOriginalUrl);
  }
  return true;
}

/**
 * Execute Panic Key: wipe server cookies/logs, clear sessionStorage, and replace tab URL.
 */
export function triggerPanic(settings) {
  const safeUrl = settings.panicUrl?.trim() || 'https://classroom.google.com';

  // Fire-and-forget server session wipe
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/session/clear', '');
    } else {
      fetch('/api/session/clear', { method: 'POST', keepalive: true }).catch(() => {});
    }
  } catch {
    // Continue immediate redirect
  }

  try {
    sessionStorage.clear();
  } catch {
    // Ignore
  }

  // Replace current history entry so Back button doesn't return to the proxy
  try {
    window.top.location.replace(safeUrl);
  } catch {
    window.location.replace(safeUrl);
  }
}

/**
 * Wipe server cookie jar & network logs without redirecting.
 */
export async function wipeSessionData() {
  const res = await fetch('/api/session/clear', { method: 'POST' });
  return res.ok;
}

/**
 * Enable or disable accidental tab-close guard.
 */
let beforeUnloadHandler = null;
export function applyAntiCloseGuard(enabled) {
  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
  if (enabled) {
    beforeUnloadHandler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnloadHandler);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
