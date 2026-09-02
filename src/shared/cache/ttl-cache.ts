/**
 * A deliberately tiny read-through cache for hot public GETs. In-memory, per
 * process — good enough for one droplet; swap for Redis when there are two.
 *
 * Writers call `clear()` so a just-published listing never waits out a TTL.
 */
export class TtlCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly max = 200) {}

  async wrap<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;

    const value = await load();
    if (this.store.size >= this.max) {
      // Drop the oldest entry — plain FIFO beats bookkeeping at this size.
      const first = this.store.keys().next().value;
      if (first !== undefined) this.store.delete(first);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  clear(): void {
    this.store.clear();
  }
}
