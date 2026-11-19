const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

let db;

function open() {
  if (db) return db;
  if (config.dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });
  }
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return db;
}

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = open().prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// Parameterised helpers only: values are always bound, never concatenated into SQL.
const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

function all(sql, ...params) { return stmt(sql).all(...clean(params)); }
function get(sql, ...params) { return stmt(sql).get(...clean(params)); }
function run(sql, ...params) {
  const r = stmt(sql).run(...clean(params));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

function transaction(fn) {
  const d = open();
  d.exec('BEGIN');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

function close() {
  if (db) { db.close(); db = undefined; cache.clear(); }
}

module.exports = { open, all, get, run, transaction, close };
