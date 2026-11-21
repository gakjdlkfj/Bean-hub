const express = require('express');
const fs = require('fs');
const path = require('path');
const { PROXY_PREFIX, USER_AGENTS, encodeProxyUrl } = require('../config');
const adblock = require('../middleware/adblock');
const { cookieJar, parseSimpleCookies } = require('../proxy/cookieJar');
const networkLog = require('../proxy/networkLog');

const router = express.Router();

// Health & server diagnostics
router.get('/health', (req, res) => {
  const cookies = parseSimpleCookies(req.headers.cookie || '');
  const sid = cookies.proxy_sid;
  res.json({
    status: 'ok',
    name: 'Bean Proxy',
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    sessionCookies: cookieJar.getCookieCount(sid),
    adblock: adblock.getStats()
  });
});

// Portal configuration (User-Agent presets, proxy prefix)
router.get('/config', (req, res) => {
  res.json({
    proxyPrefix: PROXY_PREFIX,
    userAgents: Object.entries(USER_AGENTS).map(([id, item]) => ({
      id,
      label: item.label,
      value: item.value
    })),
    adblockDomainCount: adblock.domains.size
  });
});

// Encode a URL on demand for client navigation
router.post('/encode', express.json(), (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }
  return res.json({
    encoded: encodeProxyUrl(url),
    proxyUrl: `${PROXY_PREFIX}${encodeProxyUrl(url)}`
  });
});

// Ad-blocker stats & custom domain management
router.get('/adblock/stats', (req, res) => {
  res.json(adblock.getStats());
});

router.post('/adblock/domains', express.json(), (req, res) => {
  const { action, domain } = req.body || {};
  if (!domain) {
    return res.status(400).json({ error: 'Domain is required' });
  }
  if (action === 'remove') {
    adblock.removeDomain(domain);
  } else {
    adblock.addDomain(domain);
  }
  return res.json({ success: true, totalDomains: adblock.domains.size });
});

// Live network request inspector logs
router.get('/network/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  res.json({ logs: networkLog.getAll(limit) });
});

router.post('/network/clear', (req, res) => {
  networkLog.clear();
  res.json({ success: true });
});

// Clear session cookies & network logs (Panic Key / Privacy Wipe)
router.post('/session/clear', (req, res) => {
  const cookies = parseSimpleCookies(req.headers.cookie || '');
  if (cookies.proxy_sid) {
    cookieJar.clearSession(cookies.proxy_sid);
  }
  networkLog.clear();
  res.clearCookie('proxy_sid', { path: '/' });
  res.json({ cleared: true });
});

// Games catalog from JSON config (populated in Step 3)
router.get('/games', (req, res) => {
  const gamesJsonPath = path.join(__dirname, '..', '..', 'public', 'games', 'games.json');
  if (!fs.existsSync(gamesJsonPath)) {
    return res.json({ games: [] });
  }
  try {
    const raw = fs.readFileSync(gamesJsonPath, 'utf8');
    const data = JSON.parse(raw);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load games config', details: err.message });
  }
});

module.exports = router;
