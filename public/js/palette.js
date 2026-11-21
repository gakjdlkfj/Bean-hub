export class CommandPalette {
  constructor(elements, getCommands) {
    this.el = elements;
    this.getCommands = getCommands;
    this.isOpen = false;
    this.filtered = [];
    this.selectedIdx = 0;

    this.bindEvents();
  }

  bindEvents() {
    this.el.backdrop.addEventListener('click', (e) => {
      if (e.target === this.el.backdrop) this.close();
    });

    this.el.input.addEventListener('input', () => {
      this.selectedIdx = 0;
      this.render();
    });

    this.el.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.filtered.length) {
          this.selectedIdx = (this.selectedIdx + 1) % this.filtered.length;
          this.render();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.filtered.length) {
          this.selectedIdx = (this.selectedIdx - 1 + this.filtered.length) % this.filtered.length;
          this.render();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const chosen = this.filtered[this.selectedIdx];
        if (chosen) {
          this.close();
          chosen.run();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  open() {
    this.isOpen = true;
    this.el.backdrop.classList.remove('hidden');
    this.el.input.value = '';
    this.selectedIdx = 0;
    this.render();
    setTimeout(() => this.el.input.focus(), 10);
  }

  close() {
    this.isOpen = false;
    this.el.backdrop.classList.add('hidden');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  render() {
    const query = this.el.input.value.trim().toLowerCase();
    const commands = this.getCommands(query);
    this.filtered = commands.filter(
      (cmd) =>
        !query ||
        cmd.title.toLowerCase().includes(query) ||
        (cmd.subtitle && cmd.subtitle.toLowerCase().includes(query))
    );

    if (this.selectedIdx >= this.filtered.length) {
      this.selectedIdx = 0;
    }

    this.el.list.innerHTML = '';
    if (!this.filtered.length) {
      this.el.list.innerHTML =
        '<div class="py-6 text-center text-xs text-slate-500">No matching commands.</div>';
      return;
    }

    this.filtered.forEach((cmd, idx) => {
      const row = document.createElement('button');
      const active = idx === this.selectedIdx;
      row.className = `w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-left transition ${
        active ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5'
      }`;
      row.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
          <span class="text-base shrink-0">${cmd.icon || '⚡'}</span>
          <div class="min-w-0">
            <div class="text-sm font-medium truncate">${escapeHtml(cmd.title)}</div>
            ${
              cmd.subtitle
                ? `<div class="text-[11px] text-slate-400 truncate">${escapeHtml(cmd.subtitle)}</div>`
                : ''
            }
          </div>
        </div>
        ${
          cmd.shortcut
            ? `<kbd class="px-1.5 py-0.5 text-[10px] font-mono rounded bg-white/10 text-slate-300 shrink-0">${escapeHtml(
                cmd.shortcut
              )}</kbd>`
            : ''
        }
      `;
      row.addEventListener('click', () => {
        this.close();
        cmd.run();
      });
      this.el.list.appendChild(row);
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
