// A stand-in for session.mjs's openSession, for tests: the test feeds the messages Claude Code would send and
// sees what the host asked of the session. No process, no cost.
export function stubSessions() {
  const opened = []
  const openSession = (options) => {
    const queue = []
    let wake = null
    let done = false
    let failure = null
    const session = {
      options, sent: [], interrupts: 0, closed: false,
      feed(...messages) { queue.push(...messages); wake?.() },
      end() { done = true; wake?.() },
      crash(error) { failure = error; wake?.() },
      messages: (async function* () {
        for (;;) {
          if (queue.length) { yield queue.shift(); continue }
          if (failure) throw failure
          if (done) return
          await new Promise((resolve) => { wake = resolve })
        }
      })(),
      send(text) { session.sent.push(text); return `uuid-${session.sent.length}` },
      async interrupt() { session.interrupts++ },
      close() { session.closed = true; session.end() },
    }
    opened.push(session)
    return session
  }
  return { opened, openSession }
}

/** Let queued messages flow through the host's loop. */
export const settle = () => new Promise((resolve) => setImmediate(resolve))
