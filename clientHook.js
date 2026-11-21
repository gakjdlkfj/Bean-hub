/**
 * Bean Proxy Client-Side Runtime Hook
 * Served at /__proxy_hook.js and injected into proxied HTML documents.
 * Guarantees every clicked link, submitted form, JS redirect, and popup stays inside Bean Proxy.
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

  function decodeBase64Url(token) {
    let norm = String(token || '').replace(/-/g, '+').replace(/_/g, '/');
    while (norm.length % 4 !== 0) norm += '=';
    const bin = atob(norm);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
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

  /**
   * Extract the true underlying http(s) URL from either a raw URL or an already-proxied /proxy/<token> URL.
   */
  function extractRealUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!trimmed || SKIP_RE.test(trimmed)) return null;

    // If already wrapped in /proxy/<token>, decode the token so we can unwrap any search redirects cleanly
    let proxyPath = null;
    if (trimmed.startsWith(PROXY_PREFIX)) {
      proxyPath = trimmed.slice(PROXY_PREFIX.length);
    } else if (trimmed.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
      proxyPath = trimmed.slice((PROXY_ORIGIN + PROXY_PREFIX).length);
    }

    if (proxyPath !== null) {
      try {
        const [tokenPart, queryPart] = proxyPath.split('?');
        let decoded = decodeBase64Url(tokenPart.split('/')[0]);
        if (queryPart) {
          decoded += (decoded.includes('?') ? '&' : '?') + queryPart;
        }
        return unwrapSearchRedirect(decoded);
      } catch {
        return null;
      }
    }

    try {
      const resolved = new URL(trimmed, TARGET_URL).href;
      if (!/^https?:\/\//i.test(resolved)) return null;
      return unwrapSearchRedirect(resolved);
    } catch {
      return null;
    }
  }

  function wrapUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    const trimmed = rawUrl.trim();
    if (!trimmed || SKIP_RE.test(trimmed)) return rawUrl;
    const real = extractRealUrl(trimmed);
    if (!real) return rawUrl;
    return `${PROXY_ORIGIN}${PROXY_PREFIX}${encodeBase64Url(real)}`;
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

  function navigateInsideProxy(realUrl, openInNewTab = false) {
    if (!realUrl) return;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          type: openInNewTab ? 'BEAN_PROXY_NEW_TAB' : 'BEAN_PROXY_NAVIGATE',
          url: realUrl
        },
        '*'
      );
      return;
    }
    window.location.href = wrapUrl(realUrl);
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

  // 5. Intercept window.open -> open inside a new Bean Proxy tab
  window.open = function (url) {
    if (!url) return null;
    const real = extractRealUrl(String(url));
    if (real) navigateInsideProxy(real, true);
    return null;
  };

  // 6. Intercept Location.prototype.assign & replace
  try {
    const origAssign = Location.prototype.assign;
    const origReplace = Location.prototype.replace;
    Location.prototype.assign = function (url) {
      const real = extractRealUrl(String(url));
      if (real && window.parent && window.parent !== window) {
        navigateInsideProxy(real, false);
        return;
      }
      return origAssign.call(this, wrapUrl(String(url)));
    };
    Location.prototype.replace = function (url) {
      const real = extractRealUrl(String(url));
      if (real && window.parent && window.parent !== window) {
        navigateInsideProxy(real, false);
        return;
      }
      return origReplace.call(this, wrapUrl(String(url)));
    };
  } catch {
    // ignore
  }

  // 7. ALWAYS intercept EVERY <a> click in capture phase so NO link can ever escape the proxy!
  document.addEventListener(
    'click',
    function (e) {
      const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!link) return;
      const rawHref = link.getAttribute('href');
      if (!rawHref || SKIP_RE.test(rawHref.trim())) return;

      const realUrl = extractRealUrl(rawHref);
      if (!realUrl) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      const openNew = e.metaKey || e.ctrlKey || e.button === 1;
      navigateInsideProxy(realUrl, openNew);
    },
    true
  );

  // 8. Intercept middle-click (auxclick) on links -> open in new Bean Proxy tab
  document.addEventListener(
    'auxclick',
    function (e) {
      if (e.button !== 1) return;
      const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!link) return;
      const realUrl = extractRealUrl(link.getAttribute('href'));
      if (!realUrl) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      navigateInsideProxy(realUrl, true);
    },
    true
  );

  // 9. Intercept ALL form submissions (GET forms navigate cleanly via parent Bean Proxy!)
  document.addEventListener(
    'submit',
    function (e) {
      const form = e.target;
      if (!form || !form.getAttribute) return;
      form.setAttribute('target', '_self');

      const method = (form.getAttribute('method') || 'get').toLowerCase();
      const realAction = extractRealUrl(form.getAttribute('action') || TARGET_URL) || TARGET_URL;

      if (method === 'get') {
        e.preventDefault();
        e.stopImmediatePropagation();
        try {
          const u = new URL(realAction);
          const fd = new FormData(form);
          for (const [k, v] of fd.entries()) {
            if (typeof v === 'string') u.searchParams.set(k, v);
          }
          navigateInsideProxy(u.href, false);
        } catch {
          navigateInsideProxy(realAction, false);
        }
      } else {
        form.setAttribute('action', wrapUrl(realAction));
      }
    },
    true
  );

  // 10. Intercept dynamic Element.prototype.setAttribute for src/href/action/target
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

  // 11. Strip target="_blank"/"_top"/"_parent" on dynamically injected links/forms
  const scrubTargets = (root) => {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('a[target], form[target], area[target]').forEach((el) => {
      if (el.getAttribute('target') !== '_self') el.setAttribute('target', '_self');
    });
  };
  window.addEventListener('DOMContentLoaded', () => {
    scrubTargets(document);
    try {
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) scrubTargets(node);
          }
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      // ignore
    }
  });

  // 12. Guard history.pushState / replaceState
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

  // 13. Notify parent portal frame of title/URL changes for tab bar sync
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
