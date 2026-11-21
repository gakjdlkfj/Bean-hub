/**
 * Bean Proxy Client-Side Runtime Hook
 * Served at /__proxy_hook.js and injected into proxied HTML documents
 * to intercept dynamic fetch, XHR, WebSocket, DOM attributes, clicks, forms, and popups.
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

  function unwrapSearchRedirect(resolvedHref) {
    try {
      const u = new URL(resolvedHref);
      const host = u.hostname.toLowerCase();
      if (host.endsWith('duckduckgo.com') && u.pathname.startsWith('/l/')) {
        const uddg = u.searchParams.get('uddg');
        if (uddg && /^https?:\/\//i.test(uddg)) return uddg;
      }
      if (host.includes('google.') && u.pathname === '/url') {
        const q = u.searchParams.get('q') || u.searchParams.get('url');
        if (q && /^https?:\/\//i.test(q)) return q;
      }
    } catch {
      // ignore
    }
    return resolvedHref;
  }

  function wrapUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    const trimmed = rawUrl.trim();
    if (!trimmed || SKIP_RE.test(trimmed)) return rawUrl;
    if (trimmed.startsWith(PROXY_PREFIX) || trimmed.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
      return rawUrl;
    }
    try {
      const resolved = unwrapSearchRedirect(new URL(trimmed, TARGET_URL).href);
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

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === 'string') {
      input = wrapUrl(input);
    } else if (input instanceof Request) {
      input = new Request(wrapUrl(input.url), input);
    }
    return origFetch.call(this, input, init);
  };

  const origXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    return origXhrOpen.call(this, method, wrapUrl(url), ...rest);
  };

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

  if (navigator.sendBeacon) {
    const origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      return origBeacon(wrapUrl(url), data);
    };
  }

  // Open popups inside a new Bean Proxy tab instead of leaving the portal
  window.open = function (url) {
    if (!url) return null;
    try {
      const resolved = unwrapSearchRedirect(new URL(String(url), TARGET_URL).href);
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'BEAN_PROXY_NEW_TAB', url: resolved }, '*');
        return window;
      }
      window.location.href = wrapUrl(resolved);
    } catch {
      // ignore
    }
    return null;
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
    // ignore
  }

  // Capture ALL link clicks so DuckDuckGo/search results stay inside the proxy iframe
  document.addEventListener(
    'click',
    function (e) {
      const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!link) return;
      link.setAttribute('target', '_self');
      const rawHref = link.getAttribute('href');
      if (!rawHref || SKIP_RE.test(rawHref)) return;
      if (!rawHref.startsWith(PROXY_PREFIX) && !rawHref.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
        e.preventDefault();
        window.location.href = wrapUrl(rawHref);
      }
    },
    true
  );

  // Capture ALL form submits
  document.addEventListener(
    'submit',
    function (e) {
      const form = e.target;
      if (!form || !form.getAttribute) return;
      form.setAttribute('target', '_self');
      const rawAction = form.getAttribute('action') || TARGET_URL;
      if (rawAction && !SKIP_RE.test(rawAction) && !rawAction.startsWith(PROXY_PREFIX)) {
        form.setAttribute('action', wrapUrl(rawAction));
      }
    },
    true
  );

  const origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const lower = String(name).toLowerCase();
    if ((lower === 'src' || lower === 'href' || lower === 'action') && typeof value === 'string') {
      value = wrapUrl(value);
    } else if (lower === 'target') {
      value = '_self';
    }
    return origSetAttribute.call(this, name, value);
  };

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
      // ignore
    }
  }

  window.addEventListener('DOMContentLoaded', notifyParent);
  window.addEventListener('load', notifyParent);
})();
