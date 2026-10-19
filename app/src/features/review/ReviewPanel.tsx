import { IconSparkles } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Segment, Suggestion, SuggestionDecision, TaskName, TaskRun } from "@/data/api"
import { NotesTab } from "@/features/notes/NotesTab"
import { ClaudeTab } from "@/features/agent/ClaudeTab"
import type { Claude } from "@/data/useClaude"
import { useSuggestions } from "@/features/suggestions/SuggestionsContext"

interface Props {
  segments: Segment[]
  selected: Segment | null
  /** Controlled tab, so a note picked in the text opens Notes and Ask Claude opens Claude. */
  tab: string
  onTabChange: (tab: string) => void
  markers: Map<number, string>
  /** Claude's task for this view (the review while translating, the OCR hunt while reviewing the source). */
  suggest: { task: TaskName; run: TaskRun | undefined; onRun: () => void; onDecide: (s: Suggestion, decision: SuggestionDecision) => Promise<unknown> }
  claude: Claude
  /** Brings the cursor to Claude's box (Ask Claude). */
  claudeFocusToken: number
}

export function ReviewPanel({ segments, selected, tab, onTabChange, markers, suggest, claude, claudeFocusToken }: Props) {
  const suggestions = useSuggestions()?.suggestions ?? []
  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(v as string)} className="flex h-full flex-col gap-0">
      {/* the tabs do not fit a narrow panel on one row: they wrap to a second */}
      <TabsList className="m-2 shrink-0 flex-wrap self-start group-data-horizontal/tabs:h-auto [&>[data-slot=tabs-trigger]]:h-[26px]">
        <TabsTrigger value="notes">Notes</TabsTrigger>
        <TabsTrigger value="claude">
          <IconSparkles />Claude
          {claude.view.asks.length > 0 ? (
            <Badge className="ml-1" title="Claude is waiting for your answer">{claude.view.asks.length}</Badge>
          ) : suggestions.length > 0 && <Badge variant="secondary" className="ml-1" title="Claude's open suggestions">{suggestions.length}</Badge>}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="notes" className="min-h-0 flex-1">
        <NotesTab segment={selected} segments={segments} markers={markers} />
      </TabsContent>
      {/* kept mounted: a conversation goes on while another tab is open */}
      <TabsContent value="claude" keepMounted className="min-h-0 flex-1">
        <ClaudeTab claude={claude} focusToken={claudeFocusToken} segments={segments} suggest={suggest} />
      </TabsContent>
    </Tabs>
  )
}
