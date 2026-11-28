// What the shell (Electron main) and the server say to each other over the child process's IPC channel:
// one closed list, each message checked on receipt. The server's settings travel here, not in its
// environment or arguments, so nothing it starts later inherits the token.
import { z } from "zod"

export const ServerConfig = z.strictObject({
  /** 0 = any free port. */
  port: z.int().min(0).max(65535),
  /** The secret a page must present; new on every launch. */
  token: z.string().min(32),
  /** The book's database file. */
  dbPath: z.string().min(1),
  /** The built page (app/dist). */
  clientDir: z.string().min(1),
})
export type ServerConfig = z.infer<typeof ServerConfig>

/** Shell → server. */
export const ToServer = z.strictObject({ start: ServerConfig })
export type ToServer = z.infer<typeof ToServer>

/** Server → shell. */
export const ToShell = z.strictObject({ ready: z.strictObject({ port: z.int().min(1).max(65535), protocol: z.int() }) })
export type ToShell = z.infer<typeof ToShell>
