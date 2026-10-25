// One Claude Code started ahead, for the next new conversation (docs/agent.md §30): the SDK's startup() spawns and
// initializes it so the first message skips that (~0.55 s measured). Taken, the next one is started; a start that
// fails gives null and the caller starts cold, as before. Pure: startup is given, so this is tested with a fake.
export function createWarmer({ startup, options, warn = (m) => console.error(m) }) {
  let next = null  // a promise of the handle, or of null when starting failed
  let closed = false
  const start = () => {
    if (closed) return
    next = startup({ options: options() }).catch((e) => { warn(`agent: could not start Claude Code ahead: ${e.message}`); return null })
  }
  start()
  return {
    /** The one that was started ahead (or null: go the cold way), and the next is started. */
    async take() {
      if (closed) return null
      const taken = next
      start()
      return taken ? await taken : null
    },
    /** Closes the spare; none is started after. */
    close() {
      closed = true
      const spare = next
      next = null
      if (spare) void spare.then((h) => h?.close())
    },
  }
}
