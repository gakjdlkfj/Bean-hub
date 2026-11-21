const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname);
const STORE_PATH = path.join(DATA_DIR, 'store.json');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, hashHex] = storedHash.split(':');
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hashHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

const DEFAULT_CHANNELS = [
  {
    id: 'general',
    name: 'general',
    icon: '💬',
    topic: 'Main Bean Lounge — hang out, chat, and hop in voice!',
    createdBy: 'Gman820288',
    createdAt: new Date().toISOString()
  },
  {
    id: 'gaming',
    name: 'gaming',
    icon: '🎮',
    topic: 'High scores, speedruns, and screen-share sessions',
    createdBy: 'Gman820288',
    createdAt: new Date().toISOString()
  }
];

class PortalStore {
  constructor() {
    this.data = {
      users: [],
      sessions: {},
      channels: [...DEFAULT_CHANNELS],
      messages: [],
      auditLogs: [],
      blockedSites: [],
      settings: {
        registrationsOpen: true,
        announcement: '',
        startupAnnouncement: '',
        startupAnnouncementEnabled: false,
        slowModeSeconds: 0,
        maintenanceMode: false,
        maintenanceMessage: 'Bean Proxy is currently undergoing quick maintenance. Check back soon!'
      }
    };
    this.load();
    this.ensureOwnerAccount();
    this.ensureDefaultChannels();
  }

