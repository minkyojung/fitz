import { useState } from "react"
import { IconChevronDown, IconPlus } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Segment, Suggestion, SuggestionDecision, TaskName, TaskRun } from "@/data/api"
import type { Claude } from "@/data/useClaude"
import { Suggestions } from "@/features/suggestions/Suggestions"
import { useSuggestions } from "@/features/suggestions/SuggestionsContext"
import { readPointed } from "@/lib/conversation"
import { ago } from "@/lib/trace"
import { Composer } from "./Composer"
import { Thread } from "./Thread"

interface Props {
  claude: Claude
  /** Brings the cursor to the box (Ask Claude). */
  focusToken: number
  segments: Segment[]
  suggest: { task: TaskName; run: TaskRun | undefined; onRun: () => void; onDecide: (s: Suggestion, decision: SuggestionDecision) => Promise<unknown> }
}

/** Everything Claude (docs/agent.md §17): one head row — the conversation, and this chapter's suggestions folded away
 *  until wanted — then the conversation and the box to write in. */
export function ClaudeTab({ claude, focusToken, segments, suggest }: Props) {
  const ctx = useSuggestions()
  const open = ctx?.suggestions.length ?? 0
  const [suggestionsShown, setSuggestionsShown] = useState(false)
  // a suggestion picked in the text opens the list at its card (state adjusted while rendering, as React advises)
  const picked = ctx?.selected ?? null
  const [openedFor, setOpenedFor] = useState<number | null>(null)
  if (picked !== null && picked !== openedFor) { setOpenedFor(picked); setSuggestionsShown(true) }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Collapsible open={suggestionsShown} onOpenChange={setSuggestionsShown} className="shrink-0 border-b">
        <div className="flex h-9 items-center gap-1 px-1.5">
          <ConversationMenu claude={claude} />
          <Button size="sm" variant={suggestionsShown ? "secondary" : "ghost"} className="ml-auto shrink-0" aria-expanded={suggestionsShown}
            onClick={() => setSuggestionsShown(!suggestionsShown)}>
            Suggestions <Badge variant="secondary" data-open-suggestions>{open}</Badge>
          </Button>
        </div>
        <CollapsibleContent className="max-h-[45vh] overflow-auto border-t">
          <Suggestions task={suggest.task} segments={segments} run={suggest.run} onRun={suggest.onRun} onDecide={suggest.onDecide} />
        </CollapsibleContent>
      </Collapsible>
      <Thread claude={claude} />
      <Composer claude={claude} focusToken={focusToken} />
    </div>
  )
}

/** The conversation's title is the menu of conversations: a new one, and the recent ones. */
function ConversationMenu({ claude }: { claude: Claude }) {
  const first = claude.view.state.items.find((i) => i.kind === "user")
  const title = claude.view.title ?? claude.summary?.title ?? (first?.kind === "user" ? readPointed(first.text).text : null) ?? (claude.pending ? readPointed(claude.pending).text : null) ?? "New conversation"
  return (
    <DropdownMenu onOpenChange={(o) => { if (o) void claude.refreshList() }}>
      <DropdownMenuTrigger render={<Button size="sm" variant="ghost" className="min-w-0 shrink justify-start" />}>
        <span className="truncate" data-conversation-title>{title}</span>
        <IconChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem onClick={claude.newConversation}><IconPlus />New conversation</DropdownMenuItem>
        {claude.list.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Recent</DropdownMenuLabel>
              {claude.list.slice(0, 20).map((c) => (
                <DropdownMenuItem key={c.id} onClick={() => claude.open(c.id)}>
                  <span className="truncate">{c.title ?? "Untitled"}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">{ago(c.usedAt)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
