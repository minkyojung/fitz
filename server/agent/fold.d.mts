// Types for fold.mjs: the editor's page folds a conversation with the same code the server does (docs/agent.md §17).

export type Item =
  | { kind: "user"; uuid: string; text: string }
  | { kind: "thinking"; id: string; text: string }
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: Record<string, unknown>; status: "running" | "done" | "error"; result: unknown }
  /** error: what the API answered when it did not answer (authentication_failed, rate_limit, overloaded, …), else null */
  | { kind: "turn"; reason: string; isError: boolean; ms: number | null; cost: number | null; error: string | null }

export interface Conversation {
  sessionId: string | null
  model: string | null
  status: "idle" | "running" | "requires_action"
  items: Item[]
  /** The block being written now. */
  live: { kind: "thinking" | "text" | "tool"; text: string; name?: string } | null
  spent: number
  /** A request being tried again (docs/agent.md §29), or null. */
  retry: { attempt: number; max: number; delayMs: number; error: string | null } | null
  /** The plan's last rate_limit_event, or null. */
  limits: { status: string | null; type: string | null; resetsAt: number | null; windows: Record<string, { utilization?: number; resetsAt?: number }> | null } | null
  /** The error the API answered in this turn so far, carried to the turn's end. */
  apiError: string | null
}

/** One Claude Agent SDK message, as the server passes it on. */
export type SdkMessage = { type: string } & Record<string, unknown>

export function emptyConversation(): Conversation
export function applyMessage(state: Conversation, message: SdkMessage): Conversation
export function foldMessages(messages: SdkMessage[], state?: Conversation): Conversation
export function foldStored(
  messages: SdkMessage[],
  turns?: Map<string, { reason: string; isError: boolean; ms: number | null; cost: number | null }>,
  sessionId?: string | null,
): Conversation