  load() {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          users: Array.isArray(parsed.users) ? parsed.users : [],
          sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
          channels: Array.isArray(parsed.channels) && parsed.channels.length ? parsed.channels : [...DEFAULT_CHANNELS],
          messages: Array.isArray(parsed.messages)
            ? parsed.messages.map((m) => ({ ...m, channelId: m.channelId || 'general' }))
            : [],
          auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
          blockedSites: Array.isArray(parsed.blockedSites) ? parsed.blockedSites : [],
          settings: {
            registrationsOpen: parsed.settings?.registrationsOpen ?? true,
            announcement: parsed.settings?.announcement || '',
            startupAnnouncement: parsed.settings?.startupAnnouncement || '',
            startupAnnouncementEnabled: Boolean(parsed.settings?.startupAnnouncementEnabled),
            slowModeSeconds: Number(parsed.settings?.slowModeSeconds) || 0,
            maintenanceMode: Boolean(parsed.settings?.maintenanceMode),
            maintenanceMessage:
              parsed.settings?.maintenanceMessage ||
              'Bean Proxy is currently undergoing quick maintenance. Check back soon!'
          }
        };
      }
    } catch {
      // Fallback to fresh store
    }
  }

  save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STORE_PATH, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('[Bean Proxy] Failed to persist store.json:', err.message);
    }
  }

  ensureOwnerAccount() {
    const existing = this.data.users.find(
      (u) => u.username.toLowerCase() === 'gman820288'
    );
    if (!existing) {
      this.data.users.push({
        id: 'usr-owner-' + crypto.randomBytes(6).toString('hex'),
        username: 'Gman820288',
        passwordHash: hashPassword('Food1234'),
        role: 'owner',
        muted: false,
        banned: false,
        createdAt: new Date().toISOString()
      });
      this.save();
    } else if (existing.role !== 'owner') {
      existing.role = 'owner';
      existing.banned = false;
      existing.muted = false;
      this.save();
    }
  }

  ensureDefaultChannels() {
    if (!this.data.channels.some((c) => c.id === 'general')) {
      this.data.channels.unshift(DEFAULT_CHANNELS[0]);
      this.save();
    }
  }

  addAuditLog(actorUsername, action, details = '') {
    this.data.auditLogs.unshift({
      id: 'aud-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex'),
      actor: actorUsername || 'System',
      action,
      details,
      timestamp: new Date().toISOString()
    });
    if (this.data.auditLogs.length > 150) {
      this.data.auditLogs.length = 150;
    }
    this.save();
  }

  getAuditLogs(limit = 60) {
    return this.data.auditLogs.slice(0, limit);
  }

  sanitizeUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      muted: Boolean(user.muted),
      banned: Boolean(user.banned),
      createdAt: user.createdAt
    };
  }

  findUserByUsername(username) {
    if (!username) return null;
    const lower = String(username).trim().toLowerCase();
    return this.data.users.find((u) => u.username.toLowerCase() === lower) || null;
  }

  findUserById(id) {
    return this.data.users.find((u) => u.id === id) || null;
  }

  createUser(username, password) {
    const clean = String(username || '').trim();
    if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(clean)) {
      throw new Error('Username must be 3–24 characters (letters, numbers, _, ., -).');
    }
    if (typeof password !== 'string' || password.length < 4) {
      throw new Error('Password must be at least 4 characters.');
    }
    if (this.findUserByUsername(clean)) {
      throw new Error('That username is already taken.');
    }

    const user = {
      id: 'usr-' + crypto.randomBytes(8).toString('hex'),
      username: clean,
      passwordHash: hashPassword(password),
      role: 'user',
      muted: false,
      banned: false,
      createdAt: new Date().toISOString()
    };
    this.data.users.push(user);
    this.save();
    return user;
  }

  authenticate(username, password) {
    const user = this.findUserByUsername(username);
    if (!user) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    return user;
  }

  createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    this.data.sessions[token] = userId;
    this.save();
    return token;
  }

  getUserByToken(token) {
    if (!token) return null;
    const userId = this.data.sessions[token];
    if (!userId) return null;
    const user = this.findUserById(userId);
    if (!user || user.banned) {
      delete this.data.sessions[token];
      this.save();
      return null;
    }
    return user;
  }

  deleteSession(token) {
    if (token && this.data.sessions[token]) {
      delete this.data.sessions[token];
      this.save();
    }
  }

  revokeUserSessions(userId) {
    let changed = false;
    for (const [token, uid] of Object.entries(this.data.sessions)) {
      if (uid === userId) {
        delete this.data.sessions[token];
        changed = true;
      }
    }
    if (changed) this.save();
  }

  listUsers() {
    const order = { owner: 0, admin: 1, user: 2 };
    return [...this.data.users]
      .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9))
      .map((u) => this.sanitizeUser(u));
  }

  setUserRole(userId, role) {
    const user = this.findUserById(userId);
    if (!user) throw new Error('User not found.');
    if (user.role === 'owner') throw new Error('Cannot change the Owner role.');
    if (!['admin', 'user'].includes(role)) throw new Error('Invalid role.');
    user.role = role;
    this.save();
    return this.sanitizeUser(user);
  }

  setUserMuted(userId, muted) {
    const user = this.findUserById(userId);
    if (!user) throw new Error('User not found.');
    if (user.role === 'owner') throw new Error('Cannot mute the Owner.');
    user.muted = Boolean(muted);
    this.save();
    return this.sanitizeUser(user);
  }

  setUserBanned(userId, banned) {
    const user = this.findUserById(userId);
    if (!user) throw new Error('User not found.');
    if (user.role === 'owner') throw new Error('Cannot ban the Owner.');
    user.banned = Boolean(banned);
    if (user.banned) this.revokeUserSessions(user.id);
    this.save();
    return this.sanitizeUser(user);
  }

  resetUserPassword(userId, newPassword) {
    const user = this.findUserById(userId);
    if (!user) throw new Error('User not found.');
    if (typeof newPassword !== 'string' || newPassword.length < 4) {
      throw new Error('Password must be at least 4 characters.');
    }
    user.passwordHash = hashPassword(newPassword);
    this.revokeUserSessions(user.id);
    this.save();
    return this.sanitizeUser(user);
  }

  deleteUser(userId) {
    const idx = this.data.users.findIndex((u) => u.id === userId);
    if (idx === -1) throw new Error('User not found.');
    if (this.data.users[idx].role === 'owner') {
      throw new Error('Cannot delete the Owner account.');
    }
    this.revokeUserSessions(userId);
    this.data.users.splice(idx, 1);
    this.save();
    return true;
  }

  // --- Channels / Chat Groups ---
  listChannels() {
    return [...this.data.channels];
  }

  createChannel(name, topic, icon, creatorUsername) {
    const slug = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_ ]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 24);
    if (slug.length < 2) {
      throw new Error('Group name must be at least 2 characters.');
    }
    if (this.data.channels.some((c) => c.id === slug)) {
      throw new Error('A chat group with that name already exists.');
    }
    const channel = {
      id: slug,
      name: slug,
      icon: (icon || '💬').slice(0, 4),
      topic: String(topic || '').trim().slice(0, 120),
      createdBy: creatorUsername || 'Unknown',
      createdAt: new Date().toISOString()
    };
    this.data.channels.push(channel);
    this.save();
    return channel;
  }

  deleteChannel(channelId) {
    if (channelId === 'general') throw new Error('Cannot delete #general.');
    const before = this.data.channels.length;
    this.data.channels = this.data.channels.filter((c) => c.id !== channelId);
    if (this.data.channels.length === before) throw new Error('Group not found.');
    this.data.messages = this.data.messages.filter((m) => m.channelId !== channelId);
    this.save();
    return true;
  }

  // --- Messages ---
  addMessage(user, text, channelId = 'general', replyTo = null) {
    const clean = String(text || '').trim().slice(0, 600);
    if (!clean) return null;
    const validChannel = this.data.channels.some((c) => c.id === channelId) ? channelId : 'general';
    const msg = {
      id: 'msg-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'),
      channelId: validChannel,
      userId: user.id,
      username: user.username,
      role: user.role,
      text: clean,
      replyTo: replyTo
        ? {
            id: String(replyTo.id || ''),
            username: String(replyTo.username || '').slice(0, 32),
            text: String(replyTo.text || '').slice(0, 90)
          }
        : null,
      timestamp: new Date().toISOString()
    };
    this.data.messages.push(msg);
    if (this.data.messages.length > 500) {
      this.data.messages = this.data.messages.slice(-500);
    }
    this.save();
    return msg;
  }

  getMessages(channelId = null, limit = 100) {
    const list = channelId
      ? this.data.messages.filter((m) => (m.channelId || 'general') === channelId)
      : this.data.messages;
    return list.slice(-limit);
  }

  deleteMessage(messageId) {
    const before = this.data.messages.length;
    this.data.messages = this.data.messages.filter((m) => m.id !== messageId);
    if (this.data.messages.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  clearMessages(channelId = null) {
    if (channelId) {
      this.data.messages = this.data.messages.filter((m) => (m.channelId || 'general') !== channelId);
    } else {
      this.data.messages = [];
    }
    this.save();
  }

  // --- Blocked Proxy Sites ---
  getBlockedSites() {
    return [...this.data.blockedSites];
  }

  addBlockedSite(domain) {
    const clean = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (!clean) throw new Error('Domain is required.');
    if (!this.data.blockedSites.includes(clean)) {
      this.data.blockedSites.push(clean);
      this.save();
    }
    return this.getBlockedSites();
  }

  removeBlockedSite(domain) {
    const clean = String(domain || '').trim().toLowerCase();
    this.data.blockedSites = this.data.blockedSites.filter((d) => d !== clean);
    this.save();
    return this.getBlockedSites();
  }

  isSiteBlocked(hostname) {
    const lower = String(hostname || '').toLowerCase();
    return this.data.blockedSites.some((d) => lower === d || lower.endsWith('.' + d));
  }

  // --- Portal Settings ---
  getSettings() {
    return { ...this.data.settings };
  }

  updateSettings(patch) {
    if (typeof patch.registrationsOpen === 'boolean') {
      this.data.settings.registrationsOpen = patch.registrationsOpen;
    }
    if (typeof patch.announcement === 'string') {
      this.data.settings.announcement = patch.announcement.trim().slice(0, 300);
    }
    if (typeof patch.startupAnnouncement === 'string') {
      this.data.settings.startupAnnouncement = patch.startupAnnouncement.trim().slice(0, 500);
    }
    if (typeof patch.startupAnnouncementEnabled === 'boolean') {
      this.data.settings.startupAnnouncementEnabled = patch.startupAnnouncementEnabled;
    }
    if (patch.slowModeSeconds !== undefined) {
      this.data.settings.slowModeSeconds = Math.max(0, Math.min(120, Number(patch.slowModeSeconds) || 0));
    }
    if (typeof patch.maintenanceMode === 'boolean') {
      this.data.settings.maintenanceMode = patch.maintenanceMode;
    }
    if (typeof patch.maintenanceMessage === 'string') {
      this.data.settings.maintenanceMessage = patch.maintenanceMessage.trim().slice(0, 240);
    }
    this.save();
    return this.getSettings();
  }
}

module.exports = new PortalStore();
