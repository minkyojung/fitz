// Types for fold.mjs: the editor's page folds a conversation with the same code the server does (docs/agent.md §17).

export type Item =
  | { kind: "user"; uuid: string; text: string }
  | { kind: "thinking"; id: string; text: string }
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: Record<string, unknown>; status: "running" | "done" | "error"; result: unknown }
  | { kind: "turn"; reason: string; isError: boolean; ms: number | null; cost: number | null }

export interface Conversation {
  sessionId: string | null
  model: string | null
  status: "idle" | "running" | "requires_action"
  items: Item[]
  /** The block being written now. */
  live: { kind: "thinking" | "text" | "tool"; text: string; name?: string } | null
  spent: number
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
