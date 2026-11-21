const WebSocket = require('ws');
const store = require('../data/store');
const { parseSimpleCookies } = require('../proxy/cookieJar');

class ChatHub {
  constructor() {
    this.wss = new WebSocket.Server({ noServer: true });
    this.clients = new Set(); // Set<{ ws, user, voiceChannelId, micMuted, screenSharing, lastMsgAt }>
  }

  handleUpgrade(req, socket, head) {
    const cookies = parseSimpleCookies(req.headers.cookie || '');
    const user = store.getUserByToken(cookies.bean_auth);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const client = {
        ws,
        user,
        voiceChannelId: null,
        micMuted: false,
        screenSharing: false,
        lastMsgAt: 0
      };
      this.clients.add(client);

      ws.send(
        JSON.stringify({
          type: 'init',
          channels: store.listChannels(),
          messages: store.getMessages(null, 200),
          onlineUsers: this.getOnlineUsers(),
          voiceState: this.getVoiceState(),
          portalSettings: store.getSettings()
        })
      );

      this.broadcastPresence();

      ws.on('message', (raw) => {
        try {
          const payload = JSON.parse(raw.toString('utf8'));
          const freshUser = store.findUserById(client.user.id);
          if (!freshUser || freshUser.banned) {
            ws.send(JSON.stringify({ type: 'error', message: 'Your account is banned.' }));
            ws.close(4003, 'Banned');
            return;
          }
          client.user = freshUser;

          if (payload.type === 'message') {
            this.handleTextMessage(client, payload);
          } else if (payload.type === 'typing') {
            this.broadcast(
              {
                type: 'typing',
                channelId: payload.channelId || 'general',
                userId: freshUser.id,
                username: freshUser.username
              },
              client
            );
          } else if (payload.type === 'voice_join') {
            this.handleVoiceJoin(client, payload.channelId || 'general');
          } else if (payload.type === 'voice_leave') {
            this.handleVoiceLeave(client);
          } else if (payload.type === 'voice_state_update') {
            client.micMuted = Boolean(payload.micMuted);
            client.screenSharing = Boolean(payload.screenSharing);
            this.broadcastVoiceState();
          } else if (payload.type === 'rtc_signal') {
            this.relayRtcSignal(client, payload);
          }
        } catch {
          // Ignore malformed JSON
        }
      });

      ws.on('close', () => {
        const wasInVoice = client.voiceChannelId;
        this.clients.delete(client);
        if (wasInVoice) {
          this.broadcastVoiceState();
        }
        this.broadcastPresence();
      });

      ws.on('error', () => {
        this.clients.delete(client);
      });
    });
  }

  handleTextMessage(client, payload) {
    const user = client.user;
    if (user.muted) {
      client.ws.send(JSON.stringify({ type: 'error', message: 'You are currently muted in chat.' }));
      return;
    }

    // Slow mode enforcement (staff bypass slow mode)
    const settings = store.getSettings();
    const isStaff = user.role === 'owner' || user.role === 'admin';
    if (!isStaff && settings.slowModeSeconds > 0) {
      const elapsedSec = (Date.now() - client.lastMsgAt) / 1000;
      if (elapsedSec < settings.slowModeSeconds) {
        const wait = Math.ceil(settings.slowModeSeconds - elapsedSec);
        client.ws.send(
          JSON.stringify({ type: 'error', message: `Slow mode active. Please wait ${wait}s.` })
        );
        return;
      }
    }

    const msg = store.addMessage(user, payload.text, payload.channelId || 'general', payload.replyTo || null);
    if (msg) {
      client.lastMsgAt = Date.now();
      this.broadcast({ type: 'message', message: msg });
    }
  }

  handleVoiceJoin(client, channelId) {
    client.voiceChannelId = channelId;
    client.micMuted = false;
    client.screenSharing = false;

    // Tell the joining client who is already in this voice channel so it can initiate WebRTC offers
    const peers = [];
    for (const other of this.clients) {
      if (other !== client && other.ws.readyState === WebSocket.OPEN && other.voiceChannelId === channelId) {
        peers.push({
          userId: other.user.id,
          username: other.user.username,
          role: other.user.role
        });
      }
    }

    client.ws.send(
      JSON.stringify({
        type: 'voice_peers',
        channelId,
        peers
      })
    );
    this.broadcastVoiceState();
  }

  handleVoiceLeave(client) {
    if (!client.voiceChannelId) return;
    const oldChannel = client.voiceChannelId;
    client.voiceChannelId = null;
    client.micMuted = false;
    client.screenSharing = false;
    this.broadcast({
      type: 'voice_peer_left',
      channelId: oldChannel,
      userId: client.user.id
    });
    this.broadcastVoiceState();
  }

  relayRtcSignal(sender, payload) {
    const targetUserId = payload.targetUserId;
    if (!targetUserId) return;
    for (const c of this.clients) {
      if (c.user.id === targetUserId && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(
          JSON.stringify({
            type: 'rtc_signal',
            fromUserId: sender.user.id,
            fromUsername: sender.user.username,
            fromRole: sender.user.role,
            signal: payload.signal
          })
        );
      }
    }
  }

  getOnlineUsers() {
    const map = new Map();
    for (const c of this.clients) {
      if (c.ws.readyState === WebSocket.OPEN) {
        map.set(c.user.id, {
          id: c.user.id,
          username: c.user.username,
          role: c.user.role,
          voiceChannelId: c.voiceChannelId
        });
      }
    }
    return Array.from(map.values());
  }

  getOnlineCount() {
    return this.getOnlineUsers().length;
  }

  getVoiceState() {
    // Map channelId -> array of participants
    const rooms = {};
    for (const c of this.clients) {
      if (c.ws.readyState === WebSocket.OPEN && c.voiceChannelId) {
        if (!rooms[c.voiceChannelId]) rooms[c.voiceChannelId] = [];
        rooms[c.voiceChannelId].push({
          userId: c.user.id,
          username: c.user.username,
          role: c.user.role,
          micMuted: c.micMuted,
          screenSharing: c.screenSharing
        });
      }
    }
    return rooms;
  }

  broadcastPresence() {
    const onlineUsers = this.getOnlineUsers();
    this.broadcast({
      type: 'presence',
      onlineCount: onlineUsers.length,
      onlineUsers
    });
  }

  broadcastVoiceState() {
    this.broadcast({
      type: 'voice_state',
      voiceState: this.getVoiceState()
    });
  }

  broadcast(data, excludeClient = null) {
    const serialized = JSON.stringify(data);
    for (const c of this.clients) {
      if (c !== excludeClient && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(serialized);
      }
    }
  }

  kickFromVoice(userId) {
    for (const c of this.clients) {
      if (c.user.id === userId && c.voiceChannelId) {
        this.handleVoiceLeave(c);
        c.ws.send(JSON.stringify({ type: 'voice_kicked', message: 'You were disconnected from voice by staff.' }));
      }
    }
  }

  disconnectUser(userId) {
    for (const c of this.clients) {
      if (c.user.id === userId) {
        try {
          c.ws.send(JSON.stringify({ type: 'error', message: 'Disconnected by administrator.' }));
          c.ws.close(4003, 'Disconnected');
        } catch {
          // ignore
        }
        this.clients.delete(c);
      }
    }
    this.broadcastVoiceState();
    this.broadcastPresence();
  }
}

module.exports = { ChatHub };
