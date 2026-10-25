import { DiffView } from "@/features/review/DiffView"
import { SpellGallery } from "./SpellGallery"
import { TranslateGallery } from "./TranslateGallery"
import { BilingualGallery } from "./BilingualGallery"
import { NotesGallery } from "./NotesGallery"
import { SchemeGallery } from "./SchemeGallery"
import { AuthorNoteGallery } from "./AuthorNoteGallery"
import { SuggestionsGallery } from "./SuggestionsGallery"
import { AgentGallery } from "./AgentGallery"
import { UndoGallery } from "./UndoGallery"
import { ShellGallery } from "./ShellGallery"
import { SessionGallery } from "./SessionGallery"
import { ComposerGallery } from "./ComposerGallery"
import { LiveGallery } from "./LiveGallery"
import { WordsGallery } from "./WordsGallery"
import { SourceText } from "@/features/review/SourceText"
import { EditedDot } from "@/features/review/EditedDot"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { IconChevronRight } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const OCR = "In this one, the Central American isthmus where he cleafed the jungle and made his fortune. After ten years in the South, he was known by a variety of nicknames: Z, the Russian, Sam the Banana Man, El Amigo, the Gringo."
const CASES: { title: string; ocr: string | null; text: string }[] = [
  { title: "글자 하나 고침 (cleafed → cleared)", ocr: OCR, text: OCR.replace("cleafed", "cleared") },
  { title: "단어 여러 개 바꿈", ocr: OCR, text: OCR.replace("a variety of nicknames", "many names").replace("ten years", "a decade") },
  { title: "지우기만 함 (대체 없음)", ocr: OCR, text: OCR.replace(" the Gringo", "") },
  { title: "손대지 않음", ocr: OCR, text: OCR },
  { title: "원문 없음 (마이그레이션 전 수정)", ocr: null, text: OCR.replace("cleafed", "cleared") },
]

const STEP1 = OCR.replace("cleafed", "cleaned")
const STEP2 = STEP1.replace("cleaned", "cleared").replace("a variety of nicknames", "many names")
const HISTORY: { at: string; label: string; undone: boolean; before?: string; after?: string }[] = [
  { at: "10:42", label: "단락 수정", undone: false, before: STEP1, after: STEP2 },
  { at: "10:41", label: "확인", undone: false },
  { at: "10:40", label: "단락 수정", undone: false, before: OCR, after: STEP1 },
  { at: "10:39", label: "병합", undone: true },
]

function Row({ title, ocr, text }: (typeof CASES)[number]) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
      <div className="mb-1 flex h-6 items-center gap-1.5 text-xs">
        <Checkbox checked aria-label="확인됨" />
        <span className="text-muted-foreground">확인</span>
        <Badge variant="outline">단락</Badge>
        <span className="ml-auto text-muted-foreground">{title}</span>
        <EditedDot ocr={ocr} text={text} />
      </div>
      <p className="reading text-[15px]" lang="en">
        <SourceText text={text} />
      </p>
    </div>
  )
}

export function Gallery() {
  if (location.search.includes("composer")) return <ComposerGallery />
  if (location.search.includes("live")) return <LiveGallery />
  if (location.search.includes("words")) return <WordsGallery />
  if (location.search.includes("session")) return <SessionGallery />
  if (location.search.includes("shell")) return <ShellGallery />
  if (location.search.includes("undo")) return <UndoGallery />
  if (location.search.includes("agent")) return <AgentGallery />
  if (location.search.includes("suggestions")) return <SuggestionsGallery />
  if (location.search.includes("spell")) return <SpellGallery />
  if (location.search.includes("authornote")) return <AuthorNoteGallery />
  if (location.search.includes("scheme")) return <SchemeGallery />
  if (location.search.includes("notes")) return <NotesGallery />
  if (location.search.includes("bilingual")) return <BilingualGallery />
  if (location.search.includes("translate")) return <TranslateGallery />
  return (
    <div className="grid min-h-svh grid-cols-[1fr_340px] gap-6 p-8">
      <div className="space-y-3">
        <h1 className="text-xs font-medium text-muted-foreground">수정 흔적 갤러리 · 바뀐 단어에 배경색, 호버하면 원문</h1>
        {CASES.map((c) => (
          <Row key={c.title} {...c} />
        ))}
      </div>
      <aside className="rounded-md border">
        <Tabs defaultValue="history">
          <TabsList className="m-2">
            <TabsTrigger value="notes">미연결 미주</TabsTrigger>
            <TabsTrigger value="history">이 단락의 기록</TabsTrigger>
          </TabsList>
          <TabsContent value="history">
            <div className="border-b px-3 py-2">
              <div className="mb-1 text-xs font-medium">원문 대비 지금</div>
              <DiffView before={OCR} after={STEP2} />
            </div>
            <ul className="divide-y text-xs">
              {HISTORY.map((h) => (
                <li key={h.at} className={h.undone ? "text-muted-foreground" : ""}>
                  {h.before ? (
                    <Collapsible>
                      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50">
                        <IconChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
                        <span className="tabular-nums">{h.at}</span>
                        <span>{h.label}</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="px-3 pb-2 pl-8">
                        <DiffView before={h.before} after={h.after!} />
                      </CollapsibleContent>
                    </Collapsible>
                  ) : (
                    <div className="flex gap-2 px-3 py-2 pl-8">
                      <span className={`tabular-nums ${h.undone ? "line-through" : ""}`}>{h.at}</span>
                      <span className={h.undone ? "line-through" : ""}>{h.label}</span>
                      {h.undone && <span className="ml-auto">되돌려짐</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </TabsContent>
          <TabsContent value="notes">
            <p className="p-3 text-xs text-muted-foreground">(지금 화면과 동일)</p>
          </TabsContent>
        </Tabs>
      </aside>
    </div>
  )
}
