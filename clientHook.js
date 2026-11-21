/**
 * Bean Proxy Client-Side Runtime Hook
 * Served at /__proxy_hook.js and injected into proxied HTML documents
 * to intercept dynamic fetch, XHR, WebSocket, DOM attributes, and history APIs.
 */
(function () {
  if (window.__BEAN_PROXY_HOOKED__) return;
  window.__BEAN_PROXY_HOOKED__ = true;

  const currentScript =
    document.currentScript || document.querySelector('script[src="/__proxy_hook.js"]');
  const TARGET_URL = currentScript?.getAttribute('data-target-url') || window.location.href;
  const PROXY_ORIGIN = currentScript?.getAttribute('data-proxy-origin') || window.location.origin;
  const PROXY_PREFIX = currentScript?.getAttribute('data-proxy-prefix') || '/proxy/';
  const SKIP_RE = /^(data:|blob:|javascript:|mailto:|tel:|sms:|about:|#)/i;

  function encodeBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function wrapUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    const trimmed = rawUrl.trim();
    if (!trimmed || SKIP_RE.test(trimmed)) return rawUrl;
    if (trimmed.startsWith(PROXY_PREFIX) || trimmed.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
      return rawUrl;
    }
    try {
      const resolved = new URL(trimmed, TARGET_URL).href;
      if (!/^https?:\/\//i.test(resolved)) return rawUrl;
      return `${PROXY_ORIGIN}${PROXY_PREFIX}${encodeBase64Url(resolved)}`;
    } catch {
      return rawUrl;
    }
  }

  function wrapWsUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    try {
      const resolved = new URL(rawUrl, TARGET_URL).href;
      if (!/^wss?:\/\//i.test(resolved)) return rawUrl;
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${window.location.host}/ws-proxy?target=${encodeBase64Url(resolved)}`;
    } catch {
      return rawUrl;
    }
  }

  // 1. Intercept window.fetch
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === 'string') {
      input = wrapUrl(input);
    } else if (input instanceof Request) {
      input = new Request(wrapUrl(input.url), input);
    }
    return origFetch.call(this, input, init);
  };

  // 2. Intercept XMLHttpRequest.prototype.open
  const origXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    return origXhrOpen.call(this, method, wrapUrl(url), ...rest);
  };

  // 3. Intercept window.WebSocket
  const OrigWebSocket = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const proxied = wrapWsUrl(url);
    return protocols !== undefined
      ? new OrigWebSocket(proxied, protocols)
      : new OrigWebSocket(proxied);
  };
  window.WebSocket.prototype = OrigWebSocket.prototype;
  window.WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
  window.WebSocket.OPEN = OrigWebSocket.OPEN;
  window.WebSocket.CLOSING = OrigWebSocket.CLOSING;
  window.WebSocket.CLOSED = OrigWebSocket.CLOSED;

  // 4. Intercept navigator.sendBeacon
  if (navigator.sendBeacon) {
    const origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      return origBeacon(wrapUrl(url), data);
    };
  }

  // 5. Intercept window.open, location.assign/replace, clicks, and form submits
  const origOpen = window.open;
  window.open = function (url, target, features) {
    const safeTarget = target === '_top' || target === '_parent' ? '_self' : target;
    return origOpen.call(this, url ? wrapUrl(url) : url, safeTarget, features);
  };

  try {
    const origAssign = Location.prototype.assign;
    const origReplace = Location.prototype.replace;
    Location.prototype.assign = function (url) {
      return origAssign.call(this, wrapUrl(String(url)));
    };
    Location.prototype.replace = function (url) {
      return origReplace.call(this, wrapUrl(String(url)));
    };
  } catch {
    // Ignore if Location prototype is locked
  }

  document.addEventListener(
    'click',
    function (e) {
      const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!link) return;
      const t = (link.getAttribute('target') || '').toLowerCase();
      if (t === '_top' || t === '_parent') link.setAttribute('target', '_self');
      const rawHref = link.getAttribute('href');
      if (rawHref && !SKIP_RE.test(rawHref) && !rawHref.startsWith(PROXY_PREFIX)) {
        link.setAttribute('href', wrapUrl(rawHref));
      }
    },
    true
  );

  document.addEventListener(
    'submit',
    function (e) {
      const form = e.target;
      if (!form || !form.getAttribute) return;
      const t = (form.getAttribute('target') || '').toLowerCase();
      if (t === '_top' || t === '_parent') form.setAttribute('target', '_self');
      const rawAction = form.getAttribute('action') || TARGET_URL;
      if (rawAction && !SKIP_RE.test(rawAction) && !rawAction.startsWith(PROXY_PREFIX)) {
        form.setAttribute('action', wrapUrl(rawAction));
      }
    },
    true
  );

  // 6. Intercept dynamic Element.prototype.setAttribute for src/href/action
  const origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const lower = String(name).toLowerCase();
    if ((lower === 'src' || lower === 'href' || lower === 'action') && typeof value === 'string') {
      value = wrapUrl(value);
    }
    return origSetAttribute.call(this, name, value);
  };

  // 7. Guard history.pushState / replaceState against cross-origin SecurityError
  const origPushState = history.pushState.bind(history);
  const origReplaceState = history.replaceState.bind(history);

  history.pushState = function (state, title, url) {
    try {
      return origPushState(state, title, url ? wrapUrl(String(url)) : url);
    } catch {
      return undefined;
    }
  };

  history.replaceState = function (state, title, url) {
    try {
      return origReplaceState(state, title, url ? wrapUrl(String(url)) : url);
    } catch {
      return undefined;
    }
  };

  // 8. Notify parent portal frame of title/URL changes for tab bar sync
  function notifyParent() {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'BEAN_PROXY_NAV',
            title: document.title || TARGET_URL,
            url: TARGET_URL
          },
          '*'
        );
      }
    } catch {
      // Ignore cross-origin postMessage errors
    }
  }

  window.addEventListener('DOMContentLoaded', notifyParent);
  window.addEventListener('load', notifyParent);
})();
