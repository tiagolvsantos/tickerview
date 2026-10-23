/** Bounded persistent resource cache with in-flight coalescing and stale-on-error. */
export class ResourceCache {
  constructor(storage, { now = Date.now, limit = 80, maxBytes = 2000000 } = {}) {
    this.storage = storage;
    this.now = now;
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.entries = new Map();
    this.pending = new Map();
    this.failures = new Map();
    this.ready = this.restore();
    this.writing = Promise.resolve();
  }
  async restore() {
    try {
      const { resourceCache = [] } = await this.storage.get('resourceCache');
      for (const [key, item] of resourceCache) {
        if (typeof key === 'string' && item && Number.isFinite(item.time) && this.now() - item.time < 7 * 86400000) this.entries.set(key, item);
      }
      this.trim();
    } catch { /* Storage failure must not prevent a quote. */ }
  }
  trim() {
    let bytes = 0;
    for (const [key, item] of [...this.entries].reverse()) {
      const size = JSON.stringify([key, item]).length * 2;
      if (bytes + size > this.maxBytes) this.entries.delete(key);
      else bytes += size;
    }
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
  }
  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.flush(); }, 150);
  }
  async flush() {
    clearTimeout(this.saveTimer);
    const resourceCache = [...this.entries];
    this.writing = this.writing.catch(() => {}).then(() => this.storage.set({ resourceCache }));
    try { await this.writing; } catch { /* Quota or disabled storage: keep memory cache. */ }
  }
  async get(key, ttl, loader) {
    await this.ready;
    const cached = this.entries.get(key);
    if (cached) { this.entries.delete(key); this.entries.set(key, cached); }
    if (cached && this.now() - cached.time < ttl) return { ...cached, stale: false };
    if (this.pending.has(key)) return this.pending.get(key);
    const failed = this.failures.get(key);
    if (failed && this.now() - failed.time < 20000) {
      if (cached && this.now() - cached.time < 7 * 86400000) return { ...cached, stale: true, error: failed.error };
      throw new Error(failed.error);
    }
    const task = (async () => {
      try {
        const value = await Promise.resolve().then(loader);
        const entry = { value, time: this.now() };
        this.entries.delete(key);
        this.entries.set(key, entry);
        this.failures.delete(key);
        this.trim(); this.persist();
        return { ...entry, stale: false };
      } catch (error) {
        this.failures.delete(key);
        this.failures.set(key, { time: this.now(), error: error.message });
        while (this.failures.size > this.limit) this.failures.delete(this.failures.keys().next().value);
        // Never present arbitrarily old quotes as usable stale data.
        if (cached && this.now() - cached.time < 7 * 86400000) return { ...cached, stale: true, error: error.message };
        throw error;
      } finally { this.pending.delete(key); }
    })();
    this.pending.set(key, task);
    return task;
  }
}
