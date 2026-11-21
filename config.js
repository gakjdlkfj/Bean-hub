require('dotenv').config();

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PROXY_PREFIX = process.env.PROXY_PREFIX || '/proxy/';
const WS_PREFIX = process.env.WS_PREFIX || '/ws-proxy';
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 20000;
const MAX_REDIRECTS = parseInt(process.env.MAX_REDIRECTS, 10) || 5;
const ALLOW_PRIVATE_NETWORKS = process.env.ALLOW_PRIVATE_NETWORKS === 'true';

const USER_AGENTS = {
  chrome_win: {
    label: 'Chrome (Windows 11)',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  },
  chrome_mac: {
    label: 'Chrome (macOS)',
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  },
  firefox_win: {
    label: 'Firefox (Windows)',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0'
  },
  safari_mac: {
    label: 'Safari (macOS)',
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
  },
  mobile_ios: {
    label: 'Safari (iPhone)',
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  },
  mobile_android: {
    label: 'Chrome (Android)',
    value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
  }
};

const DEFAULT_ADBLOCK_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'connect.facebook.net',
  'adnxs.com',
  'adsrvr.org',
  'taboola.com',
  'outbrain.com',
  'scorecardresearch.com',
  'quantserve.com',
  'criteo.com',
  'criteo.net',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'casalemedia.com',
  'adsafeprotected.com',
  'moatads.com',
  'hotjar.com',
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'amplitude.com',
  'demdex.net',
  'krxd.net',
  'amazon-adsystem.com',
  'media.net',
  'yieldmo.com',
  'sharethrough.com',
  'bidswitch.net',
  'rlcdn.com',
  'omtrdc.net',
  'chartbeat.com',
  'newrelic.com',
  'nr-data.net',
  'bugsnag.com'
];

/**
 * Encode a target URL into URL-safe Base64 for clean proxy routing.
 */
function encodeProxyUrl(targetUrl) {
  return Buffer.from(targetUrl, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Decode a URL-safe Base64 proxy token back into a target URL.
 */
function decodeProxyUrl(token) {
  let normalized = token.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4 !== 0) {
    normalized += '=';
  }
  return Buffer.from(normalized, 'base64').toString('utf8');
}

module.exports = {
  PORT,
  PROXY_PREFIX,
  WS_PREFIX,
  REQUEST_TIMEOUT_MS,
  MAX_REDIRECTS,
  ALLOW_PRIVATE_NETWORKS,
  USER_AGENTS,
  DEFAULT_ADBLOCK_DOMAINS,
  encodeProxyUrl,
  decodeProxyUrl
};
