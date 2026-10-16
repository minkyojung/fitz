import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Note, Segment } from "@/data/api"
import { FindPanel } from "./FindPanel"
import { GlossaryPanel } from "./GlossaryPanel"
import { HistoryPanel } from "./HistoryPanel"
import { NotesPanel } from "./NotesPanel"

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
}

export function ReviewPanel({ notes, segments, selected, onAnchor, onJump, onReplaceAll, tab, onTabChange, findFocusToken }: Props) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(v as string)} className="flex h-full flex-col gap-0">
      <TabsList className="m-2 shrink-0 self-start">
        <TabsTrigger value="history">History</TabsTrigger>
        <TabsTrigger value="find">Find</TabsTrigger>
        <TabsTrigger value="glossary">Glossary</TabsTrigger>
        <TabsTrigger value="notes">
          Unlinked notes
          {notes.length > 0 && <Badge variant="destructive" className="ml-1">{notes.length}</Badge>}
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
        <NotesPanel notes={notes} segments={segments} onAnchor={onAnchor} />
      </TabsContent>
    </Tabs>
  )
}
