const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const QUICK_EMOJIS = ['😂', '🫘', '🔥', '👍', '💀', '🎮', '👑', '🤯'];

export class LiveChat {
  constructor(options) {
    this.root = options.root;
    this.getUser = options.getUser;
    this.onOpenAuth = options.onOpenAuth;
    this.onToast = options.onToast;
    this.onAnnouncement = options.onAnnouncement;
    this.onUnreadChange = options.onUnreadChange;
    this.onGamesUpdated = options.onGamesUpdated;
    this.onSettingsUpdated = options.onSettingsUpdated;

    this.ws = null;
    this.channels = [{ id: 'general', name: 'general', icon: '💬', topic: 'Main Bean Lounge' }];
    this.activeChannelId = 'general';
    this.messages = [];
    this.onlineUsers = [];
    this.voiceState = {}; // channelId -> participants[]
    this.isVisible = false;
    this.unread = 0;
    this.reconnectTimer = null;

    // Reply & Typing state
    this.replyTo = null;
    this.typingUsers = new Map(); // userId -> { username, timer }
    this.lastTypingSent = 0;

    // WebRTC Voice & Screen Share state
    this.voiceChannelId = null;
    this.localAudioStream = null;
    this.localScreenStream = null;
    this.micMuted = false;
    this.deafened = false;
    this.peers = new Map(); // userId -> { pc, username, audioEl, screenStream }
    this.remoteScreens = new Map(); // userId -> { username, stream }
    this.focusedScreenUserId = null;
  }

  setVisible(visible) {
    this.isVisible = visible;
    if (visible) {
      this.unread = 0;
      this.onUnreadChange?.(0);
      this.render();
      this.scrollToBottom();
    }
  }

  connect() {
    this.disconnect();
    const user = this.getUser();
    if (!user) {
      this.render();
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws-chat`);
    this.ws = ws;

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'init') {
          this.channels = data.channels?.length ? data.channels : this.channels;
          this.messages = data.messages || [];
          this.onlineUsers = data.onlineUsers || [];
          this.voiceState = data.voiceState || {};
          if (data.portalSettings?.announcement) {
            this.onAnnouncement?.(data.portalSettings.announcement, false);
          }
          this.render();
          this.scrollToBottom();
        } else if (data.type === 'channels_updated') {
          this.channels = data.channels || this.channels;
          if (!this.channels.some((c) => c.id === this.activeChannelId)) {
            this.activeChannelId = 'general';
          }
          this.render();
        } else if (data.type === 'presence') {
          this.onlineUsers = data.onlineUsers || [];
          this.updatePresenceUi();
        } else if (data.type === 'voice_state') {
          this.voiceState = data.voiceState || {};
          this.renderVoiceStrip();
          this.renderChannelsSidebar();
        } else if (data.type === 'voice_peers') {
          for (const peer of data.peers || []) {
            await this.createPeerConnection(peer.userId, peer.username, true);
          }
        } else if (data.type === 'voice_peer_left') {
          this.closePeer(data.userId);
        } else if (data.type === 'voice_kicked') {
          this.leaveVoice(false);
          this.onToast?.(data.message || 'Removed from voice.', 'error');
        } else if (data.type === 'rtc_signal') {
          await this.handleRtcSignal(data);
        } else if (data.type === 'typing') {
          if (data.channelId === this.activeChannelId) {
            this.showTypingUser(data.userId, data.username);
          }
        } else if (data.type === 'message' && data.message) {
          this.messages.push(data.message);
          if (this.messages.length > 500) this.messages.shift();
          if (!this.isVisible) {
            this.unread += 1;
            this.onUnreadChange?.(this.unread);
          }
          if ((data.message.channelId || 'general') === this.activeChannelId) {
            this.renderMessages();
            this.scrollToBottom();
          }
        } else if (data.type === 'message_deleted') {
          this.messages = this.messages.filter((m) => m.id !== data.id);
          this.renderMessages();
        } else if (data.type === 'chat_cleared') {
          if (data.channelId) {
            this.messages = this.messages.filter((m) => (m.channelId || 'general') !== data.channelId);
          } else {
            this.messages = [];
          }
          this.renderMessages();
          this.onToast?.('Chat messages cleared by staff.', 'info');
        } else if (data.type === 'announcement') {
          this.onAnnouncement?.(data.announcement || '', true);
        } else if (data.type === 'settings_updated' && data.portalSettings) {
          this.onSettingsUpdated?.(data.portalSettings);
        } else if (data.type === 'games_updated') {
          this.onGamesUpdated?.();
        } else if (data.type === 'error' && data.message) {
          this.onToast?.(data.message, 'error');
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      if (this.getUser()) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };
  }

  disconnect() {
    this.leaveVoice(false);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  // --- WebRTC Voice & Screen Share ---
  async joinVoice(channelId) {
    if (this.voiceChannelId === channelId) return;
    if (this.voiceChannelId) this.leaveVoice(true);

    try {
      this.localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.micMuted = false;
    } catch {
      // Allow listen-only / screen-share-only join if user has no mic or denied mic
      this.localAudioStream = null;
      this.micMuted = true;
      this.onToast?.('Joined voice in listen-only mode (no mic access).', 'info');
    }

    this.voiceChannelId = channelId;
    this.sendWs({ type: 'voice_join', channelId });
    this.renderVoiceStrip();
    this.onToast?.(`Joined voice in #${channelId}`, 'success');
  }

  leaveVoice(notifyServer = true) {
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((t) => t.stop());
      this.localScreenStream = null;
    }
    if (this.localAudioStream) {
      this.localAudioStream.getTracks().forEach((t) => t.stop());
      this.localAudioStream = null;
    }
    for (const userId of Array.from(this.peers.keys())) {
      this.closePeer(userId);
    }
    this.remoteScreens.clear();
    this.focusedScreenUserId = null;

    if (notifyServer && this.voiceChannelId) {
      this.sendWs({ type: 'voice_leave' });
    }
    this.voiceChannelId = null;
    this.micMuted = false;
    this.renderVoiceStrip();
    this.renderScreenStage();
  }

