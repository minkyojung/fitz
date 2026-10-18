import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { sessionFile, sessionKeeper } from "./keep.mjs"

function folders(t) {
  const root = mkdtempSync(join(tmpdir(), "fitz-keep-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { configDir: join(root, "config"), keepDir: join(root, "kept"), cwd: "/Users/me/.fitz/agent" }
}
const ID = "0b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11"

test("the session file is where Claude Code keeps it: the cwd with non-alphanumerics as dashes, under projects/", () => {
  assert.equal(sessionFile(ID, { cwd: "/Users/me/.fitz/agent", configDir: "/c" }), `/c/projects/-Users-me--fitz-agent/${ID}.jsonl`)
})

test("save copies the session file whole; nothing to copy before Claude Code wrote it", (t) => {
  const f = folders(t)
  const keeper = sessionKeeper(f)
  assert.equal(keeper.save(ID), false)
  mkdirSync(join(f.configDir, "projects", "-Users-me--fitz-agent"), { recursive: true })
  writeFileSync(sessionFile(ID, f), '{"type":"user"}\n')
  assert.equal(keeper.save(ID), true)
  assert.equal(readFileSync(join(f.keepDir, `${ID}.jsonl`), "utf8"), '{"type":"user"}\n')
})

test("restore puts the copy back only when the original is gone", (t) => {
  const f = folders(t)
  const keeper = sessionKeeper(f)
  assert.equal(keeper.restore(ID), false, "no copy")
  mkdirSync(join(f.configDir, "projects", "-Users-me--fitz-agent"), { recursive: true })
  writeFileSync(sessionFile(ID, f), "turn 1\n")
  keeper.save(ID)
  writeFileSync(sessionFile(ID, f), "turn 1\nturn 2\n")
  assert.equal(keeper.restore(ID), false, "the original is there: it wins")
  assert.equal(readFileSync(sessionFile(ID, f), "utf8"), "turn 1\nturn 2\n")
  rmSync(join(f.configDir, "projects"), { recursive: true })  // the 30-day sweep
  assert.equal(keeper.restore(ID), true)
  assert.equal(readFileSync(sessionFile(ID, f), "utf8"), "turn 1\n")
})
