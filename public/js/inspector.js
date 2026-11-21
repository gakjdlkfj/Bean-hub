export class BrowserDevTools {
  constructor(options) {
    this.el = options.elements;
    this.getBrowser = options.getBrowser;
    this.getSettings = options.getSettings;
    this.onUpdateSettings = options.onUpdateSettings;
    this.onToast = options.onToast;

    this.isOpen = false;
    this.activeTab = 'network'; // network | console | elements | storage | transport
    this.pollTimer = null;
    this.consoleLogs = [
      { level: 'info', text: 'Bean DevTools ready. Run JS against the active proxied tab or portal.' }
    ];

    this.el.toggleBtn?.addEventListener('click', () => this.toggle());
    this.el.closeBtn?.addEventListener('click', () => this.close());
    this.el.clearBtn?.addEventListener('click', () => this.handleClear());
    this.el.refreshBtn?.addEventListener('click', () => this.refreshActiveTab());

    this.el.drawer?.querySelectorAll('[data-dt-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.getAttribute('data-dt-tab');
        this.renderTabBar();
        this.refreshActiveTab();
      });
    });

    // Console form
    this.el.consoleForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.el.consoleInput;
      const code = input?.value.trim();
      if (!code) return;
      input.value = '';
      this.evalInActiveTab(code);
    });
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(tab = null) {
    if (tab) this.activeTab = tab;
    this.isOpen = true;
    this.el.drawer.classList.remove('hidden');
    this.el.toggleBtn?.classList.add('accent-text');
    this.renderTabBar();
    this.refreshActiveTab();
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        if (this.isOpen && this.activeTab === 'network') this.refreshNetwork();
      }, 2500);
    }
  }

  close() {
    this.isOpen = false;
    this.el.drawer.classList.add('hidden');
    this.el.toggleBtn?.classList.remove('accent-text');
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  renderTabBar() {
    this.el.drawer?.querySelectorAll('[data-dt-tab]').forEach((btn) => {
      const active = btn.getAttribute('data-dt-tab') === this.activeTab;
      btn.classList.toggle('accent-bg', active);
      btn.classList.toggle('text-slate-950', active);
      btn.classList.toggle('text-slate-400', !active);
    });

    ['network', 'console', 'elements', 'storage', 'transport'].forEach((name) => {
      const pane = document.getElementById(`dt-pane-${name}`);
      if (pane) pane.classList.toggle('hidden', name !== this.activeTab);
    });
  }

  refreshActiveTab() {
    if (this.activeTab === 'network') this.refreshNetwork();
    else if (this.activeTab === 'console') this.renderConsole();
    else if (this.activeTab === 'elements') this.renderElements();
    else if (this.activeTab === 'storage') this.renderStorage();
    else if (this.activeTab === 'transport') this.renderTransport();
  }

  async handleClear() {
    if (this.activeTab === 'network') {
      await fetch('/api/network/clear', { method: 'POST' });
      this.renderNetworkLogs([]);
      this.onToast?.('Network logs cleared.', 'info');
    } else if (this.activeTab === 'console') {
      this.consoleLogs = [];
      this.renderConsole();
    } else if (this.activeTab === 'storage') {
      this.onToast?.('Use individual delete buttons or Wipe Session in Settings.', 'info');
    }
  }

  // --- 1. NETWORK ---
  async refreshNetwork() {
    try {
      const res = await fetch('/api/network/logs?limit=60');
      if (!res.ok) return;
      const data = await res.json();
      this.renderNetworkLogs(data.logs || []);
    } catch {
      // ignore
    }
  }

  renderNetworkLogs(logs) {
    if (!this.el.tbody) return;
    if (!logs.length) {
      this.el.tbody.innerHTML =
        '<tr><td colspan="5" class="py-6 text-center text-slate-500 text-xs">No proxied requests logged yet.</td></tr>';
      return;
    }
    this.el.tbody.innerHTML = logs
      .map((entry) => {
        const statusColor = entry.blocked
          ? 'text-rose-400 bg-rose-500/15 border-rose-500/30'
          : entry.status >= 400
          ? 'text-amber-400 bg-amber-500/15 border-amber-500/30'
          : 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30';
        const statusLabel = entry.blocked ? 'BLOCKED' : String(entry.status || '—');
        const shortUrl = entry.url.length > 84 ? entry.url.slice(0, 84) + '…' : entry.url;
        return `
          <tr class="border-b border-white/5 hover:bg-white/[0.03] text-xs">
            <td class="py-1.5 px-3 font-mono text-slate-400">${escapeHtml(entry.method || 'GET')}</td>
            <td class="py-1.5 px-3"><span class="px-1.5 py-0.5 rounded border text-[10px] font-semibold ${statusColor}">${statusLabel}</span></td>
            <td class="py-1.5 px-3 font-mono text-slate-200 truncate max-w-md" title="${escapeHtml(entry.url)}">${escapeHtml(shortUrl)}</td>
            <td class="py-1.5 px-3 text-slate-400">${escapeHtml(entry.contentType || (entry.blocked ? 'tracker' : '—'))}</td>
            <td class="py-1.5 px-3 text-right font-mono text-slate-400">${entry.durationMs ?? 0}ms</td>
          </tr>`;
      })
      .join('');
  }

  // --- 2. CONSOLE ---
  evalInActiveTab(code) {
    this.consoleLogs.push({ level: 'cmd', text: `> ${code}` });
    const tab = this.getBrowser?.()?.getActiveTab?.();
    const targetWin = tab?.iframe?.contentWindow && tab.url ? tab.iframe.contentWindow : window;

    try {
      const result = targetWin.eval(code);
      const formatted =
        typeof result === 'object' && result !== null
          ? JSON.stringify(result, null, 2)
          : String(result);
      this.consoleLogs.push({ level: 'res', text: formatted });
    } catch (err) {
      this.consoleLogs.push({ level: 'err', text: String(err) });
    }

    if (this.consoleLogs.length > 100) this.consoleLogs = this.consoleLogs.slice(-100);
    this.renderConsole();
  }

  renderConsole() {
    const out = document.getElementById('dt-console-output');
    if (!out) return;
    out.innerHTML = this.consoleLogs
      .map((l) => {
        const cls =
          l.level === 'err'
            ? 'text-rose-400'
            : l.level === 'cmd'
            ? 'text-cyan-300'
            : l.level === 'res'
            ? 'text-emerald-300'
            : 'text-slate-400';
        return `<div class="font-mono text-xs whitespace-pre-wrap break-all py-0.5 border-b border-white/[0.03] ${cls}">${escapeHtml(l.text)}</div>`;
      })
      .join('');
    out.scrollTop = out.scrollHeight;
  }

  // --- 3. ELEMENTS / DOM INSPECTOR ---
  renderElements() {
    const box = document.getElementById('dt-elements-output');
    if (!box) return;
    const tab = this.getBrowser?.()?.getActiveTab?.();
    if (!tab || !tab.url || !tab.iframe) {
      box.innerHTML = '<div class="p-4 text-xs text-slate-500">Open a website in the active tab to inspect its live DOM and source HTML.</div>';
      return;
    }

    try {
      const doc = tab.iframe.contentDocument;
      if (!doc) throw new Error('Document unavailable');
      const links = doc.querySelectorAll('a').length;
      const scripts = doc.querySelectorAll('script').length;
      const images = doc.querySelectorAll('img').length;
      const htmlSnippet = (doc.documentElement?.outerHTML || '').slice(0, 6000);

      box.innerHTML = `
        <div class="p-3 space-y-2 text-xs">
          <div class="flex flex-wrap items-center gap-3 text-slate-300">
            <span>Title: <strong class="text-white">${escapeHtml(doc.title || 'Untitled')}</strong></span>
            <span>Links: <strong class="accent-text">${links}</strong></span>
            <span>Scripts: <strong class="accent-text">${scripts}</strong></span>
            <span>Images: <strong class="accent-text">${images}</strong></span>
            <button id="dt-copy-dom" class="ml-auto px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 text-[11px] text-white">Copy HTML</button>
          </div>
          <pre class="bg-[#090b10] border border-white/10 rounded-lg p-3 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-36 select-text">${escapeHtml(htmlSnippet)}</pre>
        </div>
      `;
      document.getElementById('dt-copy-dom')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(doc.documentElement?.outerHTML || '');
        this.onToast?.('Copied active DOM HTML.', 'success');
      });
    } catch {
      box.innerHTML = '<div class="p-4 text-xs text-amber-400">Waiting for proxied document to finish loading…</div>';
    }
  }

  // --- 4. STORAGE ---
  renderStorage() {
    const box = document.getElementById('dt-storage-output');
    if (!box) return;
    const keys = Object.keys(localStorage).sort();
    box.innerHTML = `
      <div class="p-3 space-y-1.5 text-xs">
        <div class="text-slate-400 mb-2">LocalStorage Keys (${keys.length})</div>
        ${keys
          .map((k) => {
            const val = String(localStorage.getItem(k) || '');
            const preview = val.length > 90 ? val.slice(0, 90) + '…' : val;
            return `
              <div class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-white/[0.03] border border-white/5">
                <div class="min-w-0 font-mono">
                  <span class="accent-text">${escapeHtml(k)}</span>
                  <span class="text-slate-500 ml-2">${escapeHtml(preview)}</span>
                </div>
                <button data-del-ls="${escapeHtml(k)}" class="text-rose-400 hover:text-rose-300 shrink-0 text-[11px]">Delete</button>
              </div>`;
          })
          .join('')}
      </div>
    `;
    box.querySelectorAll('[data-del-ls]').forEach((btn) => {
      btn.addEventListener('click', () => {
        localStorage.removeItem(btn.getAttribute('data-del-ls'));
        this.renderStorage();
        this.onToast?.('Removed storage key.', 'info');
      });
    });
  }

  // --- 5. WISP & TRANSPORT SWITCHER ---
  renderTransport() {
    const box = document.getElementById('dt-transport-output');
    if (!box) return;
    const s = this.getSettings();
    const transport = s.transport || 'native';
    const wispUrl = s.wispUrl || 'wss://wisp.mercurywork.shop/';

    box.innerHTML = `
      <div class="p-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs items-end">
        <div>
          <label class="block text-slate-400 mb-1">Proxy Transport</label>
          <select id="dt-transport-sel" class="w-full bg-[#090b10] border border-white/10 rounded-lg px-2.5 py-1.5 text-white">
            <option value="native" ${transport === 'native' ? 'selected' : ''}>Bean Native (HTTP/WS Rewriter)</option>
            <option value="epoxy" ${transport === 'epoxy' ? 'selected' : ''}>Epoxy (Wisp Encrypted)</option>
            <option value="libcurl" ${transport === 'libcurl' ? 'selected' : ''}>Libcurl (Wisp Multiplex)</option>
            <option value="baremux" ${transport === 'baremux' ? 'selected' : ''}>Bare-Mux Relay</option>
          </select>
        </div>
        <div>
          <label class="block text-slate-400 mb-1">Wisp Server URL</label>
          <input id="dt-wisp-url" type="text" value="${escapeHtml(wispUrl)}" placeholder="wss://wisp.mercurywork.shop/" class="w-full bg-[#090b10] border border-white/10 rounded-lg px-2.5 py-1.5 text-white font-mono select-text" />
        </div>
        <div class="flex gap-2">
          <button id="dt-save-wisp" class="px-3 py-1.5 rounded-lg accent-bg text-slate-950 font-bold">Apply</button>
          <button id="dt-ping-wisp" class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white font-semibold">Ping Wisp</button>
        </div>
        <div id="dt-wisp-status" class="sm:col-span-3 text-[11px] text-slate-400">
          Active Transport: <strong class="accent-text">${escapeHtml(transport.toUpperCase())}</strong> · Wisp Endpoint: <code class="text-slate-300">${escapeHtml(wispUrl)}</code>
        </div>
      </div>
    `;

    document.getElementById('dt-save-wisp')?.addEventListener('click', () => {
      const nextTransport = document.getElementById('dt-transport-sel')?.value || 'native';
      const nextWisp = document.getElementById('dt-wisp-url')?.value.trim() || 'wss://wisp.mercurywork.shop/';
      this.onUpdateSettings?.({ transport: nextTransport, wispUrl: nextWisp });
      this.onToast?.(`Transport switched to ${nextTransport.toUpperCase()}`, 'success');
      this.renderTransport();
    });

    document.getElementById('dt-ping-wisp')?.addEventListener('click', () => {
      const url = document.getElementById('dt-wisp-url')?.value.trim();
      const statusEl = document.getElementById('dt-wisp-status');
      if (!url || !/^wss?:\/\//i.test(url)) {
        if (statusEl) statusEl.textContent = 'Enter a valid ws:// or wss:// Wisp URL to test.';
        return;
      }
      const t0 = performance.now();
      if (statusEl) statusEl.textContent = `Connecting to ${url}…`;
      try {
        const testWs = new WebSocket(url);
        const timeout = setTimeout(() => {
          testWs.close();
          if (statusEl) statusEl.innerHTML = `<span class="text-amber-400">Timed out reaching ${escapeHtml(url)}</span>`;
        }, 4500);
        testWs.onopen = () => {
          clearTimeout(timeout);
          const ms = Math.round(performance.now() - t0);
          testWs.close();
          if (statusEl) statusEl.innerHTML = `<span class="text-emerald-400">Connected to ${escapeHtml(url)} in ${ms}ms ✓</span>`;
        };
        testWs.onerror = () => {
          clearTimeout(timeout);
          if (statusEl) statusEl.innerHTML = `<span class="text-rose-400">Could not connect to ${escapeHtml(url)} (server unreachable or blocked).</span>`;
        };
      } catch (err) {
        if (statusEl) statusEl.innerHTML = `<span class="text-rose-400">${escapeHtml(err.message)}</span>`;
      }
    });
  }
}

export async function fetchServerHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
