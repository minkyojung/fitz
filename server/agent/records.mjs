// The agent's conversations as the app keeps them (docs/agent.md §13), the way Octave does: a list with the app's own
// ids, and per turn what Claude Code's session file lacks. The conversation itself lives in that session file.
// Not book edits: these never go through execute(), are not undone and are not announced as changes to the book.

export const conversationRow = (r) => ({
  id: r.id, sessionId: r.session_id ?? null, title: r.title ?? null, model: r.model, effort: r.effort,
  task: r.task ?? null, chapterId: r.chapter_id ?? null, createdAt: r.created_at, usedAt: r.used_at,
})

export const addConversation = (db, { id, model, effort, task = null, chapterId = null }) =>
  db.prepare("INSERT INTO agent_conversation(id, model, effort, task, chapter_id) VALUES (?, ?, ?, ?, ?)").run(id, model, effort, task, chapterId)

export function getConversation(db, id) {
  const r = db.prepare("SELECT * FROM agent_conversation WHERE id = ?").get(id)
  return r ? conversationRow(r) : null
}

/** Most recently used first. */
export const listConversations = (db) =>
  db.prepare("SELECT * FROM agent_conversation ORDER BY used_at DESC, created_at DESC, rowid DESC").all().map(conversationRow)

export const setSession = (db, id, sessionId) => db.prepare("UPDATE agent_conversation SET session_id = ? WHERE id = ?").run(sessionId, id)
export const setTitle = (db, id, title) => db.prepare("UPDATE agent_conversation SET title = ? WHERE id = ?").run(title, id)
export const touchConversation = (db, id) => db.prepare("UPDATE agent_conversation SET used_at = datetime('now') WHERE id = ?").run(id)

/** A finished turn, keyed by its session and the translator's message that began it. */
export const recordTurn = (db, sessionId, userUuid, { reason, isError, ms, cost }) =>
  db.prepare("INSERT OR REPLACE INTO agent_turn(session_id, user_uuid, reason, is_error, ms, cost) VALUES (?, ?, ?, ?, ?, ?)")
    .run(sessionId, userUuid, reason, isError ? 1 : 0, ms ?? null, cost ?? null)

/** The kept turns of a session: user message uuid → { reason, isError, ms, cost }. */
export const turnsOf = (db, sessionId) =>
  new Map(db.prepare("SELECT * FROM agent_turn WHERE session_id = ?").all(sessionId)
    .map((r) => [r.user_uuid, { reason: r.reason, isError: r.is_error === 1, ms: r.ms, cost: r.cost }]))
