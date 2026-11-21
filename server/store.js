/* Single-node durable KV: atomic counters and job records. Await-compatible. */
const { db, transaction } = require('./database');
const store = {
  backend:'sqlite',
  get(key) {
    const r = db.prepare('SELECT value,expires_at FROM kv WHERE key=?').get(key);
    if (!r) return null;
    if (r.expires_at && r.expires_at <= Date.now()) { this.del(key); return null; }
    return JSON.parse(r.value);
  },
  set(key, value, ttl) { db.prepare('INSERT INTO kv VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at').run(key,JSON.stringify(value),ttl ? Date.now()+ttl*1000 : 0); },
  del(...keys) { const q=db.prepare('DELETE FROM kv WHERE key=?'); for(const k of keys) q.run(k); },
  incr(key, ttl) { return transaction(() => { const r=db.prepare('SELECT * FROM kv WHERE key=?').get(key); const live=r && (!r.expires_at || r.expires_at>Date.now()); const n=(live ? Number(JSON.parse(r.value)) : 0)+1; db.prepare('INSERT OR REPLACE INTO kv VALUES(?,?,?)').run(key,JSON.stringify(n),live?r.expires_at:Date.now()+ttl*1000); return n; }); },
  entries(prefix) { return db.prepare('SELECT key FROM kv WHERE key LIKE ?').all(prefix+'%').map(r=>[r.key,this.get(r.key)]).filter(([,v])=>v); },
  transaction
};
db.prepare('DELETE FROM kv WHERE expires_at>0 AND expires_at<?').run(Date.now());
module.exports = store;
