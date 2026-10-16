import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Note, Segment } from "@/data/api"
import { HistoryPanel } from "./HistoryPanel"
import { NotesPanel } from "./NotesPanel"

interface Props {
  notes: Note[]
  segments: Segment[]
  selected: Segment | null
  onAnchor: (noteId: number, segmentId: number) => Promise<unknown>
}

export function ReviewPanel({ notes, segments, selected, onAnchor }: Props) {
  return (
    <Tabs defaultValue="history" className="flex h-full flex-col gap-0">
      <TabsList className="m-2 shrink-0 self-start">
        <TabsTrigger value="history">이 단락의 기록</TabsTrigger>
        <TabsTrigger value="notes">
          미연결 미주
          {notes.length > 0 && <Badge variant="destructive" className="ml-1">{notes.length}</Badge>}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="history" className="min-h-0 flex-1">
        <HistoryPanel segment={selected} refreshKey={segments} />
      </TabsContent>
      <TabsContent value="notes" className="min-h-0 flex-1">
        <NotesPanel notes={notes} segments={segments} onAnchor={onAnchor} />
      </TabsContent>
    </Tabs>
  )
}
