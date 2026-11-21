const cheerio = require('cheerio');
const { PROXY_PREFIX, encodeProxyUrl } = require('../config');

const SKIP_PROTOCOLS = /^(data:|blob:|javascript:|mailto:|tel:|sms:|about:|#)/i;

/**
 * Unwrap common search-engine redirect wrappers (DuckDuckGo /l/?uddg=..., Google /url?q=...).
 */
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
    // keep original
  }
  return resolvedHref;
}

/**
 * Resolve a relative or protocol-relative URL against baseUrl and wrap it in the proxy path.
 */
function rewriteUrl(rawUrl, baseUrl, proxyPrefix = PROXY_PREFIX) {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  const trimmed = rawUrl.trim();
  if (!trimmed || SKIP_PROTOCOLS.test(trimmed)) return rawUrl;

  if (trimmed.startsWith(proxyPrefix)) return trimmed;

  try {
    const resolved = unwrapSearchRedirect(new URL(trimmed, baseUrl).href);
    if (!/^https?:\/\//i.test(resolved)) return rawUrl;
    return `${proxyPrefix}${encodeProxyUrl(resolved)}`;
  } catch {
    return rawUrl;
  }
}

function rewriteCss(cssText, baseUrl, proxyPrefix = PROXY_PREFIX) {
  if (!cssText || typeof cssText !== 'string') return cssText;

  let out = cssText.replace(/@import\s+(["'])([^"']+)\1/gi, (match, quote, url) => {
    const rewritten = rewriteUrl(url, baseUrl, proxyPrefix);
    return `@import ${quote}${rewritten}${quote}`;
  });

  out = out.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, url) => {
    const trimmed = url.trim();
    if (!trimmed || SKIP_PROTOCOLS.test(trimmed)) return match;
    const rewritten = rewriteUrl(trimmed, baseUrl, proxyPrefix);
    return `url(${quote}${rewritten}${quote})`;
  });

  return out;
}

function rewriteSrcset(srcset, baseUrl, proxyPrefix = PROXY_PREFIX) {
  if (!srcset || typeof srcset !== 'string') return srcset;
  return srcset
    .split(',')
    .map((entry) => {
      const parts = entry.trim().split(/\s+/);
      if (!parts[0]) return entry;
      parts[0] = rewriteUrl(parts[0], baseUrl, proxyPrefix);
      return parts.join(' ');
    })
    .join(', ');
}

function rewriteHtml(htmlText, targetUrl, proxyOrigin, proxyPrefix = PROXY_PREFIX) {
  const $ = cheerio.load(htmlText, { decodeEntities: false });

  const baseTagHref = $('base[href]').first().attr('href');
  let effectiveBase = targetUrl;
  if (baseTagHref) {
    try {
      effectiveBase = new URL(baseTagHref, targetUrl).href;
    } catch {
      effectiveBase = targetUrl;
    }
    $('base[href]').remove();
  }

  const urlAttributes = [
    ['a', 'href'],
    ['area', 'href'],
    ['link', 'href'],
    ['script', 'src'],
    ['img', 'src'],
    ['img', 'data-src'],
    ['iframe', 'src'],
    ['frame', 'src'],
    ['source', 'src'],
    ['video', 'src'],
    ['video', 'poster'],
    ['audio', 'src'],
    ['embed', 'src'],
    ['object', 'data'],
    ['form', 'action'],
    ['button', 'formaction'],
    ['input', 'formaction']
  ];

  for (const [tag, attr] of urlAttributes) {
    $(`${tag}[${attr}]`).each((_, el) => {
      const val = $(el).attr(attr);
      if (val) {
        $(el).attr(attr, rewriteUrl(val, effectiveBase, proxyPrefix));
      }
    });
  }

  $('[srcset]').each((_, el) => {
    const val = $(el).attr('srcset');
    if (val) {
      $(el).attr('srcset', rewriteSrcset(val, effectiveBase, proxyPrefix));
    }
  });

  $('[style]').each((_, el) => {
    const styleVal = $(el).attr('style');
    if (styleVal && styleVal.includes('url(')) {
      $(el).attr('style', rewriteCss(styleVal, effectiveBase, proxyPrefix));
    }
  });

  $('style').each((_, el) => {
    const css = $(el).html();
    if (css) {
      $(el).html(rewriteCss(css, effectiveBase, proxyPrefix));
    }
  });

  $('[integrity]').removeAttr('integrity');
  $('[nonce]').removeAttr('nonce');

  // Force all links and forms to stay inside the current proxy iframe (blocks _blank, _top, _parent escapes)
  $('a[target], form[target], area[target]').each((_, el) => {
    $(el).attr('target', '_self');
  });

  // Remove meta CSP/X-Frame-Options and rewrite meta refresh redirects through the proxy
  $('meta[http-equiv]').each((_, el) => {
    const eq = ($(el).attr('http-equiv') || '').toLowerCase();
    if (eq === 'content-security-policy' || eq === 'x-frame-options') {
      $(el).remove();
    } else if (eq === 'refresh') {
      const content = $(el).attr('content') || '';
      const updated = content.replace(/(url\s*=\s*['"]?)([^'"\s;>]+)(['"]?)/i, (_, p1, u, p3) => {
        return `${p1}${rewriteUrl(u, effectiveBase, proxyPrefix)}${p3}`;
      });
      $(el).attr('content', updated);
    }
  });

  const hookTag = `<script src="/__proxy_hook.js" data-target-url="${escapeHtmlAttr(
    targetUrl
  )}" data-proxy-origin="${escapeHtmlAttr(proxyOrigin)}" data-proxy-prefix="${escapeHtmlAttr(
    proxyPrefix
  )}"></script>`;

  if ($('head').length > 0) {
    $('head').prepend(hookTag);
  } else if ($('html').length > 0) {
    $('html').prepend(`<head>${hookTag}</head>`);
  } else {
    return hookTag + $.html();
  }

  return $.html();
}

function escapeHtmlAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  rewriteUrl,
  rewriteCss,
  rewriteHtml,
  unwrapSearchRedirect
};
