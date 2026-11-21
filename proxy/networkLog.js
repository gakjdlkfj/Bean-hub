class NetworkLog {
  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  record(entry) {
    this.entries.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      ...entry
    });
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
  }

  getAll(limit = 50) {
    return this.entries.slice(0, limit);
  }

  clear() {
    this.entries = [];
  }
}

module.exports = new NetworkLog();
