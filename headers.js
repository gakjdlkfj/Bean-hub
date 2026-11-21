const { USER_AGENTS } = require('../config');
const { parseSimpleCookies } = require('../proxy/cookieJar');

const STRIPPED_RESPONSE_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-content-security-policy',
  'x-webkit-csp',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'permissions-policy',
  'strict-transport-security',
  'clear-site-data',
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'set-cookie'
]);

const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'x-proxy-ua',
  'x-proxy-adblock',
  'cookie'
]);

/**
 * Resolve User-Agent from request header, cookie preset, or default Chrome UA.
 */
function resolveUserAgent(req) {
  const headerUA = req.headers['x-proxy-ua'];
  if (headerUA) {
    return USER_AGENTS[headerUA]?.value || headerUA;
  }

  const cookies = parseSimpleCookies(req.headers.cookie || '');
  if (cookies.proxy_ua) {
    return USER_AGENTS[cookies.proxy_ua]?.value || cookies.proxy_ua;
  }

  return USER_AGENTS.chrome_win.value;
}

/**
 * Build sanitized outbound request headers for the target origin.
 */
function buildOutboundHeaders(req, targetUrl, cookieHeader) {
  const target = new URL(targetUrl);
  const headers = {};

  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (STRIPPED_REQUEST_HEADERS.has(lower)) continue;
    headers[lower] = value;
  }

  headers['host'] = target.host;
  headers['origin'] = target.origin;
  headers['referer'] = target.origin + '/';
  headers['user-agent'] = resolveUserAgent(req);
  headers['accept-encoding'] = 'gzip, deflate, br';

  if (cookieHeader) {
    headers['cookie'] = cookieHeader;
  }

  return headers;
}

/**
 * Apply permissive CORS and strip frame/CSP restrictions on proxy responses.
 */
function applyProxyResponseHeaders(res, upstreamHeaders, isRewritten) {
  for (const [key, value] of Object.entries(upstreamHeaders)) {
    const lower = key.toLowerCase();
    if (STRIPPED_RESPONSE_HEADERS.has(lower)) continue;
    // Keep content-length/encoding only if we are streaming raw binary untouched
    if (!isRewritten && (lower === 'content-length' || lower === 'content-encoding')) {
      res.setHeader(key, value);
      continue;
    }
    res.setHeader(key, value);
  }

  if (!isRewritten && upstreamHeaders['content-length']) {
    res.setHeader('Content-Length', upstreamHeaders['content-length']);
  }
  if (!isRewritten && upstreamHeaders['content-encoding']) {
    res.setHeader('Content-Encoding', upstreamHeaders['content-encoding']);
  }

  // Rewrite HTTP Refresh header through the proxy if present
  if (upstreamHeaders['refresh']) {
    const rewrittenRefresh = String(upstreamHeaders['refresh']).replace(
      /(url\s*=\s*['"]?)([^'"\s;]+)(['"]?)/i,
      (_, p1, u, p3) =>
        `${p1}/proxy/${Buffer.from(u, 'utf8')
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/g, '')}${p3}`
    );
    res.setHeader('Refresh', rewrittenRefresh);
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('X-Proxy-Powered-By', 'StealthPortal');
}

module.exports = {
  resolveUserAgent,
  buildOutboundHeaders,
  applyProxyResponseHeaders
};
