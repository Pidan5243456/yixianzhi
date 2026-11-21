require('./ai/config');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'yixianzhi.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(email TEXT PRIMARY KEY, created_at TEXT NOT NULL, last_login_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS user_state(email TEXT PRIMARY KEY REFERENCES users(email), version INTEGER NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS media(owner TEXT NOT NULL REFERENCES users(email), id TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY(owner,id));
 CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, ts TEXT NOT NULL, event TEXT NOT NULL, email TEXT, props TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS events_time ON events(ts);
 `);
let depth = 0;
function transaction(fn) {
  if (depth) return fn();
  db.exec('BEGIN IMMEDIATE'); depth++;
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch(e) { db.exec('ROLLBACK'); throw e; }
  finally { depth--; }
}
function ensureUser(email) {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO users VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET last_login_at=excluded.last_login_at').run(email,now,now);
}
const version=db.prepare('PRAGMA user_version').get().user_version;
if(version>3) throw new Error('数据库版本较新，请使用匹配的服务版本');
if(version<2) transaction(()=>{
 db.exec(`CREATE TABLE IF NOT EXISTS consents(owner TEXT NOT NULL REFERENCES users(email),purpose TEXT NOT NULL,version INTEGER NOT NULL,granted INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,purpose));
 CREATE TABLE IF NOT EXISTS ai_operations(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(email),kind TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL,result TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,cycle INTEGER NOT NULL DEFAULT 1,UNIQUE(owner,kind,fingerprint));
 CREATE INDEX IF NOT EXISTS ai_operations_owner ON ai_operations(owner,created_at);
 CREATE TABLE IF NOT EXISTS ai_usage(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,owner TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,budget_day TEXT NOT NULL,reserved INTEGER NOT NULL,status TEXT NOT NULL,usage TEXT,started_at INTEGER NOT NULL,finished_at INTEGER);
 CREATE INDEX IF NOT EXISTS ai_usage_day ON ai_usage(budget_day,owner);
 PRAGMA user_version=2;`);
});
if(version<3) transaction(()=>{
 db.exec(`CREATE TABLE IF NOT EXISTS entities(owner TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT,version INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,kind,id));
 CREATE TABLE IF NOT EXISTS changes(cursor INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT,deleted INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS changes_owner ON changes(owner,cursor);
 CREATE TABLE IF NOT EXISTS sync_migrations(owner TEXT PRIMARY KEY,source_version INTEGER NOT NULL,migrated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS mutations(owner TEXT NOT NULL,id TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(owner,id));
 CREATE TABLE IF NOT EXISTS media_age(owner TEXT NOT NULL,id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,id));
 CREATE TABLE IF NOT EXISTS accounts(email TEXT PRIMARY KEY,generation INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,email TEXT NOT NULL,generation INTEGER NOT NULL,expires_at INTEGER NOT NULL);
 INSERT OR IGNORE INTO accounts(email) SELECT email FROM users;
 CREATE TABLE IF NOT EXISTS operation_inputs(id TEXT PRIMARY KEY,data TEXT NOT NULL,expires_at INTEGER NOT NULL);
 PRAGMA user_version=3;`);
});
module.exports = { db, dataDir, transaction, ensureUser };
