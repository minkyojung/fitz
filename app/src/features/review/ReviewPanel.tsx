import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Note, Segment, Suggestion, SuggestionDecision, TaskName, TaskRun } from "@/data/api"
import { FindPanel } from "./FindPanel"
import { GlossaryPanel } from "./GlossaryPanel"
import { HistoryPanel } from "./HistoryPanel"
import { NotesTab } from "@/features/notes/NotesTab"
import { SuggestionsTab } from "@/features/suggestions/SuggestionsTab"
import { useSuggestions } from "@/features/suggestions/SuggestionsContext"

interface Props {
  notes: Note[]
  segments: Segment[]
  selected: Segment | null
  onAnchor: (noteId: number, segmentId: number) => Promise<unknown>
  onJump: (segmentId: number, chapterId: number) => void
  onReplaceAll: (query: string, replacement: string) => Promise<unknown>
  /** Controlled tab so ⌘F can open "Find". */
  tab: string
  onTabChange: (tab: string) => void
  findFocusToken: number
  markers: Map<number, string>
  /** Claude's task for this view (the review while translating, the OCR hunt while reviewing the source). */
  suggest: { task: TaskName; run: TaskRun | undefined; onRun: () => void; onDecide: (s: Suggestion, decision: SuggestionDecision) => Promise<unknown> }
}

export function ReviewPanel({ notes, segments, selected, onAnchor, onJump, onReplaceAll, tab, onTabChange, findFocusToken, markers, suggest }: Props) {
  const suggestions = useSuggestions()?.suggestions ?? []
  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(v as string)} className="flex h-full flex-col gap-0">
      {/* five tabs do not fit a narrow panel on one row: they wrap to a second */}
      <TabsList className="m-2 shrink-0 flex-wrap self-start group-data-horizontal/tabs:h-auto [&>[data-slot=tabs-trigger]]:h-[26px]">
        <TabsTrigger value="history">History</TabsTrigger>
        <TabsTrigger value="find">Find</TabsTrigger>
        <TabsTrigger value="glossary">Glossary</TabsTrigger>
        <TabsTrigger value="notes">
          Notes
          {notes.length > 0 && <Badge variant="destructive" className="ml-1" title="Unlinked author notes">{notes.length}</Badge>}
        </TabsTrigger>
        <TabsTrigger value="suggestions">
          Suggestions
          {suggestions.length > 0 && <Badge variant="secondary" className="ml-1" title="Claude's open suggestions">{suggestions.length}</Badge>}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="history" className="min-h-0 flex-1">
        <HistoryPanel segment={selected} refreshKey={segments} />
      </TabsContent>
      <TabsContent value="find" className="min-h-0 flex-1">
        <FindPanel refreshKey={segments} onJump={onJump} onReplaceAll={onReplaceAll} focusToken={findFocusToken} />
      </TabsContent>
      <TabsContent value="glossary" className="min-h-0 flex-1">
        <GlossaryPanel onJump={onJump} />
      </TabsContent>
      <TabsContent value="notes" className="min-h-0 flex-1">
        <NotesTab segment={selected} segments={segments} markers={markers} unlinked={notes} onAnchorUnlinked={onAnchor} />
      </TabsContent>
      <TabsContent value="suggestions" className="min-h-0 flex-1">
        <SuggestionsTab task={suggest.task} segments={segments} run={suggest.run} onRun={suggest.onRun} onDecide={suggest.onDecide} />
      </TabsContent>
    </Tabs>
  )
}
