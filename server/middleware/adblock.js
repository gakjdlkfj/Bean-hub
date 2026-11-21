const { DEFAULT_ADBLOCK_DOMAINS } = require('../config');
const { parseSimpleCookies } = require('../proxy/cookieJar');

class AdBlocker {
  constructor() {
    this.domains = new Set(DEFAULT_ADBLOCK_DOMAINS.map((d) => d.toLowerCase()));
    this.blockedCount = 0;
    this.recentBlocked = [];
    this.pathPatterns = [
      /\/pagead\//i,
      /\/adserver\//i,
      /\/ads\/[a-z0-9_-]+\.js/i,
      /\/gtag\/js/i,
      /\/gtm\.js/i,
      /\/analytics\.js/i,
      /\/fbevents\.js/i,
      /\/pixel(\.gif|\.png|\?)/i
    ];
  }

  /**
   * Determine if ad-blocking is enabled for the current request.
   */
  isEnabled(req) {
    const headerFlag = req.headers['x-proxy-adblock'];
    if (headerFlag !== undefined) {
      return headerFlag !== 'false' && headerFlag !== '0';
    }
    const cookies = parseSimpleCookies(req.headers.cookie || '');
    if (cookies.proxy_adblock !== undefined) {
      return cookies.proxy_adblock !== 'false' && cookies.proxy_adblock !== '0';
    }
    return true;
  }

  /**
   * Check whether a target URL matches the ad/tracker blocklist.
   */
  shouldBlock(targetUrl) {
    try {
      const parsed = new URL(targetUrl);
      const hostname = parsed.hostname.toLowerCase();

      // Exact or subdomain match
      for (const blockedDomain of this.domains) {
        if (hostname === blockedDomain || hostname.endsWith('.' + blockedDomain)) {
          this.recordBlock(hostname);
          return true;
        }
      }

      // Common tracker path patterns
      const pathAndQuery = parsed.pathname + parsed.search;
      for (const pattern of this.pathPatterns) {
        if (pattern.test(pathAndQuery)) {
          this.recordBlock(hostname);
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  recordBlock(hostname) {
    this.blockedCount += 1;
    this.recentBlocked.unshift({
      domain: hostname,
      timestamp: new Date().toISOString()
    });
    if (this.recentBlocked.length > 25) {
      this.recentBlocked.length = 25;
    }
  }

  addDomain(domain) {
    if (domain && typeof domain === 'string') {
      this.domains.add(domain.trim().toLowerCase());
    }
  }

  removeDomain(domain) {
    if (domain && typeof domain === 'string') {
      this.domains.delete(domain.trim().toLowerCase());
    }
  }

  getStats() {
    return {
      totalDomains: this.domains.size,
      blockedCount: this.blockedCount,
      recentBlocked: this.recentBlocked
    };
  }
}

module.exports = new AdBlocker();
