const http = require('http');
const https = require('https');
const zlib = require('zlib');
const net = require('net');
const {
  PROXY_PREFIX,
  REQUEST_TIMEOUT_MS,
  MAX_REDIRECTS,
  ALLOW_PRIVATE_NETWORKS,
  encodeProxyUrl,
  decodeProxyUrl
} = require('../config');
const adblock = require('../middleware/adblock');
const { buildOutboundHeaders, applyProxyResponseHeaders } = require('../middleware/headers');
const { cookieJar, parseSimpleCookies } = require('./cookieJar');
const { rewriteHtml, rewriteCss } = require('./rewriter');
const networkLog = require('./networkLog');
const store = require('../data/store');

function isPrivateOrReservedHost(hostname) {
  if (ALLOW_PRIVATE_NETWORKS) return false;
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) {
    return true;
  }
  if (net.isIPv4(lower)) {
    const parts = lower.split('.').map(Number);
    if (parts[0] === 127) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
  }
  if (net.isIPv6(lower)) {
    if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
  }
  return false;
}

function extractTargetUrl(req) {
  if (req.query && req.query.url) {
    return String(req.query.url);
  }
  const prefixNoSlashes = PROXY_PREFIX.replace(/^\/+|\/+$/g, '');
  let rawPath = (req.path || '').replace(/^\/+/, '');
  if (rawPath === prefixNoSlashes) {
    rawPath = '';
  } else if (rawPath.startsWith(prefixNoSlashes + '/')) {
    rawPath = rawPath.slice(prefixNoSlashes.length + 1);
  }
  if (!rawPath) return null;

  if (/^https?:\/\//i.test(rawPath)) {
    return rawPath;
  }
  try {
    const token = rawPath.split('/')[0];
    const decoded = decodeProxyUrl(token);
    if (/^https?:\/\//i.test(decoded)) {
      return decoded;
    }
  } catch {
    return null;
  }
  return null;
}

function decompressBody(buffer, encoding) {
  return new Promise((resolve, reject) => {
    const enc = (encoding || '').toLowerCase().trim();
    if (enc === 'gzip') {
      zlib.gunzip(buffer, (err, res) => (err ? reject(err) : resolve(res)));
    } else if (enc === 'deflate') {
      zlib.inflate(buffer, (err, res) => (err ? reject(err) : resolve(res)));
    } else if (enc === 'br') {
      zlib.brotliDecompress(buffer, (err, res) => (err ? reject(err) : resolve(res)));
    } else {
      resolve(buffer);
    }
  });
}

function fetchUpstream(targetUrl, method, headers, bodyBuffer, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return reject(new Error('Invalid target URL'));
    }

    if (!/^https?:$/i.test(parsed.protocol)) {
      return reject(new Error('Unsupported protocol'));
    }

    if (isPrivateOrReservedHost(parsed.hostname)) {
      const err = new Error('Access to private or local network addresses is blocked');
      err.statusCode = 403;
      return reject(err);
    }

    const transport = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers,
      timeout: REQUEST_TIMEOUT_MS,
      rejectUnauthorized: true
    };

    const upstreamReq = transport.request(options, (upstreamRes) => {
      resolve({ upstreamRes, finalUrl: targetUrl, redirectCount });
    });

    upstreamReq.on('timeout', () => {
      upstreamReq.destroy(new Error('Upstream request timed out'));
    });

    upstreamReq.on('error', (err) => {
      reject(err);
    });

    if (bodyBuffer && bodyBuffer.length > 0 && method !== 'GET' && method !== 'HEAD') {
      upstreamReq.write(bodyBuffer);
    }
    upstreamReq.end();
  });
}

