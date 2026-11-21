const express = require('express');
const fs = require('fs');
const path = require('path');
const store = require('../data/store');
const { requireAuth, requireAdmin, requireOwner } = require('./auth');

const GAMES_JSON_PATH = path.join(__dirname, '..', '..', 'public', 'games', 'games.json');
const CUSTOM_GAMES_DIR = path.join(__dirname, '..', '..', 'public', 'games', 'custom');

function readGamesCatalog() {
  if (!fs.existsSync(GAMES_JSON_PATH)) {
    return { categories: ['All', 'Action', 'Puzzle', 'Arcade', 'Retro'], games: [] };
  }
  return JSON.parse(fs.readFileSync(GAMES_JSON_PATH, 'utf8'));
}

function writeGamesCatalog(catalog) {
  fs.writeFileSync(GAMES_JSON_PATH, JSON.stringify(catalog, null, 2), 'utf8');
}

function createAdminRouter(chatHub) {
  const router = express.Router();

  // --- SIGNED-IN USER CHANNEL CREATION ---
  router.post('/channels', requireAuth, express.json(), (req, res) => {
    try {
      const { name, topic, icon } = req.body || {};
      const channel = store.createChannel(name, topic, icon, req.user.username);
      store.addAuditLog(req.user.username, 'CREATE_CHANNEL', `#${channel.name}`);
      if (chatHub) chatHub.broadcast({ type: 'channels_updated', channels: store.listChannels() });
      res.status(201).json({ channel, channels: store.listChannels() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/channels/:id', requireAdmin, (req, res) => {
    try {
      store.deleteChannel(req.params.id);
      store.addAuditLog(req.user.username, 'DELETE_CHANNEL', `#${req.params.id}`);
      if (chatHub) chatHub.broadcast({ type: 'channels_updated', channels: store.listChannels() });
      res.json({ deleted: true, channels: store.listChannels() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- ADMIN & OWNER ENDPOINTS ---
  router.get('/users', requireAdmin, (req, res) => {
    res.json({
      users: store.listUsers(),
      portalSettings: store.getSettings(),
      onlineUsers: chatHub ? chatHub.getOnlineUsers() : [],
      onlineCount: chatHub ? chatHub.getOnlineCount() : 0,
      auditLogs: store.getAuditLogs(60),
      blockedSites: store.getBlockedSites(),
      games: readGamesCatalog().games || []
    });
  });

  router.post('/users/:id/mute', requireAdmin, express.json(), (req, res) => {
    try {
      const target = store.findUserById(req.params.id);
      if (!target) return res.status(404).json({ error: 'User not found.' });
      if (target.role === 'owner' || (target.role === 'admin' && req.user.role !== 'owner')) {
        return res.status(403).json({ error: 'Insufficient permissions to mute this user.' });
      }
      const updated = store.setUserMuted(req.params.id, req.body?.muted);
      store.addAuditLog(req.user.username, updated.muted ? 'MUTE_USER' : 'UNMUTE_USER', updated.username);
      res.json({ user: updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/users/:id/ban', requireAdmin, express.json(), (req, res) => {
    try {
      const target = store.findUserById(req.params.id);
      if (!target) return res.status(404).json({ error: 'User not found.' });
      if (target.role === 'owner' || (target.role === 'admin' && req.user.role !== 'owner')) {
        return res.status(403).json({ error: 'Insufficient permissions to ban this user.' });
      }
      const updated = store.setUserBanned(req.params.id, req.body?.banned);
      store.addAuditLog(req.user.username, updated.banned ? 'BAN_USER' : 'UNBAN_USER', updated.username);
      if (updated.banned && chatHub) chatHub.disconnectUser(target.id);
      res.json({ user: updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/users/:id/kick-voice', requireAdmin, (req, res) => {
    const target = store.findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (chatHub) chatHub.kickFromVoice(target.id);
    store.addAuditLog(req.user.username, 'KICK_VOICE', target.username);
    res.json({ kicked: true });
  });

  router.delete('/chat/messages/:id', requireAdmin, (req, res) => {
    const deleted = store.deleteMessage(req.params.id);
    if (deleted && chatHub) {
      chatHub.broadcast({ type: 'message_deleted', id: req.params.id });
    }
    res.json({ deleted });
  });

  router.post('/chat/clear', requireAdmin, express.json(), (req, res) => {
    const channelId = req.body?.channelId || null;
    store.clearMessages(channelId);
    store.addAuditLog(req.user.username, 'CLEAR_CHAT', channelId ? `#${channelId}` : 'ALL CHANNELS');
    if (chatHub) chatHub.broadcast({ type: 'chat_cleared', channelId });
    res.json({ cleared: true });
  });

  router.post('/chat/slowmode', requireAdmin, express.json(), (req, res) => {
    const seconds = Number(req.body?.seconds) || 0;
    const updated = store.updateSettings({ slowModeSeconds: seconds });
    store.addAuditLog(req.user.username, 'SET_SLOWMODE', `${updated.slowModeSeconds}s`);
    if (chatHub) chatHub.broadcast({ type: 'settings_updated', portalSettings: updated });
    res.json({ portalSettings: updated });
  });

  router.post('/announcement', requireAdmin, express.json(), (req, res) => {
    const text = String(req.body?.announcement || '');
    const updated = store.updateSettings({ announcement: text });
    store.addAuditLog(req.user.username, 'LIVE_ANNOUNCEMENT', text || '(cleared)');
    if (chatHub) chatHub.broadcast({ type: 'announcement', announcement: updated.announcement });
    res.json({ portalSettings: updated });
  });

  // Blocked proxy domains manager
  router.post('/blocked-sites', requireAdmin, express.json(), (req, res) => {
    try {
      const { action, domain } = req.body || {};
      const list =
        action === 'remove' ? store.removeBlockedSite(domain) : store.addBlockedSite(domain);
      store.addAuditLog(
        req.user.username,
        action === 'remove' ? 'UNBLOCK_SITE' : 'BLOCK_SITE',
        String(domain || '')
      );
      res.json({ blockedSites: list });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- OWNER-ONLY ENDPOINTS ---

  router.post('/owner/users/:id/role', requireOwner, express.json(), (req, res) => {
    try {
      const { role } = req.body || {};
      const updated = store.setUserRole(req.params.id, role);
      store.addAuditLog(req.user.username, 'SET_ROLE', `${updated.username} -> ${updated.role}`);
      if (chatHub) chatHub.broadcast({ type: 'role_updated', userId: updated.id, role: updated.role });
      res.json({ user: updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/owner/users/:id/reset-password', requireOwner, express.json(), (req, res) => {
    try {
      const { newPassword } = req.body || {};
      const updated = store.resetUserPassword(req.params.id, newPassword);
      store.addAuditLog(req.user.username, 'RESET_PASSWORD', updated.username);
      res.json({ user: updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/owner/users/:id', requireOwner, (req, res) => {
    try {
      const target = store.findUserById(req.params.id);
      if (chatHub) chatHub.disconnectUser(req.params.id);
      store.deleteUser(req.params.id);
      store.addAuditLog(req.user.username, 'DELETE_USER', target?.username || req.params.id);
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/owner/settings', requireOwner, express.json(), (req, res) => {
    const updated = store.updateSettings(req.body || {});
    store.addAuditLog(req.user.username, 'UPDATE_OWNER_SETTINGS', JSON.stringify(req.body || {}));
    if (chatHub) chatHub.broadcast({ type: 'settings_updated', portalSettings: updated });
    res.json({ portalSettings: updated });
  });

  // Owner: Add Game by URL or uploaded HTML file (accepts up to 10MB HTML payload)
  router.post('/owner/games', requireOwner, express.json({ limit: '10mb' }), (req, res) => {
    try {
      const { title, category, description, icon, mode, url, htmlContent, controls } = req.body || {};
      const cleanTitle = String(title || '').trim();
      if (!cleanTitle) return res.status(400).json({ error: 'Game title is required.' });

      const id =
        'custom-' +
        cleanTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 28) +
        '-' +
        Date.now().toString(36);

      let gamePath = '';
      if (mode === 'html') {
        if (!htmlContent || typeof htmlContent !== 'string') {
          return res.status(400).json({ error: 'HTML file content is required.' });
        }
        fs.mkdirSync(CUSTOM_GAMES_DIR, { recursive: true });
        const filename = `${id}.html`;
        fs.writeFileSync(path.join(CUSTOM_GAMES_DIR, filename), htmlContent, 'utf8');
        gamePath = `/games/custom/${filename}`;
      } else {
        const cleanUrl = String(url || '').trim();
        if (!/^https?:\/\//i.test(cleanUrl)) {
          return res.status(400).json({ error: 'A valid http:// or https:// URL is required.' });
        }
        gamePath = cleanUrl;
      }

      const catalog = readGamesCatalog();
      const cat = String(category || 'Arcade').trim() || 'Arcade';
      if (!catalog.categories.includes(cat)) {
        catalog.categories.push(cat);
      }

      const newGame = {
        id,
        title: cleanTitle,
        category: cat,
        tags: [cat],
        description: String(description || 'Custom game added by the Owner.').trim(),
        icon: (icon || '🕹️').slice(0, 4),
        accent: '#10b981',
        path: gamePath,
        isExternalUrl: mode !== 'html',
        custom: true,
        controls: String(controls || 'Keyboard / Mouse').trim()
      };

      catalog.games.push(newGame);
      writeGamesCatalog(catalog);
      store.addAuditLog(req.user.username, 'ADD_GAME', `${cleanTitle} (${mode === 'html' ? 'HTML' : 'URL'})`);
      if (chatHub) chatHub.broadcast({ type: 'games_updated' });

      res.status(201).json({ game: newGame, games: catalog.games });
    } catch (err) {
      res.status(500).json({ error: 'Failed to add game: ' + err.message });
    }
  });

  router.delete('/owner/games/:id', requireOwner, (req, res) => {
    try {
      const catalog = readGamesCatalog();
      const target = catalog.games.find((g) => g.id === req.params.id);
      if (!target) return res.status(404).json({ error: 'Game not found.' });
      catalog.games = catalog.games.filter((g) => g.id !== req.params.id);
      writeGamesCatalog(catalog);

      if (target.path && target.path.startsWith('/games/custom/')) {
        const filePath = path.join(CUSTOM_GAMES_DIR, path.basename(target.path));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }

      store.addAuditLog(req.user.username, 'DELETE_GAME', target.title);
      if (chatHub) chatHub.broadcast({ type: 'games_updated' });
      res.json({ deleted: true, games: catalog.games });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createAdminRouter };
