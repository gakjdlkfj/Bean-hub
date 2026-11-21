import { encodeProxyUrlClient } from './storage.js';

export class GameHub {
  constructor(rootEl, onToast) {
    this.root = rootEl;
    this.onToast = onToast;
    this.games = [];
    this.categories = ['All', 'Action', 'Puzzle', 'Arcade', 'Retro'];
    this.activeCategory = 'All';
    this.searchQuery = '';
    this.activeGame = null;
    this.loaded = false;
  }

  async ensureLoaded(force = false) {
    if (this.loaded && !force) {
      this.render();
      return;
    }
    try {
      const res = await fetch('/api/games?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        this.games = Array.isArray(data.games) ? data.games : [];
        if (Array.isArray(data.categories) && data.categories.length) {
          this.categories = data.categories;
        }
      }
      this.loaded = true;
    } catch {
      this.onToast?.('Could not load games catalog.', 'error');
    }
    this.render();
  }

  readGameScore(game) {
    if (!game.storageKey) return null;
    try {
      const raw = localStorage.getItem(game.storageKey);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (typeof data.best === 'number') return `Best: ${data.best}`;
      if (data.easy || data.med || data.hard) {
        const bestTime = data.med || data.easy || data.hard;
        return `Best Time: ${bestTime}s`;
      }
      return 'Saved State';
    } catch {
      return null;
    }
  }

  launchGame(game, useProxy = false) {
    this.activeGame = { ...game, useProxy };
    this.render();
  }

  closeGame() {
    this.activeGame = null;
    this.render();
  }

  render() {
    if (!this.root) return;

    if (this.activeGame) {
      const g = this.activeGame;
      const iframeSrc =
        g.isExternalUrl && g.useProxy
          ? `/proxy/${encodeProxyUrlClient(g.path)}`
          : g.path;

      this.root.innerHTML = `
        <div class="w-full h-full flex flex-col">
          <div class="flex items-center justify-between px-4 py-2.5 bg-[#11151f] border-b border-white/10 shrink-0">
            <div class="flex items-center gap-3">
              <button id="gh-back" class="nav-btn px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-semibold text-slate-200">
                ← Back to Hub
              </button>
              <span class="text-lg">${g.icon || '🎮'}</span>
              <div>
                <div class="text-sm font-bold text-white leading-tight">${escapeHtml(g.title)}</div>
                <div class="text-[11px] text-slate-400">${escapeHtml(g.controls || '')}</div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              ${
                g.isExternalUrl
                  ? `<button id="gh-toggle-proxy" class="nav-btn px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs ${
                      g.useProxy ? 'accent-text' : 'text-slate-300'
                    }">${g.useProxy ? '🛡️ Proxied' : 'Direct'}</button>`
                  : ''
              }
              <button id="gh-reload" class="nav-btn px-2.5 py-1.5 rounded-lg bg-white/5 text-xs text-slate-300">↻ Restart</button>
              <button id="gh-fs" class="nav-btn px-2.5 py-1.5 rounded-lg bg-white/5 text-xs text-slate-300">⛶ Fullscreen</button>
            </div>
          </div>
          <div id="gh-stage" class="flex-1 bg-[#090b10] relative">
            <iframe id="gh-frame" src="${escapeHtml(iframeSrc)}" class="w-full h-full border-0" allowfullscreen></iframe>
          </div>
        </div>
      `;

      document.getElementById('gh-back').addEventListener('click', () => this.closeGame());
      document.getElementById('gh-toggle-proxy')?.addEventListener('click', () => {
        this.launchGame(g, !g.useProxy);
      });
      document.getElementById('gh-reload').addEventListener('click', () => {
        const f = document.getElementById('gh-frame');
        if (f) f.src = f.src;
      });
      document.getElementById('gh-fs').addEventListener('click', () => {
        const stage = document.getElementById('gh-stage');
        if (!document.fullscreenElement) stage?.requestFullscreen?.().catch(() => {});
        else document.exitFullscreen?.().catch(() => {});
      });
      return;
    }

    const q = this.searchQuery.toLowerCase();
    const filtered = this.games.filter((g) => {
      const catMatch =
        this.activeCategory === 'All' ||
        g.category === this.activeCategory ||
        (Array.isArray(g.tags) && g.tags.includes(this.activeCategory));
      const searchMatch =
        !q ||
        g.title.toLowerCase().includes(q) ||
        (g.description || '').toLowerCase().includes(q) ||
        (g.category || '').toLowerCase().includes(q);
      return catMatch && searchMatch;
    });

    this.root.innerHTML = `
      <div class="w-full h-full overflow-y-auto px-6 py-6">
        <div class="max-w-5xl mx-auto">
          <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
            <div>
              <div class="text-xs font-bold uppercase tracking-wider accent-text mb-1">Bean Proxy Arcade</div>
              <h2 class="text-2xl font-extrabold text-white">Bean Game Hub</h2>
              <p class="text-xs text-slate-400 mt-1">Offline classics + custom URL & HTML games published from the Owner Panel.</p>
            </div>
            <div class="flex items-center bg-[#11151f] border border-white/10 rounded-xl px-3 py-2 w-full sm:w-64">
              <span class="text-slate-500 text-xs mr-2">🔍</span>
              <input id="gh-search" type="text" value="${escapeHtml(this.searchQuery)}" placeholder="Search games..." class="flex-1 bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none select-text" />
            </div>
          </div>

