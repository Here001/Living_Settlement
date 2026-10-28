// How world changes reach every server instance (and from there, every viewer).
// With one server, changes stay in memory. Set REDIS_URL and every instance shares them over Redis pub/sub,
// so you can run as many web servers as traffic needs behind a load balancer.
const CHANNEL = 'city:ops';

class MemoryBus {
  constructor() { this.handlers = new Set(); this.kind = 'memory'; }
  async start() {}
  on(fn) { this.handlers.add(fn); }
  publish(ops) { if (ops.length) for (const fn of this.handlers) fn(ops); }
}

class RedisBus {
  constructor(url) { this.url = url; this.handlers = new Set(); this.kind = 'redis'; }
  async start() {
    const { createClient } = await import('redis');
    this.pub = createClient({ url: this.url }); this.sub = this.pub.duplicate();
    for (const c of [this.pub, this.sub]) c.on('error', e => console.error('redis:', e.message));
    await this.pub.connect(); await this.sub.connect();
    await this.sub.subscribe(CHANNEL, msg => { let ops; try { ops = JSON.parse(msg); } catch { return; } for (const fn of this.handlers) fn(ops); });
  }
  on(fn) { this.handlers.add(fn); }
  publish(ops) { if (ops.length) this.pub.publish(CHANNEL, JSON.stringify(ops)).catch(e => console.error('redis publish failed:', e.message)); }
}

export const createBus = () => process.env.REDIS_URL ? new RedisBus(process.env.REDIS_URL) : new MemoryBus();
