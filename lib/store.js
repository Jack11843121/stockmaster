/**
 * SQLite 存储：历史看板（每日存档）+ 对话记忆。
 * 使用 Node 内置 node:sqlite（无需第三方依赖）。
 * @module @local/dsh-stock-dashboard/lib/store
 */
import { DatabaseSync } from 'node:sqlite'

export function createStore(dbPath) {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      date TEXT PRIMARY KEY,
      snapshot TEXT,
      report TEXT,
      swing TEXT,
      backtest TEXT,
      strategy TEXT,
      macro TEXT,
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS chat_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT,
      role TEXT,
      content TEXT
    );
  `)

  const upsert = db.prepare(`
    INSERT INTO history (date, snapshot, report, swing, backtest, strategy, macro, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      snapshot=excluded.snapshot, report=excluded.report, swing=excluded.swing,
      backtest=excluded.backtest, strategy=excluded.strategy, macro=excluded.macro,
      archived_at=excluded.archived_at
  `)
  const listQ = db.prepare('SELECT date, report, archived_at FROM history ORDER BY date DESC LIMIT ?')
  const getQ = db.prepare('SELECT * FROM history WHERE date = ?')
  const insertChat = db.prepare('INSERT INTO chat_memory (ts, role, content) VALUES (?, ?, ?)')
  const listChat = db.prepare('SELECT role, content FROM chat_memory ORDER BY id DESC LIMIT ?')

  const s = (v) => (v == null ? null : JSON.stringify(v))

  return {
    archiveDay(date, payload) {
      upsert.run(
        date,
        s(payload.snapshot), s(payload.report), s(payload.swing),
        s(payload.backtest), s(payload.strategy), s(payload.macro),
        new Date().toISOString(),
      )
    },
    listHistory(limit = 120) {
      return listQ.all(limit).map((r) => ({
        date: r.date,
        archivedAt: r.archived_at,
        report: r.report ? JSON.parse(r.report) : null,
      }))
    },
    getHistory(date) {
      const r = getQ.get(date)
      if (!r) return null
      const p = (v) => (v ? JSON.parse(v) : null)
      return {
        date: r.date,
        archivedAt: r.archived_at,
        snapshot: p(r.snapshot), report: p(r.report), swing: p(r.swing),
        backtest: p(r.backtest), strategy: p(r.strategy), macro: p(r.macro),
      }
    },
    appendChat(role, content) {
      insertChat.run(new Date().toISOString(), role, String(content || ''))
    },
    listChat(limit = 30) {
      return listChat.all(limit).reverse()
    },
    close() { try { db.close() } catch { /* ignore */ } },
  }
}