async function handleProxyRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    return res.status(204).end();
  }

  const startTime = Date.now();
  const targetUrl = extractTargetUrl(req);
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing or invalid target URL' });
  }

  // Maintenance mode check (Owner & Admins bypass)
  const portalSettings = store.getSettings();
  if (portalSettings.maintenanceMode) {
    const cookies = parseSimpleCookies(req.headers.cookie || '');
    const user = store.getUserByToken(cookies.bean_auth);
    if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
      return res
        .status(503)
        .type('text/html')
        .send(
          `<!DOCTYPE html><html><body style="background:#090b10;color:#e2e8f0;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;"><div><h1 style="color:#f59e0b;">Bean Proxy Maintenance</h1><p style="color:#94a3b8;">${portalSettings.maintenanceMessage}</p></div></body></html>`
        );
    }
  }

  // Staff-blocked sites check
  try {
    const host = new URL(targetUrl).hostname;
    if (store.isSiteBlocked(host)) {
      return res
        .status(403)
        .type('text/html')
        .send(
          `<!DOCTYPE html><html><body style="background:#090b10;color:#e2e8f0;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;"><div><h1 style="color:#f43f5e;">Site Blocked by Administrator</h1><p style="color:#94a3b8;">${host} is currently restricted on this portal.</p></div></body></html>`
        );
    }
  } catch {
    // Handled downstream
  }

  if (adblock.isEnabled(req) && adblock.shouldBlock(targetUrl)) {
    networkLog.record({
      method: req.method,
      url: targetUrl,
      status: 204,
      blocked: true,
      durationMs: Date.now() - startTime
    });
    const accept = (req.headers.accept || '').toLowerCase();
    if (accept.includes('javascript') || targetUrl.endsWith('.js')) {
      return res.status(200).type('application/javascript').send('/* Blocked by Bean Proxy */');
    }
    return res.status(204).end();
  }

  const sessionId = cookieJar.getOrCreateSessionId(req, res);
  const proxyOrigin = `${req.protocol}://${req.get('host')}`;

  const bodyChunks = [];
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    await new Promise((resolve) => {
      req.on('data', (chunk) => bodyChunks.push(chunk));
      req.on('end', resolve);
      req.on('error', resolve);
    });
  }
  const bodyBuffer = Buffer.concat(bodyChunks);

  try {
    let currentUrl = targetUrl;
    let redirects = 0;
    let result;

    while (true) {
      const cookieHeader = cookieJar.getCookieHeader(sessionId, currentUrl);
      const outboundHeaders = buildOutboundHeaders(req, currentUrl, cookieHeader);

      result = await fetchUpstream(currentUrl, req.method, outboundHeaders, bodyBuffer, redirects);
      const { upstreamRes } = result;

      if (upstreamRes.headers['set-cookie']) {
        cookieJar.storeCookies(sessionId, currentUrl, upstreamRes.headers['set-cookie']);
      }

      const status = upstreamRes.statusCode || 200;
      const location = upstreamRes.headers.location;

      if ([301, 302, 303, 307, 308].includes(status) && location) {
        upstreamRes.resume();
        if (redirects >= MAX_REDIRECTS) {
          const proxiedLoc = `${PROXY_PREFIX}${encodeProxyUrl(new URL(location, currentUrl).href)}`;
          res.setHeader('Location', proxiedLoc);
          return res.status(status).end();
        }
        currentUrl = new URL(location, currentUrl).href;
        redirects += 1;
        continue;
      }
      break;
    }

    const { upstreamRes } = result;
    const status = upstreamRes.statusCode || 200;
    const contentType = (upstreamRes.headers['content-type'] || '').toLowerCase();
    const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
    const isCss = contentType.includes('text/css');

    networkLog.record({
      method: req.method,
      url: currentUrl,
      status,
      contentType: contentType.split(';')[0] || 'unknown',
      blocked: false,
      durationMs: Date.now() - startTime
    });

    if (isHtml || isCss) {
      const chunks = [];
      upstreamRes.on('data', (chunk) => chunks.push(chunk));
      upstreamRes.on('end', async () => {
        try {
          const rawBuf = Buffer.concat(chunks);
          const plainBuf = await decompressBody(rawBuf, upstreamRes.headers['content-encoding']);
          const text = plainBuf.toString('utf8');

          const rewritten = isHtml
            ? rewriteHtml(text, currentUrl, proxyOrigin, PROXY_PREFIX)
            : rewriteCss(text, currentUrl, PROXY_PREFIX);

          applyProxyResponseHeaders(res, upstreamRes.headers, true);
          res.status(status).send(rewritten);
        } catch (err) {
          if (!res.headersSent) {
            res.status(502).json({ error: 'Failed to rewrite upstream content', details: err.message });
          }
        }
      });
      upstreamRes.on('error', (err) => {
        if (!res.headersSent) {
          res.status(502).json({ error: 'Upstream stream error', details: err.message });
        }
      });
    } else {
      applyProxyResponseHeaders(res, upstreamRes.headers, false);
      res.status(status);
      upstreamRes.pipe(res);
    }
  } catch (err) {
    networkLog.record({
      method: req.method,
      url: targetUrl,
      status: err.statusCode || 502,
      blocked: false,
      error: err.message,
      durationMs: Date.now() - startTime
    });
    if (!res.headersSent) {
      res.status(err.statusCode || 502).json({
        error: 'Proxy request failed',
        message: err.message,
        target: targetUrl
      });
    }
  }
}

module.exports = {
  handleProxyRequest
};
