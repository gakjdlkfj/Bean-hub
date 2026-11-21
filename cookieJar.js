const crypto = require('crypto');

class SessionCookieJar {
  constructor() {
    // Map<sessionId, Map<domain, Map<name, { value, path, expires, httpOnly }>>>
    this.sessions = new Map();
  }

  /**
   * Extract or generate a session ID from incoming request cookies.
   */
  getOrCreateSessionId(req, res) {
    const cookies = parseSimpleCookies(req.headers.cookie || '');
    let sid = cookies.proxy_sid;
    if (!sid || typeof sid !== 'string' || sid.length < 16) {
      sid = crypto.randomBytes(24).toString('hex');
      if (res && !res.headersSent) {
        res.append('Set-Cookie', `proxy_sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
      }
    }
    if (!this.sessions.has(sid)) {
      this.sessions.set(sid, new Map());
    }
    return sid;
  }

  /**
   * Store Set-Cookie headers returned by a proxied origin.
   */
  storeCookies(sessionId, targetUrl, setCookieHeaders) {
    if (!setCookieHeaders || !sessionId) return;
    const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    const urlObj = new URL(targetUrl);
    const defaultDomain = urlObj.hostname.toLowerCase();

    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Map());
    }
    const domainMap = this.sessions.get(sessionId);

    for (const rawCookie of list) {
      const parsed = parseSetCookie(rawCookie, defaultDomain);
      if (!parsed) continue;

      const domainKey = parsed.domain;
      if (!domainMap.has(domainKey)) {
        domainMap.set(domainKey, new Map());
      }
      const cookieStore = domainMap.get(domainKey);

      if (parsed.expires && parsed.expires <= Date.now()) {
        cookieStore.delete(parsed.name);
      } else {
        cookieStore.set(parsed.name, parsed);
      }
    }
  }

  /**
   * Build the Cookie header string for an outbound request to targetUrl.
   */
  getCookieHeader(sessionId, targetUrl) {
    if (!sessionId || !this.sessions.has(sessionId)) return '';
    const urlObj = new URL(targetUrl);
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname || '/';
    const now = Date.now();
    const domainMap = this.sessions.get(sessionId);
    const matched = [];

    for (const [domain, cookieStore] of domainMap.entries()) {
      const domainMatches =
        hostname === domain ||
        (domain.startsWith('.') && hostname.endsWith(domain)) ||
        hostname.endsWith('.' + domain);

      if (!domainMatches) continue;

      for (const [name, cookie] of cookieStore.entries()) {
        if (cookie.expires && cookie.expires <= now) {
          cookieStore.delete(name);
          continue;
        }
        if (pathname.startsWith(cookie.path)) {
          matched.push(`${name}=${cookie.value}`);
        }
      }
    }

    return matched.join('; ');
  }

  /**
   * Count total stored cookies for a session.
   */
  getCookieCount(sessionId) {
    if (!sessionId || !this.sessions.has(sessionId)) return 0;
    let count = 0;
    for (const store of this.sessions.get(sessionId).values()) {
      count += store.size;
    }
    return count;
  }

  /**
   * Wipe all cookies for a given session (used by Panic Key / Clear Data).
   */
  clearSession(sessionId) {
    if (sessionId) {
      this.sessions.delete(sessionId);
    }
  }
}

function parseSimpleCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponentSafe(val);
  }
  return out;
}

function parseSetCookie(raw, defaultDomain) {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split(';').map((p) => p.trim());
  const first = parts.shift();
  if (!first) return null;

  const eqIdx = first.indexOf('=');
  if (eqIdx === -1) return null;

  const name = first.slice(0, eqIdx).trim();
  const value = first.slice(eqIdx + 1).trim();
  if (!name) return null;

  let domain = defaultDomain;
  let path = '/';
  let expires = null;
  let httpOnly = false;

  for (const attr of parts) {
    const [rawKey, ...rest] = attr.split('=');
    const key = rawKey.trim().toLowerCase();
    const val = rest.join('=').trim();

    if (key === 'domain' && val) {
      domain = val.toLowerCase().replace(/^\./, '');
    } else if (key === 'path' && val) {
      path = val;
    } else if (key === 'max-age' && val) {
      const sec = parseInt(val, 10);
      if (!Number.isNaN(sec)) {
        expires = Date.now() + sec * 1000;
      }
    } else if (key === 'expires' && val && expires === null) {
      const ts = Date.parse(val);
      if (!Number.isNaN(ts)) {
        expires = ts;
      }
    } else if (key === 'httponly') {
      httpOnly = true;
    }
  }

  return { name, value, domain, path, expires, httpOnly };
}

function decodeURIComponentSafe(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

module.exports = {
  cookieJar: new SessionCookieJar(),
  parseSimpleCookies
};