          <div class="flex items-center gap-2 flex-wrap mb-6">
            ${this.categories
              .map(
                (cat) => `
                <button data-cat="${escapeHtml(cat)}" class="px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                  this.activeCategory === cat
                    ? 'accent-bg text-slate-950 border-transparent'
                    : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                }">${escapeHtml(cat)}</button>`
              )
              .join('')}
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            ${
              filtered.length
                ? filtered
                    .map((g) => {
                      const savedBadge = this.readGameScore(g);
                      return `
                        <div data-play="${escapeHtml(g.id)}" class="speed-dial-card rounded-2xl p-5 cursor-pointer flex flex-col justify-between gap-4">
                          <div>
                            <div class="flex items-start justify-between gap-3 mb-3">
                              <div class="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style="background:${g.accent || '#10b981'}22;border:1px solid ${g.accent || '#10b981'}44;">
                                ${g.icon || '🎮'}
                              </div>
                              <div class="flex flex-col items-end gap-1">
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/5 border border-white/10 text-slate-300">${escapeHtml(g.category || 'Arcade')}</span>
                                ${savedBadge ? `<span class="text-[10px] font-mono accent-text">${escapeHtml(savedBadge)}</span>` : ''}
                                ${g.custom ? '<span class="text-[9px] font-bold text-amber-400">CUSTOM</span>' : ''}
                              </div>
                            </div>
                            <h3 class="text-base font-bold text-white mb-1">${escapeHtml(g.title)}</h3>
                            <p class="text-xs text-slate-400 leading-relaxed">${escapeHtml(g.description || '')}</p>
                          </div>
                          <div class="flex items-center justify-between pt-3 border-t border-white/5">
                            <span class="text-[11px] text-slate-500 truncate max-w-[170px]">${escapeHtml(g.controls || 'Keyboard / Mouse')}</span>
                            <span class="px-3 py-1 rounded-lg accent-bg text-slate-950 text-xs font-bold">Play</span>
                          </div>
                        </div>`;
                    })
                    .join('')
                : `<div class="col-span-full py-12 text-center text-sm text-slate-500">No games match your filter.</div>`
            }
          </div>
        </div>
      </div>
    `;

    const searchInput = document.getElementById('gh-search');
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.render();
      const restored = document.getElementById('gh-search');
      if (restored) {
        restored.focus();
        restored.setSelectionRange(restored.value.length, restored.value.length);
      }
    });

    this.root.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeCategory = btn.getAttribute('data-cat');
        this.render();
      });
    });

    this.root.querySelectorAll('[data-play]').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-play');
        const game = this.games.find((x) => x.id === id);
        if (game) this.launchGame(game, Boolean(game.isExternalUrl));
      });
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
