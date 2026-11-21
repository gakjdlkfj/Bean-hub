const express = require('express');
const store = require('../data/store');
const { parseSimpleCookies } = require('../proxy/cookieJar');

const router = express.Router();

function getAuthUser(req) {
  const cookies = parseSimpleCookies(req.headers.cookie || '');
  return store.getUserByToken(cookies.bean_auth);
}

function requireAuth(req, res, next) {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (user.role !== 'admin' && user.role !== 'owner') {
    return res.status(403).json({ error: 'Admin or Owner access required' });
  }
  req.user = user;
  next();
}

function requireOwner(req, res, next) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access required' });
  }
  req.user = user;
  next();
}

router.get('/me', (req, res) => {
  const user = getAuthUser(req);
  res.json({
    user: store.sanitizeUser(user),
    portalSettings: store.getSettings()
  });
});

router.post('/register', express.json(), (req, res) => {
  const { username, password } = req.body || {};
  const portalSettings = store.getSettings();
  if (!portalSettings.registrationsOpen) {
    return res.status(403).json({ error: 'New account registrations are currently paused by the Owner.' });
  }
  try {
    const user = store.createUser(username, password);
    const token = store.createSession(user.id);
    res.setHeader('Set-Cookie', `bean_auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
    return res.status(201).json({ user: store.sanitizeUser(user) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/login', express.json(), (req, res) => {
  const { username, password } = req.body || {};
  const existing = store.findUserByUsername(username);
  if (!existing) {
    return res.status(401).json({ error: 'Account not found. Please create an account first.' });
  }
  const user = store.authenticate(username, password);
  if (!user) {
    return res.status(401).json({ error: 'Incorrect password for this account.' });
  }
  if (user.banned) {
    return res.status(403).json({ error: 'This account has been banned.' });
  }
  const token = store.createSession(user.id);
  res.setHeader('Set-Cookie', `bean_auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
  return res.json({ user: store.sanitizeUser(user) });
});

router.post('/logout', (req, res) => {
  const cookies = parseSimpleCookies(req.headers.cookie || '');
  if (cookies.bean_auth) {
    store.deleteSession(cookies.bean_auth);
  }
  res.clearCookie('bean_auth', { path: '/' });
  return res.json({ loggedOut: true });
});

module.exports = {
  authRouter: router,
  getAuthUser,
  requireAuth,
  requireAdmin,
  requireOwner
};
