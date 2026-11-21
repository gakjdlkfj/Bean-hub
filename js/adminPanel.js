export class StaffPanel {
  constructor(options) {
    this.root = options.root;
    this.getUser = options.getUser;
    this.onToast = options.onToast;
    this.onAnnouncement = options.onAnnouncement;
    this.onGamesUpdated = options.onGamesUpdated;
    this.onSettingsUpdated = options.onSettingsUpdated;
    this.onPreviewPopup = options.onPreviewPopup;

    this.activeTab = 'admin'; // 'admin' | 'owner'
    this.users = [];
    this.auditLogs = [];
    this.blockedSites = [];
    this.games = [];
    this.portalSettings = {
      registrationsOpen: true,
      announcement: '',
      startupAnnouncement: '',
      startupAnnouncementEnabled: false,
      slowModeSeconds: 0,
      maintenanceMode: false,
      maintenanceMessage: ''
    };
    this.onlineCount = 0;
    this.gameAddMode = 'url'; // 'url' | 'html'
  }

  async refresh() {
    const user = this.getUser();
    if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
      this.renderUnauthorized();
      return;
    }

    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        this.renderUnauthorized();
        return;
      }
      const data = await res.json();
      this.users = data.users || [];
      this.portalSettings = data.portalSettings || this.portalSettings;
      this.onlineCount = data.onlineCount || 0;
      this.auditLogs = data.auditLogs || [];
      this.blockedSites = data.blockedSites || [];
      this.games = data.games || [];
      this.render();
    } catch {
      this.onToast?.('Failed to load staff panel.', 'error');
    }
  }

  renderUnauthorized() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div class="text-4xl mb-3">🔒</div>
        <h2 class="text-lg font-bold text-white mb-1">Restricted Area</h2>
        <p class="text-xs text-slate-400">Admin or Owner privileges are required to view this panel.</p>
      </div>
    `;
  }

  async callApi(url, method = 'POST', body = undefined) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.onToast?.(data.error || 'Action failed.', 'error');
      return null;
    }
    return data;
  }

  render() {
    if (!this.root) return;
    const me = this.getUser();
    const isOwner = me?.role === 'owner';
    const admins = this.users.filter((u) => u.role === 'admin');
    const regulars = this.users.filter((u) => u.role === 'user');

    this.root.innerHTML = `
      <div class="flex-1 overflow-y-auto px-6 py-6">
        <div class="max-w-5xl mx-auto space-y-6">
          <!-- Header & Sub-Tabs -->
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div class="text-xs font-bold uppercase tracking-wider ${isOwner ? 'text-amber-400' : 'text-cyan-400'}">
                ${isOwner ? '👑 Owner & Admin Command Center' : '🛡️ Admin Moderation Panel'}
              </div>
              <h2 class="text-2xl font-extrabold text-white">Bean Proxy Control Center</h2>
            </div>

            <div class="flex items-center gap-2">
              <div class="flex bg-white/5 p-1 rounded-xl border border-white/10">
                <button id="sp-tab-admin" class="px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  this.activeTab === 'admin' ? 'bg-cyan-500 text-slate-950' : 'text-slate-300'
                }">🛡️ Admin Panel</button>
                ${
                  isOwner
                    ? `<button id="sp-tab-owner" class="px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                        this.activeTab === 'owner' ? 'bg-amber-400 text-slate-950' : 'text-slate-300'
                      }">👑 Owner Panel</button>`
                    : ''
                }
              </div>
              <button id="sp-refresh" class="nav-btn px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-300">↻ Refresh</button>
            </div>
          </div>

          <!-- Stats Row -->
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div class="glass-panel rounded-xl p-3.5">
              <div class="text-[11px] text-slate-400">Accounts</div>
              <div class="text-xl font-extrabold text-white mt-0.5">${this.users.length}</div>
            </div>
            <div class="glass-panel rounded-xl p-3.5">
              <div class="text-[11px] text-slate-400">Admins</div>
              <div class="text-xl font-extrabold text-cyan-400 mt-0.5">${admins.length}</div>
            </div>
            <div class="glass-panel rounded-xl p-3.5">
              <div class="text-[11px] text-slate-400">Online Now</div>
              <div class="text-xl font-extrabold text-emerald-400 mt-0.5">${this.onlineCount}</div>
            </div>
            <div class="glass-panel rounded-xl p-3.5">
              <div class="text-[11px] text-slate-400">Games Catalog</div>
              <div class="text-xl font-extrabold text-amber-400 mt-0.5">${this.games.length}</div>
            </div>
            <div class="glass-panel rounded-xl p-3.5">
              <div class="text-[11px] text-slate-400">Maintenance</div>
              <div class="text-base font-extrabold mt-1 ${
                this.portalSettings.maintenanceMode ? 'text-rose-400' : 'text-emerald-400'
              }">${this.portalSettings.maintenanceMode ? 'ON' : 'OFF'}</div>
            </div>
          </div>

          ${
            this.activeTab === 'owner' && isOwner
              ? this.renderOwnerSection(admins, regulars)
              : this.renderAdminSection(isOwner)
          }
        </div>
      </div>
    `;

    this.bindEvents(isOwner);
  }

  bindEvents() {
    document.getElementById('sp-tab-admin')?.addEventListener('click', () => {
      this.activeTab = 'admin';
      this.render();
    });
    document.getElementById('sp-tab-owner')?.addEventListener('click', () => {
      this.activeTab = 'owner';
      this.render();
    });
    document.getElementById('sp-refresh')?.addEventListener('click', () => this.refresh());

    // Live Dismissible Announcement
    document.getElementById('sp-announce-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = document.getElementById('sp-announce-input')?.value || '';
      const data = await this.callApi('/api/admin/announcement', 'POST', { announcement: val });
      if (data) {
        this.portalSettings = data.portalSettings;
        this.onAnnouncement?.(this.portalSettings.announcement, true);
        this.onToast?.(val.trim() ? 'Live announcement broadcast!' : 'Announcement cleared.', 'success');
      }
    });

    document.getElementById('sp-announce-clear')?.addEventListener('click', async () => {
      const data = await this.callApi('/api/admin/announcement', 'POST', { announcement: '' });
      if (data) {
        this.portalSettings = data.portalSettings;
        const input = document.getElementById('sp-announce-input');
        if (input) input.value = '';
        this.onAnnouncement?.('', false);
        this.onToast?.('Live announcement banner cleared.', 'info');
      }
    });

    // Slow Mode
    document.getElementById('sp-slowmode')?.addEventListener('change', async (e) => {
      const data = await this.callApi('/api/admin/chat/slowmode', 'POST', {
        seconds: Number(e.target.value)
      });
      if (data) {
        this.portalSettings = data.portalSettings;
        this.onToast?.(`Chat slow mode set to ${data.portalSettings.slowModeSeconds}s`, 'info');
      }
    });

    // Clear Chat
    document.getElementById('sp-clear-chat')?.addEventListener('click', async () => {
      const data = await this.callApi('/api/admin/chat/clear', 'POST', {});
      if (data) this.onToast?.('All chat rooms cleared.', 'success');
    });

    // Blocked Proxy Sites
    document.getElementById('sp-block-site-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('sp-block-site-input');
      const domain = input?.value.trim();
      if (!domain) return;
      const data = await this.callApi('/api/admin/blocked-sites', 'POST', { action: 'add', domain });
      if (data) {
        this.blockedSites = data.blockedSites;
        input.value = '';
        this.onToast?.(`Blocked ${domain}`, 'success');
        this.render();
      }
    });

    this.root.querySelectorAll('[data-unblock-site]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const domain = btn.getAttribute('data-unblock-site');
        const data = await this.callApi('/api/admin/blocked-sites', 'POST', { action: 'remove', domain });
        if (data) {
          this.blockedSites = data.blockedSites;
          this.onToast?.(`Unblocked ${domain}`, 'info');
          this.render();
        }
      });
    });

    // User Moderation
    this.root.querySelectorAll('[data-mute-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-mute-id');
        const next = btn.getAttribute('data-next') === 'true';
        const data = await this.callApi(`/api/admin/users/${id}/mute`, 'POST', { muted: next });
        if (data) {
          this.onToast?.(`${data.user.username} ${next ? 'muted' : 'unmuted'}.`, 'info');
          this.refresh();
        }
      });
    });

    this.root.querySelectorAll('[data-ban-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-ban-id');
        const next = btn.getAttribute('data-next') === 'true';
        const data = await this.callApi(`/api/admin/users/${id}/ban`, 'POST', { banned: next });
        if (data) {
          this.onToast?.(`${data.user.username} ${next ? 'banned' : 'unbanned'}.`, 'info');
          this.refresh();
        }
      });
    });

    this.root.querySelectorAll('[data-kick-vc]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-kick-vc');
        const data = await this.callApi(`/api/admin/users/${id}/kick-voice`, 'POST');
        if (data) this.onToast?.('User kicked from voice.', 'info');
      });
    });

    // --- OWNER ACTIONS ---
    document.getElementById('owner-reg-toggle')?.addEventListener('change', async (e) => {
      const data = await this.callApi('/api/admin/owner/settings', 'POST', {
        registrationsOpen: e.target.checked
      });
      if (data) {
        this.portalSettings = data.portalSettings;
        this.onToast?.(`Signups ${e.target.checked ? 'opened' : 'paused'}.`, 'success');
        this.render();
      }
    });

    const saveMaintenance = async () => {
      const enabled = document.getElementById('owner-maint-toggle')?.checked;
      const msg = document.getElementById('owner-maint-msg')?.value || '';
      const data = await this.callApi('/api/admin/owner/settings', 'POST', {
        maintenanceMode: Boolean(enabled),
        maintenanceMessage: msg
      });
      if (data) {
        this.portalSettings = data.portalSettings;
        this.onSettingsUpdated?.(this.portalSettings);
        this.onToast?.(
          enabled ? 'Maintenance Lock ENABLED — only Owner & Admins can access the site.' : 'Maintenance Lock disabled.',
          enabled ? 'info' : 'success'
        );
        this.render();
      }
    };

    document.getElementById('owner-maint-toggle')?.addEventListener('change', saveMaintenance);
    document.getElementById('owner-maint-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      saveMaintenance();
    });

    // Sticky Startup Popup Announcement (Shows every time someone opens the site)
    document.getElementById('owner-startup-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const enabled = document.getElementById('owner-startup-toggle')?.checked;
      const text = document.getElementById('owner-startup-text')?.value || '';
      const data = await this.callApi('/api/admin/owner/settings', 'POST', {
        startupAnnouncementEnabled: Boolean(enabled),
        startupAnnouncement: text
      });
      if (data) {
        this.portalSettings = data.portalSettings;
        this.onSettingsUpdated?.(this.portalSettings);
        this.onToast?.(
          enabled && text.trim()
            ? 'Startup announcement saved! It will appear every time the portal opens.'
            : 'Startup announcement updated.',
          'success'
        );
        this.render();
      }
    });

    document.getElementById('owner-startup-preview')?.addEventListener('click', () => {
      const text = document.getElementById('owner-startup-text')?.value?.trim() || this.portalSettings.startupAnnouncement;
      if (!text) {
        this.onToast?.('Enter a startup announcement message first.', 'info');
        return;
      }
      this.onPreviewPopup?.(text, '👑 Owner Startup Notice (Preview)');
    });

    // Add Game by URL or HTML File
    document.getElementById('game-mode-url')?.addEventListener('click', () => {
      this.gameAddMode = 'url';
      this.render();
    });
    document.getElementById('game-mode-html')?.addEventListener('click', () => {
      this.gameAddMode = 'html';
      this.render();
    });

    document.getElementById('owner-add-game-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('og-title')?.value.trim();
      const category = document.getElementById('og-cat')?.value;
      const icon = document.getElementById('og-icon')?.value.trim() || '🕹️';
      const description = document.getElementById('og-desc')?.value.trim();
      const controls = document.getElementById('og-controls')?.value.trim();

      const payload = { title, category, icon, description, controls, mode: this.gameAddMode };

      if (this.gameAddMode === 'html') {
        const fileInput = document.getElementById('og-file');
        const file = fileInput?.files?.[0];
        if (!file) {
          this.onToast?.('Please select an .html file to upload.', 'error');
          return;
        }
        payload.htmlContent = await file.text();
      } else {
        payload.url = document.getElementById('og-url')?.value.trim();
      }

      const data = await this.callApi('/api/admin/owner/games', 'POST', payload);
      if (data) {
        this.games = data.games || this.games;
        this.onGamesUpdated?.();
        this.onToast?.(`Added "${data.game.title}" to the Games Catalog!`, 'success');
        this.refresh();
      }
    });

    this.root.querySelectorAll('[data-del-game]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-del-game');
        if (!window.confirm('Remove this game from the catalog?')) return;
        const data = await this.callApi(`/api/admin/owner/games/${id}`, 'DELETE');
        if (data) {
          this.games = data.games || [];
          this.onGamesUpdated?.();
          this.onToast?.('Game removed from catalog.', 'info');
          this.refresh();
        }
      });
    });

    // Role / Password / Delete User
    this.root.querySelectorAll('[data-role-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-role-id');
        const role = btn.getAttribute('data-role');
        const data = await this.callApi(`/api/admin/owner/users/${id}/role`, 'POST', { role });
        if (data) {
          this.onToast?.(`${data.user.username} is now ${role}.`, 'success');
          this.refresh();
        }
      });
    });

    this.root.querySelectorAll('[data-reset-pw]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-reset-pw');
        const username = btn.getAttribute('data-username');
        const newPassword = window.prompt(`New password for ${username} (min 4 chars):`);
        if (!newPassword) return;
        const data = await this.callApi(`/api/admin/owner/users/${id}/reset-password`, 'POST', { newPassword });
        if (data) this.onToast?.(`Password reset for ${username}.`, 'success');
      });
    });

    this.root.querySelectorAll('[data-del-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-del-user');
        const username = btn.getAttribute('data-username');
        if (!window.confirm(`Permanently delete account "${username}"?`)) return;
        const data = await this.callApi(`/api/admin/owner/users/${id}`, 'DELETE');
        if (data) {
          this.onToast?.(`Deleted ${username}.`, 'info');
          this.refresh();
        }
      });
    });
  }

  renderAdminSection(isOwner) {
    return `
      <!-- Live Dismissible Announcement & Chat Controls -->
      <div class="glass-panel rounded-2xl p-5 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-bold text-white">📢 Live Broadcast & Chat Controls</h3>
          <div class="flex items-center gap-2">
            <label class="text-xs text-slate-400">Slow Mode:</label>
            <select id="sp-slowmode" class="bg-[#090b10] border border-white/10 rounded-lg px-2 py-1 text-xs text-white">
              ${[0, 3, 5, 10, 30]
                .map(
                  (s) =>
                    `<option value="${s}" ${this.portalSettings.slowModeSeconds === s ? 'selected' : ''}>${
                      s === 0 ? 'Off' : `${s}s`
                    }</option>`
                )
                .join('')}
            </select>
            <button id="sp-clear-chat" class="px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold">
              Clear Chat
            </button>
          </div>
        </div>
        <form id="sp-announce-form" class="flex gap-2">
          <input id="sp-announce-input" type="text" value="${escapeHtml(this.portalSettings.announcement || '')}" placeholder="Send a live dismissible announcement to everyone online..." class="flex-1 bg-[#090b10] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white select-text" />
          <button type="submit" class="px-4 py-2 rounded-xl accent-bg text-slate-950 font-bold text-xs">Broadcast</button>
          <button id="sp-announce-clear" type="button" class="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-semibold text-xs">Clear</button>
        </form>
      </div>

      <!-- Blocked Proxy Sites -->
      <div class="glass-panel rounded-2xl p-5 space-y-3">
        <h3 class="text-sm font-bold text-white">🚫 Restricted Proxy Domains</h3>
        <form id="sp-block-site-form" class="flex gap-2">
          <input id="sp-block-site-input" type="text" placeholder="Block a domain from being proxied (e.g. badsite.com)" class="flex-1 bg-[#090b10] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white select-text" />
          <button type="submit" class="px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-200 font-bold text-xs">Block Domain</button>
        </form>
        <div class="flex flex-wrap gap-1.5">
          ${
            this.blockedSites.length
              ? this.blockedSites
                  .map(
                    (d) =>
                      `<span class="px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300 flex items-center gap-1.5">${escapeHtml(d)} <button data-unblock-site="${escapeHtml(d)}" class="hover:text-white">&times;</button></span>`
                  )
                  .join('')
              : '<span class="text-xs text-slate-500">No domains restricted.</span>'
          }
        </div>
      </div>

      <!-- User Moderation Table -->
      <div class="glass-panel rounded-2xl overflow-hidden">
        <div class="px-5 py-3.5 border-b border-white/10 text-sm font-bold text-white">👥 User Moderation</div>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-white/[0.03] text-slate-400 uppercase text-[10px]">
              <tr>
                <th class="py-2.5 px-4">Username</th>
                <th class="py-2.5 px-4">Role</th>
                <th class="py-2.5 px-4">Status</th>
                <th class="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5">
              ${this.users
                .map((u) => {
                  const canMod = u.role !== 'owner' && (isOwner || u.role !== 'admin');
                  return `
                    <tr class="hover:bg-white/[0.02]">
                      <td class="py-3 px-4 font-semibold text-slate-100">${escapeHtml(u.username)}</td>
                      <td class="py-3 px-4">${roleBadge(u.role)}</td>
                      <td class="py-3 px-4">
                        ${u.banned ? '<span class="text-rose-400 font-semibold">Banned</span>' : u.muted ? '<span class="text-amber-400 font-semibold">Muted</span>' : '<span class="text-emerald-400">Active</span>'}
                      </td>
                      <td class="py-3 px-4 text-right space-x-1">
                        ${
                          canMod
                            ? `
                              <button data-kick-vc="${u.id}" class="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300" title="Kick from Voice">🎙️ Kick</button>
                              <button data-mute-id="${u.id}" data-next="${!u.muted}" class="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200">${u.muted ? 'Unmute' : 'Mute'}</button>
                              <button data-ban-id="${u.id}" data-next="${!u.banned}" class="px-2 py-1 rounded-lg border ${
                                u.banned ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                              }">${u.banned ? 'Unban' : 'Ban'}</button>`
                            : '<span class="text-slate-600">—</span>'
                        }
                      </td>
                    </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Staff Audit Log -->
      <div class="glass-panel rounded-2xl overflow-hidden">
        <div class="px-5 py-3 border-b border-white/10 text-sm font-bold text-white">📜 Recent Audit Log</div>
        <div class="max-h-52 overflow-y-auto divide-y divide-white/5 text-xs">
          ${
            this.auditLogs.length
              ? this.auditLogs
                  .slice(0, 25)
                  .map(
                    (l) => `
                    <div class="px-4 py-2 flex items-center justify-between gap-2">
                      <div>
                        <strong class="text-slate-200">${escapeHtml(l.actor)}</strong>
                        <span class="px-1.5 py-0.5 mx-1 rounded bg-white/5 font-mono text-[10px] accent-text">${escapeHtml(l.action)}</span>
                        <span class="text-slate-400">${escapeHtml(l.details)}</span>
                      </div>
                      <span class="text-[10px] text-slate-500 shrink-0">${new Date(l.timestamp).toLocaleTimeString()}</span>
                    </div>`
                  )
                  .join('')
              : '<div class="p-4 text-center text-slate-500">No audit entries yet.</div>'
          }
        </div>
      </div>
    `;
  }

  renderOwnerSection(admins, regulars) {
    const customGames = this.games.filter((g) => g.custom);
    return `
      <!-- Sticky Startup Announcement (Shows Every Time Portal Opens) -->
      <form id="owner-startup-form" class="glass-panel rounded-2xl p-5 space-y-3 border-amber-500/25">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-bold text-amber-300">📌 Startup Popup Announcement (Shows Every Time Site Opens)</div>
            <div class="text-xs text-slate-400">Appears as a dismissible screen popup every time a user opens Bean Proxy.</div>
          </div>
          <label class="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
            <input id="owner-startup-toggle" type="checkbox" ${this.portalSettings.startupAnnouncementEnabled ? 'checked' : ''} class="w-4 h-4 accent-amber-400" />
            <span>Enabled</span>
          </label>
        </div>
        <div class="flex gap-2">
          <input id="owner-startup-text" type="text" value="${escapeHtml(this.portalSettings.startupAnnouncement || '')}" placeholder="e.g. Welcome to Bean Proxy! New games added every Friday." class="flex-1 bg-[#090b10] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white select-text" />
          <button id="owner-startup-preview" type="button" class="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-amber-200 font-semibold text-xs">Preview</button>
          <button type="submit" class="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs">Save Startup Popup</button>
        </div>
      </form>

      <!-- Owner: Add Game to Catalog (URL or HTML File Upload) -->
      <div class="glass-panel rounded-2xl p-5 space-y-4 border-amber-500/25">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div class="text-sm font-bold text-amber-300">🕹️ Add Game to Catalog (URL or HTML File)</div>
            <div class="text-xs text-slate-400">Added games appear immediately in the Bean Game Hub.</div>
          </div>
          <div class="flex bg-white/5 p-0.5 rounded-lg border border-white/10">
            <button id="game-mode-url" type="button" class="px-3 py-1 rounded-md text-xs font-bold ${
              this.gameAddMode === 'url' ? 'bg-amber-400 text-slate-950' : 'text-slate-300'
            }">By URL</button>
            <button id="game-mode-html" type="button" class="px-3 py-1 rounded-md text-xs font-bold ${
              this.gameAddMode === 'html' ? 'bg-amber-400 text-slate-950' : 'text-slate-300'
            }">Upload HTML File</button>
          </div>
        </div>

        <form id="owner-add-game-form" class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <input id="og-title" type="text" required placeholder="Game Title (e.g. Slope, Doom)" class="bg-[#090b10] border border-white/10 rounded-xl px-3 py-2 text-white select-text" />
          <div class="flex gap-2">
            <select id="og-cat" class="flex-1 bg-[#090b10] border border-white/10 rounded-xl px-3 py-2 text-white">
              <option value="Action">Action</option>
              <option value="Arcade">Arcade</option>
              <option value="Puzzle">Puzzle</option>
              <option value="Retro">Retro</option>
            </select>
            <input id="og-icon" type="text" maxlength="4" placeholder="🕹️" value="🕹️" class="w-16 text-center bg-[#090b10] border border-white/10 rounded-xl px-2 py-2 text-white select-text" />
          </div>

          ${
            this.gameAddMode === 'html'
              ? `<div class="sm:col-span-2">
                  <input id="og-file" type="file" accept=".html,.htm" required class="w-full bg-[#090b10] border border-white/10 rounded-xl px-3 py-2 text-slate-300 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-amber-400 file:text-slate-950 file:font-bold" />
                </div>`
              : `<input id="og-url" type="url" required placeholder="https://example.com/game-embed" class="sm:col-span-2 bg-[#090b10] border border-white/10 rounded-xl px-3 py-2 text-white select-text" />`
          }

          <input id="og-desc" type="text" placeholder="Short description..." class="bg-[#090b10] border border-white/10 rounded-xl px-3 py-2 text-white select-text" />
          <input id="og-controls" type="text" placeholder="Controls hint (e.g. WASD + Mouse)" class="bg-[#090b10] border border-white/10 rounded-xl px-3 py-2 text-white select-text" />

          <div class="sm:col-span-2 flex justify-end">
            <button type="submit" class="px-5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs">
              + Publish to Game Hub
            </button>
          </div>
        </form>

        ${
          customGames.length
            ? `<div class="pt-3 border-t border-white/10 space-y-1.5">
                <div class="text-[11px] font-semibold text-slate-400">Custom Games (${customGames.length})</div>
                ${customGames
                  .map(
                    (g) => `
                    <div class="flex items-center justify-between px-3 py-1.5 rounded-lg bg-white/[0.03] text-xs">
                      <span>${g.icon} <strong>${escapeHtml(g.title)}</strong> <span class="text-slate-500">(${g.isExternalUrl ? 'URL' : 'HTML'})</span></span>
                      <button data-del-game="${escapeHtml(g.id)}" class="text-rose-400 hover:text-rose-300 text-xs font-semibold">Remove</button>
                    </div>`
                  )
                  .join('')}
              </div>`
            : ''
        }
      </div>

      <!-- Maintenance Mode & Registrations -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="glass-panel rounded-2xl p-5 flex items-center justify-between gap-4 border-amber-500/20">
          <div>
            <div class="text-sm font-bold text-amber-300">🔓 Allow New Registrations</div>
            <div class="text-xs text-slate-400">Pause signups anytime while keeping existing users.</div>
          </div>
          <input id="owner-reg-toggle" type="checkbox" ${this.portalSettings.registrationsOpen ? 'checked' : ''} class="w-5 h-5 accent-amber-400 cursor-pointer" />
        </div>

        <form id="owner-maint-form" class="glass-panel rounded-2xl p-5 space-y-2.5 border-amber-500/20">
          <div class="flex items-center justify-between">
            <span class="text-sm font-bold text-rose-300">🛠️ Proxy Maintenance Mode</span>
            <input id="owner-maint-toggle" type="checkbox" ${this.portalSettings.maintenanceMode ? 'checked' : ''} class="w-5 h-5 accent-rose-400 cursor-pointer" />
          </div>
          <div class="flex gap-2">
            <input id="owner-maint-msg" type="text" value="${escapeHtml(this.portalSettings.maintenanceMessage || '')}" class="flex-1 bg-[#090b10] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white select-text" />
            <button type="submit" class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-bold text-white">Save</button>
          </div>
        </form>
      </div>

      <!-- Appoint & Manage Admins -->
      <div class="glass-panel rounded-2xl overflow-hidden border-amber-500/20">
        <div class="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
          <div class="text-sm font-bold text-amber-300">👑 Appoint Admins & Manage Accounts</div>
          <div class="text-[11px] text-slate-400">${admins.length} Admin(s) · ${regulars.length} Member(s)</div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-white/[0.03] text-slate-400 uppercase text-[10px]">
              <tr>
                <th class="py-2.5 px-4">Username</th>
                <th class="py-2.5 px-4">Role</th>
                <th class="py-2.5 px-4">Created</th>
                <th class="py-2.5 px-4 text-right">Owner Controls</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5">
              ${this.users
                .map((u) => {
                  const isSelfOwner = u.role === 'owner';
                  return `
                    <tr class="hover:bg-white/[0.02]">
                      <td class="py-3 px-4 font-semibold text-slate-100">${escapeHtml(u.username)}</td>
                      <td class="py-3 px-4">${roleBadge(u.role)}</td>
                      <td class="py-3 px-4 text-slate-400">${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
                      <td class="py-3 px-4 text-right space-x-1.5">
                        ${
                          isSelfOwner
                            ? '<span class="text-amber-400/80 text-[11px] font-semibold">Protected Owner</span>'
                            : `
                              ${
                                u.role === 'admin'
                                  ? `<button data-role-id="${u.id}" data-role="user" class="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-semibold">Demote Admin</button>`
                                  : `<button data-role-id="${u.id}" data-role="admin" class="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 font-semibold">Appoint Admin</button>`
                              }
                              <button data-reset-pw="${u.id}" data-username="${escapeHtml(u.username)}" class="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200">Reset PW</button>
                              <button data-del-user="${u.id}" data-username="${escapeHtml(u.username)}" class="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300">Delete</button>
                            `
                        }
                      </td>
                    </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
}

function roleBadge(role) {
  if (role === 'owner') {
    return '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">👑 OWNER</span>';
  }
  if (role === 'admin') {
    return '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">🛡️ ADMIN</span>';
  }
  return '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/5 text-slate-300 border border-white/10">USER</span>';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
