// A copy of each conversation's session file, against Claude Code's 30-day sweep of its transcripts (docs/agent.md
// §13; the "move the session file" way of the SDK's sessions guide). The file is copied whole and never read: its
// format is Claude Code's own. Restored to its place when the original is gone, so the session can be read back and
// resumed.
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const KEEP_DIR = join(homedir(), ".fitz", "sessions")

/** Where Claude Code keeps a session started in `cwd` (an absolute, real path): the cwd with every character that is
 *  not a letter or digit turned into "-", under the config folder's projects/. */
export const sessionFile = (sessionId, { cwd, configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude") }) =>
  join(configDir, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${sessionId}.jsonl`)

export function sessionKeeper({ cwd, configDir, keepDir = KEEP_DIR }) {
  const original = (id) => sessionFile(id, { cwd, configDir })
  const copy = (id) => join(keepDir, `${id}.jsonl`)
  return {
    /** Copy the session file as it is now. False when Claude Code has not written it. */
    save(sessionId) {
      if (!existsSync(original(sessionId))) return false
      mkdirSync(keepDir, { recursive: true })
      copyFileSync(original(sessionId), copy(sessionId))
      return true
    },
    /** Put the copy back when the original is gone. True when it did. */
    restore(sessionId) {
      if (existsSync(original(sessionId)) || !existsSync(copy(sessionId))) return false
      mkdirSync(dirname(original(sessionId)), { recursive: true })
      copyFileSync(copy(sessionId), original(sessionId))
      return true
    },
  }
}
