/** How a task Claude runs on a chapter (the review, the OCR-error hunt; docs/agent.md §4) is going, read off the
 *  events of its conversation on the live connection. A task answers once, so its first turn's end is its end. */
import type { LiveEvent } from "./live.ts"

export type TaskRun = { state: "running" } | { state: "done" } | { state: "failed"; message: string }

type Turn = { reason: string; isError: boolean }

/** The end of the turn an event tells of: a result as it arrives, or the one a snapshot holds (after a reconnect). */
function turnIn(e: LiveEvent): Turn | null {
  if (e.type === "message") {
    const m = e.message as { type?: string; subtype?: string; terminal_reason?: string; is_error?: boolean }
    return m?.type === "result" ? { reason: m.terminal_reason ?? m.subtype ?? "", isError: m.is_error === true } : null
  }
  if (e.type === "snapshot") {
    const items = (e.state as { items?: { kind: string; reason?: string; isError?: boolean }[] })?.items ?? []
    const turn = items.findLast((i) => i.kind === "turn")
    return turn ? { reason: turn.reason ?? "", isError: turn.isError === true } : null
  }
  return null
}

/** The run after one event of its conversation. Once it has ended it stays as it ended. */
export function nextRun(run: TaskRun, e: LiveEvent): TaskRun {
  if (run.state !== "running") return run
  if (e.type === "error") return { state: "failed", message: String(e.message) }
  const turn = turnIn(e)
  // no longer at work with no turn ended: its Claude Code went before answering (the server restarted, say)
  if (!turn) return e.type === "snapshot" && e.working === false ? { state: "failed", message: "Claude Code stopped before answering" } : run
  return turn.isError ? { state: "failed", message: `Claude stopped before answering (${turn.reason})` } : { state: "done" }
}