  toggleMic() {
    if (!this.localAudioStream) {
      this.onToast?.('No microphone stream active.', 'info');
      return;
    }
    this.micMuted = !this.micMuted;
    this.localAudioStream.getAudioTracks().forEach((t) => {
      t.enabled = !this.micMuted;
    });
    this.syncVoiceStateToServer();
    this.renderVoiceStrip();
  }

  toggleDeafen() {
    this.deafened = !this.deafened;
    for (const peer of this.peers.values()) {
      if (peer.audioEl) peer.audioEl.muted = this.deafened;
    }
    this.renderVoiceStrip();
  }

  async toggleScreenShare() {
    if (!this.voiceChannelId) {
      await this.joinVoice(this.activeChannelId);
    }
    if (this.localScreenStream) {
      this.stopScreenShare();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true
      });
      this.localScreenStream = stream;
      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.onended = () => this.stopScreenShare();
      }

      // Add screen tracks to all existing peer connections and renegotiate
      for (const [peerUserId, peer] of this.peers.entries()) {
        stream.getTracks().forEach((track) => peer.pc.addTrack(track, stream));
        await this.renegotiatePeer(peerUserId, peer.pc);
      }

      this.syncVoiceStateToServer();
      this.renderVoiceStrip();
      this.renderScreenStage();
      this.onToast?.('Screen sharing started!', 'success');
    } catch {
      this.onToast?.('Screen share cancelled.', 'info');
    }
  }

  async stopScreenShare() {
    if (!this.localScreenStream) return;
    const tracks = this.localScreenStream.getTracks();
    tracks.forEach((t) => t.stop());
    this.localScreenStream = null;

    for (const [peerUserId, peer] of this.peers.entries()) {
      const senders = peer.pc.getSenders();
      for (const sender of senders) {
        if (sender.track && tracks.includes(sender.track)) {
          peer.pc.removeTrack(sender);
        }
      }
      await this.renegotiatePeer(peerUserId, peer.pc);
    }

    this.syncVoiceStateToServer();
    this.renderVoiceStrip();
    this.renderScreenStage();
  }

  syncVoiceStateToServer() {
    this.sendWs({
      type: 'voice_state_update',
      micMuted: this.micMuted,
      screenSharing: Boolean(this.localScreenStream)
    });
  }

  async createPeerConnection(peerUserId, peerUsername, isInitiator) {
    if (this.peers.has(peerUserId)) return this.peers.get(peerUserId).pc;
    const pc = new RTCPeerConnection(RTC_CONFIG);

    const peerRecord = { pc, username: peerUsername || 'User', audioEl: null };
    this.peers.set(peerUserId, peerRecord);

    if (this.localAudioStream) {
      this.localAudioStream.getTracks().forEach((t) => pc.addTrack(t, this.localAudioStream));
    }
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((t) => pc.addTrack(t, this.localScreenStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendWs({
          type: 'rtc_signal',
          targetUserId: peerUserId,
          signal: { type: 'ice', candidate: e.candidate }
        });
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      if (e.track.kind === 'video') {
        this.remoteScreens.set(peerUserId, { username: peerRecord.username, stream });
        if (!this.focusedScreenUserId) this.focusedScreenUserId = peerUserId;
        e.track.onended = () => {
          this.remoteScreens.delete(peerUserId);
          if (this.focusedScreenUserId === peerUserId) this.focusedScreenUserId = null;
          this.renderScreenStage();
        };
        this.renderScreenStage();
      } else if (e.track.kind === 'audio') {
        if (!peerRecord.audioEl) {
          const audio = document.createElement('audio');
          audio.autoplay = true;
          audio.muted = this.deafened;
          peerRecord.audioEl = audio;
          document.body.appendChild(audio);
        }
        peerRecord.audioEl.srcObject = stream;
      }
    };

    if (isInitiator) {
      await this.renegotiatePeer(peerUserId, pc);
    }
    return pc;
  }

  async renegotiatePeer(peerUserId, pc) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendWs({
        type: 'rtc_signal',
        targetUserId: peerUserId,
        signal: { type: 'offer', sdp: pc.localDescription }
      });
    } catch {
      // ignore
    }
  }

  async handleRtcSignal(data) {
    const { fromUserId, fromUsername, signal } = data;
    if (!this.voiceChannelId) return;
    const pc = await this.createPeerConnection(fromUserId, fromUsername, false);

    try {
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendWs({
          type: 'rtc_signal',
          targetUserId: fromUserId,
          signal: { type: 'answer', sdp: pc.localDescription }
        });
      } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      } else if (signal.type === 'ice' && signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch {
      // ignore transient ICE race
    }
  }

  closePeer(userId) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    try { peer.pc.close(); } catch {}
    if (peer.audioEl) peer.audioEl.remove();
    this.peers.delete(userId);
    if (this.remoteScreens.delete(userId)) {
      if (this.focusedScreenUserId === userId) this.focusedScreenUserId = null;
      this.renderScreenStage();
    }
  }

  sendWs(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  sendMessage(text) {
    const clean = text.trim();
    if (!clean) return;
    this.sendWs({
      type: 'message',
      channelId: this.activeChannelId,
      text: clean,
      replyTo: this.replyTo
    });
    this.replyTo = null;
    this.renderReplyPreview();
  }

  showTypingUser(userId, username) {
    const existing = this.typingUsers.get(userId);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.typingUsers.delete(userId);
      this.renderTypingIndicator();
    }, 2600);
    this.typingUsers.set(userId, { username, timer });
    this.renderTypingIndicator();
  }

  renderTypingIndicator() {
    const el = document.getElementById('chat-typing');
    if (!el) return;
    const names = Array.from(this.typingUsers.values()).map((x) => x.username);
    el.textContent = names.length ? `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} typing…` : '';
  }

  async createGroupPrompt() {
    const name = window.prompt('New chat group name (e.g. homework-help, bean-memes):');
    if (!name || !name.trim()) return;
    const topic = window.prompt('Short group topic (optional):') || '';
    const icon = window.prompt('Group emoji icon (optional, e.g. 🔥):') || '💬';

    try {
      const res = await fetch('/api/admin/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), topic: topic.trim(), icon: icon.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.onToast?.(data.error || 'Could not create group.', 'error');
        return;
      }
      this.channels = data.channels || this.channels;
      this.activeChannelId = data.channel.id;
      this.render();
      this.onToast?.(`Created #${data.channel.name}`, 'success');
    } catch {
      this.onToast?.('Failed to create group.', 'error');
    }
  }

  async deleteChannel(channelId) {
    if (!window.confirm(`Delete group #${channelId} and its messages?`)) return;
    const res = await fetch(`/api/admin/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' });
    if (!res.ok) this.onToast?.('Could not delete group.', 'error');
  }

  async deleteMessage(id) {
    const res = await fetch(`/api/admin/chat/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) this.onToast?.('Failed to delete message.', 'error');
  }

  scrollToBottom() {
    const box = document.getElementById('chat-messages');
    if (box) box.scrollTop = box.scrollHeight;
  }

  updatePresenceUi() {
    const countEl = document.getElementById('chat-online-count');
    if (countEl) countEl.textContent = String(this.onlineUsers.length);
  }

  render() {
    if (!this.root) return;
    const user = this.getUser();

    if (!user) {
      this.root.innerHTML = `
        <div class="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div class="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl mb-4">💬</div>
          <h2 class="text-xl font-bold text-white mb-2">Bean Lounge — Chat, Voice & Screen Share</h2>
          <p class="text-xs text-slate-400 max-w-sm mb-5">
            Sign in or create an account to join chat groups, hop into voice channels, and share your screen live.
          </p>
          <button id="chat-login-cta" class="accent-bg text-slate-950 font-bold text-xs px-5 py-2.5 rounded-xl transition">
            Sign In / Create Account
          </button>
        </div>
      `;
      document.getElementById('chat-login-cta')?.addEventListener('click', () => this.onOpenAuth?.());
      return;
    }

    const activeChannel = this.channels.find((c) => c.id === this.activeChannelId) || this.channels[0];
    const isStaff = user.role === 'owner' || user.role === 'admin';

    this.root.innerHTML = `
      <div class="flex-1 flex min-h-0 h-full overflow-hidden">
        <!-- Left Sidebar: Chat Groups -->
        <aside class="w-56 bg-[#0d111b] border-r border-white/10 flex flex-col shrink-0">
          <div class="px-3.5 py-3 border-b border-white/5 flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Chat Groups</span>
            <button id="btn-new-group" class="px-2 py-0.5 rounded-md accent-bg text-slate-950 font-bold text-[11px]" title="Create new chat group">+ New</button>
          </div>
          <div id="chat-channels-list" class="flex-1 overflow-y-auto p-2 space-y-1"></div>
          <div class="p-3 border-t border-white/5 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Online Users</span>
            <span id="chat-online-count" class="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-bold">${this.onlineUsers.length}</span>
          </div>
        </aside>

        <!-- Main Chat + Voice Area -->
        <div class="flex-1 flex flex-col min-w-0 min-h-0">
          <!-- Channel Header -->
          <div class="px-4 py-2.5 bg-[#11151f] border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
            <div class="min-w-0">
              <div class="text-sm font-bold text-white flex items-center gap-1.5">
                <span>${activeChannel?.icon || '💬'}</span>
                <span>#${escapeHtml(activeChannel?.name || 'general')}</span>
              </div>
              <div class="text-[11px] text-slate-400 truncate">${escapeHtml(activeChannel?.topic || 'Bean Lounge channel')}</div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button id="btn-join-voice" class="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                🎙️ ${this.voiceChannelId === this.activeChannelId ? 'In Voice' : 'Join Voice'}
              </button>
              <button id="btn-share-screen" class="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-bold">
                🖥️ Share Screen
              </button>
              ${
                isStaff
                  ? `<button id="chat-clear-channel" class="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold">Clear</button>`
                  : ''
              }
            </div>
          </div>

          <!-- Voice Controls & Participants Strip -->
          <div id="voice-strip" class="hidden px-4 py-2 bg-[#0c1420] border-b border-emerald-500/20 flex flex-wrap items-center justify-between gap-2 shrink-0"></div>

          <!-- Live Screen Share Video Stage -->
          <div id="screen-stage" class="hidden bg-black border-b border-white/10 p-3 shrink-0"></div>

          <!-- Messages Feed -->
          <div id="chat-messages" class="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0"></div>

          <!-- Typing Indicator & Reply Banner -->
          <div class="px-4 shrink-0">
            <div id="chat-typing" class="text-[11px] text-slate-400 italic h-4"></div>
            <div id="chat-reply-preview" class="hidden mb-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 flex items-center justify-between text-xs text-slate-300"></div>
          </div>

          <!-- Quick Emoji Bar + Input -->
          <div class="px-4 pb-3 pt-1 shrink-0">
            <div class="flex items-center gap-1 mb-1.5">
              ${QUICK_EMOJIS.map(
                (em) => `<button type="button" data-emoji="${em}" class="px-1.5 py-0.5 rounded hover:bg-white/10 text-sm">${em}</button>`
              ).join('')}
            </div>
            <form id="chat-form" class="flex gap-2">
              <input
                id="chat-input"
                type="text"
                maxlength="600"
                autocomplete="off"
                placeholder="${user.muted ? 'You are muted in chat.' : `Message #${activeChannel?.name || 'general'}...`}"
                ${user.muted ? 'disabled' : ''}
                class="flex-1 bg-[#11151f] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/60 select-text"
              />
              <button type="submit" ${user.muted ? 'disabled' : ''} class="accent-bg text-slate-950 font-bold text-xs px-5 py-2.5 rounded-xl disabled:opacity-40">
                Send
              </button>
            </form>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-new-group')?.addEventListener('click', () => this.createGroupPrompt());
    document.getElementById('btn-join-voice')?.addEventListener('click', () => {
      if (this.voiceChannelId === this.activeChannelId) this.leaveVoice(true);
      else this.joinVoice(this.activeChannelId);
    });
    document.getElementById('btn-share-screen')?.addEventListener('click', () => this.toggleScreenShare());
    document.getElementById('chat-clear-channel')?.addEventListener('click', async () => {
      await fetch('/api/admin/chat/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: this.activeChannelId })
      });
    });

    const inputEl = document.getElementById('chat-input');
    inputEl?.addEventListener('input', () => {
      const now = Date.now();
      if (now - this.lastTypingSent > 1800) {
        this.lastTypingSent = now;
        this.sendWs({ type: 'typing', channelId: this.activeChannelId });
      }
    });

    this.root.querySelectorAll('[data-emoji]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!inputEl || inputEl.disabled) return;
        inputEl.value += btn.getAttribute('data-emoji');
        inputEl.focus();
      });
    });

    document.getElementById('chat-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!inputEl || !inputEl.value.trim()) return;
      this.sendMessage(inputEl.value);
      inputEl.value = '';
    });

    this.renderChannelsSidebar();
    this.renderVoiceStrip();
    this.renderScreenStage();
    this.renderMessages();
    this.renderReplyPreview();
    this.scrollToBottom();
  }

  renderChannelsSidebar() {
    const listEl = document.getElementById('chat-channels-list');
    if (!listEl) return;
    const user = this.getUser();
    const isStaff = user && (user.role === 'owner' || user.role === 'admin');

    listEl.innerHTML = this.channels
      .map((ch) => {
        const active = ch.id === this.activeChannelId;
        const voiceUsers = this.voiceState[ch.id] || [];
        return `
          <div>
            <div data-chan="${escapeHtml(ch.id)}" class="group flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer text-xs transition ${
              active ? 'bg-white/10 text-white font-bold' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }">
              <div class="flex items-center gap-1.5 min-w-0">
                <span>${ch.icon || '💬'}</span>
                <span class="truncate">#${escapeHtml(ch.name)}</span>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                ${voiceUsers.length ? `<span class="text-[10px] text-emerald-400 font-mono">🎙️${voiceUsers.length}</span>` : ''}
                ${
                  isStaff && ch.id !== 'general'
                    ? `<button data-del-chan="${escapeHtml(ch.id)}" class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 px-1">&times;</button>`
                    : ''
                }
              </div>
            </div>
            ${
              voiceUsers.length
                ? `<div class="pl-6 pr-2 py-1 space-y-0.5">
                    ${voiceUsers
                      .map(
                        (vu) =>
                          `<div class="text-[11px] text-slate-400 flex items-center gap-1.5 truncate">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                            <span class="truncate">${escapeHtml(vu.username)}</span>
                            ${vu.micMuted ? '<span>🔇</span>' : ''}
                            ${vu.screenSharing ? '<span class="text-cyan-400 font-bold text-[9px]">LIVE</span>' : ''}
                          </div>`
                      )
                      .join('')}
                  </div>`
                : ''
            }
          </div>`;
      })
      .join('');

    listEl.querySelectorAll('[data-chan]').forEach((row) => {
      row.addEventListener('click', (e) => {
        const delBtn = e.target.closest('[data-del-chan]');
        if (delBtn) {
          this.deleteChannel(delBtn.getAttribute('data-del-chan'));
          return;
        }
        this.activeChannelId = row.getAttribute('data-chan');
        this.replyTo = null;
        this.render();
      });
    });
  }

  renderVoiceStrip() {
    const strip = document.getElementById('voice-strip');
    if (!strip) return;
    const roomUsers = this.voiceState[this.activeChannelId] || [];
    const show = Boolean(this.voiceChannelId) || roomUsers.length > 0;
    strip.classList.toggle('hidden', !show);
    if (!show) return;

    strip.innerHTML = `
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-xs font-bold text-emerald-400">
          ${this.voiceChannelId ? `🔊 Connected to #${escapeHtml(this.voiceChannelId)}` : `🎙️ Active Voice in #${escapeHtml(this.activeChannelId)}`}
        </span>
        <div class="flex items-center gap-1.5 flex-wrap">
          ${(this.voiceState[this.voiceChannelId || this.activeChannelId] || [])
            .map(
              (u) =>
                `<span class="px-2 py-0.5 rounded-full text-[11px] bg-white/5 border border-white/10 text-slate-200">
                  ${escapeHtml(u.username)} ${u.micMuted ? '🔇' : '🎙️'} ${u.screenSharing ? '🖥️' : ''}
                </span>`
            )
            .join('')}
        </div>
      </div>
      ${
        this.voiceChannelId
          ? `<div class="flex items-center gap-1.5">
              <button id="vc-mute" class="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold">${
                this.micMuted ? '🔇 Unmute' : '🎙️ Mute'
              }</button>
              <button id="vc-deafen" class="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold">${
                this.deafened ? '🔈 Undeafen' : '🎧 Deafen'
              }</button>
              <button id="vc-screen" class="px-2.5 py-1 rounded-lg ${
                this.localScreenStream ? 'bg-cyan-500 text-slate-950' : 'bg-white/10 text-cyan-300'
              } text-xs font-bold">${this.localScreenStream ? '⏹ Stop Share' : '🖥️ Share Screen'}</button>
              <button id="vc-leave" class="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-bold">Leave</button>
            </div>`
          : ''
      }
    `;

    document.getElementById('vc-mute')?.addEventListener('click', () => this.toggleMic());
    document.getElementById('vc-deafen')?.addEventListener('click', () => this.toggleDeafen());
    document.getElementById('vc-screen')?.addEventListener('click', () => this.toggleScreenShare());
    document.getElementById('vc-leave')?.addEventListener('click', () => this.leaveVoice(true));
  }

  renderScreenStage() {
    const stage = document.getElementById('screen-stage');
    if (!stage) return;

    const streams = [];
    if (this.localScreenStream) {
      streams.push({ userId: 'local', username: 'Your Screen', stream: this.localScreenStream, muted: true });
    }
    for (const [uid, entry] of this.remoteScreens.entries()) {
      streams.push({ userId: uid, username: entry.username, stream: entry.stream, muted: this.deafened });
    }

    stage.classList.toggle('hidden', streams.length === 0);
    if (!streams.length) {
      stage.innerHTML = '';
      return;
    }

    stage.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-bold text-cyan-400">🖥️ Live Screen Shares (${streams.length})</span>
        <button id="btn-stage-fs" class="px-2 py-0.5 rounded bg-white/10 text-[11px] text-slate-200">⛶ Fullscreen</button>
      </div>
      <div id="screen-video-grid" class="grid grid-cols-1 ${streams.length > 1 ? 'md:grid-cols-2' : ''} gap-2"></div>
    `;

    const grid = document.getElementById('screen-video-grid');
    streams.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'relative rounded-xl overflow-hidden bg-slate-950 border border-white/10';
      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.muted = item.muted;
      video.srcObject = item.stream;
      video.className = 'w-full max-h-64 object-contain bg-black';
      const label = document.createElement('div');
      label.className =
        'absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 text-[11px] font-semibold text-white';
      label.textContent = `🖥️ ${item.username}`;
      card.appendChild(video);
      card.appendChild(label);
      grid.appendChild(card);
    });

    document.getElementById('btn-stage-fs')?.addEventListener('click', () => {
      if (!document.fullscreenElement) stage.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.().catch(() => {});
    });
  }

  renderReplyPreview() {
    const box = document.getElementById('chat-reply-preview');
    if (!box) return;
    if (!this.replyTo) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML = `
      <span class="truncate">Replying to <strong>${escapeHtml(this.replyTo.username)}</strong>: "${escapeHtml(this.replyTo.text)}"</span>
      <button id="cancel-reply" class="text-slate-400 hover:text-white ml-2">&times;</button>
    `;
    document.getElementById('cancel-reply')?.addEventListener('click', () => {
      this.replyTo = null;
      this.renderReplyPreview();
    });
  }

  renderMessages() {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    const currentUser = this.getUser();
    const isStaff = currentUser && (currentUser.role === 'owner' || currentUser.role === 'admin');
    const channelMsgs = this.messages.filter((m) => (m.channelId || 'general') === this.activeChannelId);

    if (!channelMsgs.length) {
      box.innerHTML = `<div class="py-10 text-center text-xs text-slate-500">No messages in #${escapeHtml(this.activeChannelId)} yet. Start the conversation!</div>`;
      return;
    }

    box.innerHTML = channelMsgs
      .map((m) => {
        const isSelf = currentUser && m.userId === currentUser.id;
        const badge =
          m.role === 'owner'
            ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">👑 OWNER</span>'
            : m.role === 'admin'
            ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">🛡️ ADMIN</span>'
            : '';
        const time = m.timestamp
          ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';

        return `
          <div class="group flex items-start gap-2.5 px-3 py-2 rounded-xl ${
            isSelf ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
          }">
            <div class="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-xs font-bold shrink-0 ${
              m.role === 'owner' ? 'text-amber-300' : m.role === 'admin' ? 'text-cyan-300' : 'accent-text'
            }">
              ${escapeHtml((m.username || '?')[0].toUpperCase())}
            </div>
            <div class="flex-1 min-w-0">
              ${
                m.replyTo
                  ? `<div class="text-[11px] text-slate-400 border-l-2 border-emerald-500/50 pl-2 mb-1 truncate">↩ <strong>${escapeHtml(m.replyTo.username)}</strong>: ${escapeHtml(m.replyTo.text)}</div>`
                  : ''
              }
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs font-bold text-slate-100">${escapeHtml(m.username)}</span>
                ${badge}
                <span class="text-[10px] text-slate-500">${time}</span>
              </div>
              <div class="text-sm text-slate-200 break-words select-text mt-0.5">${escapeHtml(m.text)}</div>
            </div>
            <div class="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition">
              <button data-reply-id="${escapeHtml(m.id)}" class="text-xs text-slate-400 hover:text-white px-1.5 py-0.5 rounded" title="Reply">↩</button>
              ${
                isStaff
                  ? `<button data-del-msg="${escapeHtml(m.id)}" class="text-xs text-slate-500 hover:text-rose-400 px-1.5 py-0.5 rounded" title="Delete">&times;</button>`
                  : ''
              }
            </div>
          </div>`;
      })
      .join('');

    box.querySelectorAll('[data-reply-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const msg = channelMsgs.find((x) => x.id === btn.getAttribute('data-reply-id'));
        if (msg) {
          this.replyTo = { id: msg.id, username: msg.username, text: msg.text.slice(0, 80) };
          this.renderReplyPreview();
          document.getElementById('chat-input')?.focus();
        }
      });
    });

    box.querySelectorAll('[data-del-msg]').forEach((btn) => {
      btn.addEventListener('click', () => this.deleteMessage(btn.getAttribute('data-del-msg')));
    });
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
