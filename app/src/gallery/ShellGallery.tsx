import { Fragment, useEffect, useEffectEvent, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react"
import {
  IconArrowUp, IconBook, IconBook2, IconCheck, IconChevronDown, IconChevronRight, IconFileExport, IconInfoCircle, IconLanguage, IconMessage,
  IconPlus, IconScan, IconSearch, IconSparkles, IconTrash,
} from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarInset, SidebarMenu,
  SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace"
import { DiffView } from "@/features/review/DiffView"
import { cn } from "cn"

// Design check for the shell before it is built: sidebar-07's sidebar (collapses to icons) with the stages above the
// chapters, the right panel for Claude alone, and the panel's other tabs sent where their scope lives — Find to the
// sidebar (book-wide, results kept in view), Glossary to a page of its own (and its marks in the text), a paragraph's
// comments, notes and history to that paragraph, the unplaced author notes to the status bar.
// Sample text: The Great Gatsby (public domain).

type Stage = "review" | "translate" | "export" | "glossary"
type ChapterStage = "review" | "translate"
const isChapterStage = (s: Stage): s is ChapterStage => s === "review" || s === "translate"

const STAGES = [
  { value: "review", label: "Review", icon: IconScan },
  { value: "translate", label: "Translate", icon: IconLanguage },
  { value: "export", label: "Export", icon: IconFileExport },
] as const

interface Chapter { id: number; title: string; total: number; other: { verified: number; confirmed: number } }
/** `other`: the paragraphs not written out below, already done. */
const CHAPTERS: Chapter[] = [
  [46, 40, 2], [38, 38, 0], [52, 30, 0], [41, 12, 0], [35, 0, 0], [44, 0, 0], [61, 0, 0], [39, 0, 0], [48, 0, 0],
].map(([total, verified, confirmed], i) => ({
  id: i + 1, title: `Chapter ${["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"][i]}`, total, other: { verified, confirmed },
}))

interface Op { at: string; label: string; before?: string; after?: string; undone?: boolean }
interface Seg { id: number; chapterId: number; n: number; page: number; ocr: string; en: string; ko: string; verified: boolean; confirmed: boolean; ops: Op[] }

const P1 = "In my younger and more vulnerable years my father gave me some advice that I've been turning over in my mind ever since."
const P4 = "The abnormal mind is quick to detect and attach itself to this quality when it appears in a normal person, and so it came about that in college I was unjustly accused of being a politician, because I was privy to tbe secret griefs of wild, unknown men."
const SEGS: Seg[] = [
  {
    id: 1, chapterId: 1, n: 1, page: 1, ocr: P1.replace("vulnerable", "vulnerahle"), en: P1, verified: true, confirmed: true,
    ko: "지금보다 어리고 쉽게 상처받던 시절, 아버지가 내게 해 주신 충고가 있는데 나는 그 뒤로 줄곧 그 말을 곱씹어 왔다.",
    ops: [
      { at: "10:42", label: "Verified" },
      { at: "10:41", label: "Edit text", before: P1.replace("vulnerable", "vulnerahle"), after: P1 },
    ],
  },
  {
    id: 2, chapterId: 1, n: 2, page: 1, verified: true, confirmed: false, ops: [],
    ocr: "“Whenever you feel like criticizing any one,” he told me, “just remember that all the people in this world haven't had the advantages that you've had.”",
    en: "“Whenever you feel like criticizing any one,” he told me, “just remember that all the people in this world haven't had the advantages that you've had.”",
    ko: "“누군가를 비판하고 싶어질 때면,” 아버지는 내게 말씀하셨다. “이 세상 모든 사람이 다 너처럼 좋은 조건을 누린 건 아니라는 걸 기억하렴.”",
  },
  {
    id: 3, chapterId: 1, n: 3, page: 1, verified: true, confirmed: false, ops: [],
    ocr: "He didn't say any more, but we've always been unusually communicative in a reserved way, and I understood that he meant a great deal more than that. In consequence, I'm inclined to reserve all judgments, a habit that has opened up many curious natures to me.",
    en: "He didn't say any more, but we've always been unusually communicative in a reserved way, and I understood that he meant a great deal more than that. In consequence, I'm inclined to reserve all judgments, a habit that has opened up many curious natures to me.",
    ko: "아버지는 더 말씀하지 않으셨지만, 우리 부자는 늘 말을 아끼면서도 유난히 잘 통하는 사이였다. 그래서 나는 모든 판단을 유보하는 버릇이 생겼는데, 그 버릇 덕분에 별난 사람들이 내게 마음을 열었다.",
  },
  {
    id: 4, chapterId: 1, n: 4, page: 2, ocr: P4, en: P4, verified: false, confirmed: false, ops: [],
    ko: "비정상적인 정신은 정상적인 사람에게서 이런 기질을 재빨리 알아보고 들러붙는다. 그래서 대학 시절 나는 정치꾼이라는 억울한 소리를 들었는데, 낯설고 거친 사내들의 남모를 슬픔을 내가 알고 있었기 때문이다.",
  },
  {
    id: 5, chapterId: 1, n: 5, page: 3, verified: false, confirmed: false, ops: [],
    ocr: "I lived at West Egg, the—well, the less fashionable of the two, though this is a most superficial tag to express the bizarre and not a little sinister contrast between them.",
    en: "I lived at West Egg, the—well, the less fashionable of the two, though this is a most superficial tag to express the bizarre and not a little sinister contrast between them.",
    ko: "나는 웨스트에그에 살았다. 두 곳 중 덜 세련된 쪽이었는데, 이건 둘 사이의 기묘하고 꽤나 불길한 대비를 나타내기엔 아주 피상적인 이름표일 뿐이다.",
  },
  {
    id: 6, chapterId: 1, n: 6, page: 3, verified: false, confirmed: false, ops: [], ko: "",
    ocr: "Instead of being the warm centre of the world, the Middle West now seemed like the ragged edge of the universe.",
    en: "Instead of being the warm centre of the world, the Middle West now seemed like the ragged edge of the universe.",
  },
  {
    id: 7, chapterId: 3, n: 1, page: 39, verified: false, confirmed: false, ops: [], ko: "",
    ocr: "There was music from my neighbor's house through the summer nights. In his blue gardens men and girls came and went like moths among tbe whisperings and the champagne and the stars.",
    en: "There was music from my neighbor's house through the summer nights. In his blue gardens men and girls came and went like moths among tbe whisperings and the champagne and the stars.",
  },
  {
    id: 8, chapterId: 5, n: 1, page: 81, verified: false, confirmed: false, ops: [], ko: "",
    ocr: "“If it wasn't for tbe mist we could see your home across the bay,” said Gatsby. “You always have a green light that burns all night at the end of your dock.”",
    en: "“If it wasn't for tbe mist we could see your home across the bay,” said Gatsby. “You always have a green light that burns all night at the end of your dock.”",
  },
]

interface Thread { id: number; segId: number; side: "en" | "ko"; quote: string; body: string; replies: { claude: boolean; body: string }[]; resolved: boolean }
const THREADS: Thread[] = [
  {
    id: 1, segId: 3, side: "ko", quote: "모든 판단을 유보하는", body: "앞 문장의 reserved와 이어지는 말장난을 살릴 방법?", resolved: false,
    replies: [{ claude: true, body: "“섣불리 판단하지 않는”이면 앞의 “말을 아끼면서도”와 결이 이어집니다." }],
  },
  { id: 2, segId: 2, side: "en", quote: "advantages", body: "“좋은 조건” vs “혜택” — 편집자와 확인", resolved: false, replies: [] },
]

interface Footnote { id: number; segId: number; label: string; translator: boolean; after: string; source?: string; body: string }
const FOOTNOTES: Footnote[] = [
  { id: 1, segId: 4, label: "1", translator: true, after: "정치꾼", body: "politician: 여기서는 남의 비밀을 다 들어 주는 사람을 비꼬는 말." },
]

interface Term { term: string; kind: "person" | "place" | "org" | "work" | "other"; translation: string; aliases: string; mentions: number; first: number | null }
const KINDS: Term["kind"][] = ["person", "place", "org", "work", "other"]
const TERMS: Term[] = [
  { term: "Gatsby", kind: "person", translation: "개츠비", aliases: "", mentions: 262, first: 8 },
  { term: "Nick Carraway", kind: "person", translation: "닉 캐러웨이", aliases: "Nick, Carraway", mentions: 41, first: null },
  { term: "Daisy Buchanan", kind: "person", translation: "데이지 뷰캐넌", aliases: "Daisy", mentions: 188, first: null },
  { term: "West Egg", kind: "place", translation: "웨스트에그", aliases: "", mentions: 18, first: 5 },
  { term: "East Egg", kind: "place", translation: "", aliases: "", mentions: 9, first: null },
  { term: "Middle West", kind: "place", translation: "", aliases: "Middle Western", mentions: 4, first: 6 },
  { term: "Yale", kind: "org", translation: "예일", aliases: "New Haven", mentions: 6, first: null },
  { term: "The Saturday Evening Post", kind: "work", translation: "", aliases: "", mentions: 1, first: null },
]

const UNLINKED = [
  { id: 1, page: 12, quote: "the ragged edge", body: "Fitzgerald returns to this image in the last chapter." },
  { id: 2, page: 14, quote: "Teutonic migration", body: "The narrator's ironic name for the First World War." },
]

const now = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

/** Each mark wraps the first place its quote occurs, in the order they occur. */
type Mark = { quote: string; wrap: (quote: string) => ReactNode }
function marked(text: string, marks: Mark[]): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let left = marks.filter((m) => m.quote && text.includes(m.quote))
  for (let key = 0; ; key++) {
    let best: { at: number; m: Mark } | null = null
    for (const m of left) {
      const at = rest.indexOf(m.quote)
      if (at >= 0 && (!best || at < best.at)) best = { at, m }
    }
    if (!best) break
    const { at, m } = best
    out.push(rest.slice(0, at), <Fragment key={key}>{m.wrap(m.quote)}</Fragment>)
    rest = rest.slice(at + m.quote.length)
    left = left.filter((x) => x !== m)
  }
  out.push(rest)
  return out
}

export function ShellGallery() {
  // the sidebar keeps its state in the cookie the editor reads; give the editor its own back when leaving
  useEffect(() => {
    const saved = document.cookie.match(/(?:^|; )sidebar_state=([^;]*)/)?.[1]
    const restore = () => { document.cookie = saved ? `sidebar_state=${saved}; path=/; max-age=604800` : "sidebar_state=; path=/; max-age=0" }
    window.addEventListener("pagehide", restore)
    return () => { window.removeEventListener("pagehide", restore); restore() }
  }, [])
  return (
    <SidebarProvider style={{ "--sidebar-width": "17rem" } as CSSProperties}>
      <Shell />
    </SidebarProvider>
  )
}

function Shell() {
  const sidebar = useSidebar()
  const [stage, setStage] = useState<Stage>("translate")
  const [lastChapterStage, setLastChapterStage] = useState<ChapterStage>("translate")
  const [chapterId, setChapterId] = useState(1)
  const [segs, setSegs] = useState(SEGS)
  const [selected, setSelected] = useState<number | null>(3)
  const [query, setQuery] = useState("")
  const [claudeOpen, setClaudeOpen] = useState(true)
  const [scale, setScale] = useState<Scale>(FIRST_SCALE)
  const [threads, setThreads] = useState(THREADS)
  const [openThread, setOpenThread] = useState<number | null>(null)
  const [footnotes, setFootnotes] = useState(FOOTNOTES)
  const [terms, setTerms] = useState(TERMS)
  const [unlinked, setUnlinked] = useState(UNLINKED)
  const findRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const go = (s: Stage) => { setStage(s); if (isChapterStage(s)) setLastChapterStage(s) }
  const openChapter = (id: number, segId: number | null = null) => {
    if (!isChapterStage(stage)) setStage(lastChapterStage)
    setChapterId(id)
    setSelected(segId)
  }
  // folded to icons, the box is not shown until the sidebar has opened
  const focusFind = () => {
    if (sidebar.open) findRef.current?.select()
    else { sidebar.setOpen(true); requestAnimationFrame(() => findRef.current?.select()) }
  }
  const openClaude = () => { setClaudeOpen(true); requestAnimationFrame(() => composerRef.current?.focus()) }
  const saveTerm = (term: string, patch: Partial<Term>) => setTerms((ts) => ts.map((t) => (t.term === term ? { ...t, ...patch } : t)))
  const replaceAll = (q: string, r: string) => {
    const at = now()
    setSegs((ss) => ss.map((s) => {
      if (!s.en.includes(q)) return s
      const after = s.en.split(q).join(r)
      return { ...s, en: after, ops: [{ at, label: `Replace all “${q}” → “${r}”`, before: s.en, after }, ...s.ops] }
    }))
  }

  // ⌘F: the find box in the sidebar (opened if folded); ⌘L: Claude's box
  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return
    const k = e.key.toLowerCase()
    if (k === "f") { e.preventDefault(); focusFind() }
    if (k === "l" && isChapterStage(stage)) { e.preventDefault(); openClaude() }
  })
  useEffect(() => {
    window.addEventListener("keydown", onShortcut)
    return () => window.removeEventListener("keydown", onShortcut)
  }, [])

  const chapter = CHAPTERS.find((c) => c.id === chapterId)!
  const done = (c: Chapter, kind: "verified" | "confirmed") => c.other[kind] + segs.filter((s) => s.chapterId === c.id && s[kind]).length
  const chapterSegs = segs.filter((s) => s.chapterId === chapterId)
  const chapterThreads = threads.filter((t) => chapterSegs.some((s) => s.id === t.segId))
  const openSuggestions = 2

  return (
    <>
      <AppSidebar
        stage={stage} onStage={go} chapterId={chapterId} onChapter={(id) => openChapter(id)} done={done}
        query={query} onQuery={setQuery} findRef={findRef} onFocusFind={focusFind}
        segs={segs} selected={selected} onJump={(s) => openChapter(s.chapterId, s.id)} onReplaceAll={replaceAll}
        pendingTerms={terms.filter((t) => !t.translation).length}
      />
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="-ml-1" title="Toggle sidebar (⌘B)" />
          <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
          <Breadcrumb>
            <BreadcrumbList>
              {isChapterStage(stage) ? (
                <>
                  <BreadcrumbItem>{stage === "review" ? "Review" : "Translate"}</BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    {/* the chapters, also when the sidebar is folded to icons */}
                    <DropdownMenu>
                      <DropdownMenuTrigger className="flex items-center gap-1 font-normal text-foreground outline-none">
                        {chapter.title}<IconChevronDown className="size-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48">
                        {CHAPTERS.map((c) => (
                          <DropdownMenuItem key={c.id} onClick={() => openChapter(c.id)}>
                            {c.title}<span className="ml-auto text-muted-foreground tabular-nums">{done(c, stage === "review" ? "verified" : "confirmed")}/{c.total}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </BreadcrumbItem>
                </>
              ) : (
                <BreadcrumbItem><BreadcrumbPage>{stage === "export" ? "Export" : "Glossary"}</BreadcrumbPage></BreadcrumbItem>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-1">
            {isChapterStage(stage) && <ScalePicker scale={scale} onScale={setScale} />}
            <Guide />
            {isChapterStage(stage) && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button size="icon-sm" variant={claudeOpen ? "secondary" : "ghost"} aria-label="Claude" aria-pressed={claudeOpen} className="relative"
                      onClick={() => setClaudeOpen((o) => !o)} />
                  }
                >
                  <IconSparkles />
                  {!claudeOpen && openSuggestions > 0 && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" aria-label="Claude has suggestions" />}
                </TooltipTrigger>
                <TooltipContent side="bottom">Claude <span className="opacity-60">⌘L</span></TooltipContent>
              </Tooltip>
            )}
          </div>
        </header>

        {stage === "glossary" ? (
          <GlossaryPage terms={terms} onSave={saveTerm} onJump={(id) => { const s = segs.find((x) => x.id === id); if (s) openChapter(s.chapterId, s.id) }} />
        ) : stage === "export" ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="max-w-md rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Export 화면은 지금과 같습니다. 내보낼 장은 이 화면의 체크박스로 고르므로, 사이드바의 장 목록은 숨깁니다.
            </p>
          </div>
        ) : (
          <ResizablePanelGroup key={`${stage}-${claudeOpen}`} orientation="horizontal" className="min-h-0 flex-1">
            {stage === "review" && (
              <>
                <ResizablePanel id="scan" defaultSize="36" minSize={220}><Scan page={chapterSegs.find((s) => s.id === selected)?.page ?? chapterSegs[0]?.page} /></ResizablePanel>
                <ResizableHandle />
              </>
            )}
            <ResizablePanel id="main" minSize={320}>
              <ChapterView
                stage={stage} segs={chapterSegs} selected={selected} onSelect={setSelected}
                onToggle={(id, kind) => setSegs((ss) => ss.map((s) => (s.id === id ? { ...s, [kind]: !s[kind] } : s)))}
                threads={threads} openThread={openThread} onOpenThread={setOpenThread}
                onThread={(id, patch) => setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))}
                onDeleteThread={(id) => { setThreads((ts) => ts.filter((t) => t.id !== id)); setOpenThread(null) }}
                footnotes={footnotes} onFootnote={(id, body) => setFootnotes((fs) => fs.map((f) => (f.id === id ? { ...f, body } : f)))}
                terms={terms} onSaveTerm={saveTerm} onOpenGlossary={() => go("glossary")}
              />
            </ResizablePanel>
            {claudeOpen && (
              <>
                <ResizableHandle />
                <ResizablePanel id="claude" defaultSize={stage === "review" ? "26" : "30"} minSize={260}>
                  <ClaudePanel composerRef={composerRef} scale={scale} />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        )}

        <footer className="flex h-7 shrink-0 items-center gap-4 border-t px-3 text-xs text-muted-foreground tabular-nums">
          {isChapterStage(stage) ? (
            <>
              <span>{chapter.title}</span>
              <span>{stage === "review" ? "Verified" : "Confirmed"} {done(chapter, stage === "review" ? "verified" : "confirmed")} / {chapter.total}</span>
              <CommentsButton threads={chapterThreads} segs={chapterSegs} onOpen={(t) => {
                if (t.side === "ko" && stage !== "translate") go("translate")
                setSelected(t.segId)
                setOpenThread(t.id)
              }} />
              <UnlinkedButton notes={unlinked} onLink={(id) => setUnlinked((ns) => ns.filter((n) => n.id !== id))} />
            </>
          ) : (
            <span>{stage === "export" ? "Export" : `Glossary · ${terms.length} terms`}</span>
          )}
          <span className="ml-auto">Saved</span>
        </footer>
      </SidebarInset>
    </>
  )
}

/** sidebar-07: the book, the stages, then the chapters — or, while finding, what was found. Glossary at the foot. */
function AppSidebar({
  stage, onStage, chapterId, onChapter, done, query, onQuery, findRef, onFocusFind, segs, selected, onJump, onReplaceAll, pendingTerms,
}: {
  stage: Stage; onStage: (s: Stage) => void; chapterId: number; onChapter: (id: number) => void
  done: (c: Chapter, kind: "verified" | "confirmed") => number
  query: string; onQuery: (q: string) => void; findRef: Ref<HTMLInputElement>; onFocusFind: () => void
  segs: Seg[]; selected: number | null; onJump: (s: Seg) => void; onReplaceAll: (q: string, r: string) => void; pendingTerms: number
}) {
  const totals = (kind: "verified" | "confirmed") => {
    const all = CHAPTERS.reduce((n, c) => n + c.total, 0)
    return Math.round((CHAPTERS.reduce((n, c) => n + done(c, kind), 0) / all) * 100)
  }
  const progressKind = stage === "review" ? "verified" : "confirmed"
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<div />} className="hover:bg-transparent active:bg-transparent">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"><IconBook className="size-4" /></div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">The Great Gatsby</span>
                <span className="truncate text-xs text-muted-foreground">F. Scott Fitzgerald · 9 chapters</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="relative group-data-[collapsible=icon]:hidden">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50" />
          <SidebarInput ref={findRef} value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Find in book" aria-label="Find in book"
            className="pr-9 pl-8" onKeyDown={(e) => { if (e.key === "Escape") { onQuery(""); e.currentTarget.blur() } }} />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground">⌘F</kbd>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {/* folded to icons, the find box is gone: this brings it back */}
            <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
              <SidebarMenuButton tooltip="Find in book ⌘F" onClick={onFocusFind}><IconSearch /><span>Find</span></SidebarMenuButton>
            </SidebarMenuItem>
            {STAGES.map((s) => (
              <SidebarMenuItem key={s.value}>
                <SidebarMenuButton isActive={stage === s.value} tooltip={s.label} onClick={() => onStage(s.value)}>
                  <s.icon /><span>{s.label}</span>
                </SidebarMenuButton>
                {s.value !== "export" && <SidebarMenuBadge>{totals(s.value === "review" ? "verified" : "confirmed")}%</SidebarMenuBadge>}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {query ? (
          <FindResults query={query} segs={segs} selected={selected} onJump={onJump} onReplaceAll={onReplaceAll} />
        ) : isChapterStage(stage) && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Chapters</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0">
                {CHAPTERS.map((c) => {
                  const n = done(c, progressKind)
                  return (
                    <SidebarMenuItem key={c.id}>
                      <SidebarMenuButton isActive={c.id === chapterId} onClick={() => onChapter(c.id)} className="h-auto flex-col items-stretch gap-1 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{c.title}</span>
                          <span className="shrink-0 text-muted-foreground tabular-nums">{n}/{c.total}</span>
                        </div>
                        <Progress value={Math.round((n / c.total) * 100)} aria-label={`${c.title} progress`} />
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup className="mt-auto">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={stage === "glossary"} tooltip="Glossary" onClick={() => onStage("glossary")}>
                <IconBook2 /><span>Glossary</span>
              </SidebarMenuButton>
              {pendingTerms > 0 && <SidebarMenuBadge title="Terms without a translation">{pendingTerms}</SidebarMenuBadge>}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

/** What was found replaces the chapters until the box is emptied (Esc), as VS Code's search view. */
function FindResults({ query, segs, selected, onJump, onReplaceAll }: {
  query: string; segs: Seg[]; selected: number | null; onJump: (s: Seg) => void; onReplaceAll: (q: string, r: string) => void
}) {
  const [replacement, setReplacement] = useState("")
  const hits = segs.filter((s) => s.en.includes(query)).map((s) => ({ seg: s, count: s.en.split(query).length - 1 }))
  const total = hits.reduce((n, h) => n + h.count, 0)
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="tabular-nums" role="status">{hits.length ? `${total} matches · ${hits.length} paragraphs` : "No matches"}</SidebarGroupLabel>
      <div className="flex gap-1 pb-2">
        <SidebarInput value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Replace with" aria-label="Replace with" />
        <Button size="sm" variant="outline" className="h-8" disabled={!hits.length} onClick={() => onReplaceAll(query, replacement)}>Replace all</Button>
      </div>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          {hits.map(({ seg, count }) => {
            const at = seg.en.indexOf(query)
            const before = seg.en.slice(Math.max(0, at - 36), at)
            const after = seg.en.slice(at + query.length, at + query.length + 60)
            return (
              <SidebarMenuItem key={seg.id}>
                <SidebarMenuButton isActive={seg.id === selected} onClick={() => onJump(seg)} className="h-auto flex-col items-stretch gap-0.5 py-1.5">
                  <div className="flex gap-2 text-muted-foreground">
                    <span className="truncate">{CHAPTERS.find((c) => c.id === seg.chapterId)?.title} · ¶{seg.n}</span>
                    <span className="ml-auto shrink-0 tabular-nums">p. {seg.page}{count > 1 ? ` · ${count}×` : ""}</span>
                  </div>
                  <p className="reading line-clamp-2 text-[13px] font-normal" lang="en">
                    …{before}<mark className="rounded-sm bg-mark-warning/70 text-inherit">{query}</mark>{after}…
                  </p>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** The chapter's paragraphs: the source alone while reviewing, source and translation while translating. Everything a
 *  paragraph carries — comments, notes, glossary terms, history — opens from the paragraph itself. */
function ChapterView({
  stage, segs, selected, onSelect, onToggle, threads, openThread, onOpenThread, onThread, onDeleteThread, footnotes, onFootnote, terms, onSaveTerm, onOpenGlossary,
}: {
  stage: ChapterStage; segs: Seg[]; selected: number | null; onSelect: (id: number) => void; onToggle: (id: number, kind: "verified" | "confirmed") => void
  threads: Thread[]; openThread: number | null; onOpenThread: (id: number | null) => void
  onThread: (id: number, patch: Partial<Thread>) => void; onDeleteThread: (id: number) => void
  footnotes: Footnote[]; onFootnote: (id: number, body: string) => void
  terms: Term[]; onSaveTerm: (term: string, patch: Partial<Term>) => void; onOpenGlossary: () => void
}) {
  useEffect(() => {
    if (selected !== null) document.querySelector(`[data-seg="${selected}"]`)?.scrollIntoView({ block: "nearest" })
  }, [selected])
  if (!segs.length) return <p className="p-6 text-sm text-muted-foreground">이 장은 목업에 본문이 없습니다. Chapter I을 보세요 (찾기 결과로 III·V의 문단에도 갈 수 있습니다).</p>

  const threadMarks = (s: Seg, side: "en" | "ko"): Mark[] => threads.filter((t) => t.segId === s.id && t.side === side).map((t) => ({
    quote: t.quote,
    wrap: (q) => (
      <Popover open={openThread === t.id} onOpenChange={(o) => onOpenThread(o ? t.id : null)}>
        <PopoverTrigger nativeButton={false} render={<mark className={cn("cursor-pointer rounded-sm box-decoration-clone text-inherit", t.resolved ? "bg-transparent underline decoration-mark-comment decoration-2" : "bg-mark-comment/70")} />}>
          {q}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 gap-0 p-0">
          <ThreadCard thread={t} onChange={(patch) => onThread(t.id, patch)} onDelete={() => onDeleteThread(t.id)} />
        </PopoverContent>
      </Popover>
    ),
  }))
  const termMarks: Mark[] = terms.map((t) => ({ quote: t.term, wrap: (q) => <TermMark term={t} onSave={onSaveTerm} onOpenGlossary={onOpenGlossary}>{q}</TermMark> }))
  const noteMarks = (s: Seg): Mark[] => footnotes.filter((f) => f.segId === s.id).map((f) => ({
    quote: f.after,
    wrap: (q) => <>{q}<sup className="border-b-2 border-mark-note bg-mark-note/40 px-0.5 text-[11px] font-medium text-mark-note-ink">{f.label}</sup></>,
  }))

  return (
    <div className="h-full overflow-auto">
      <div className={cn("mx-auto space-y-2 p-4", stage === "review" ? "max-w-2xl" : "max-w-5xl")}>
        {segs.map((s) => {
          const kind = stage === "review" ? "verified" : "confirmed"
          const fns = footnotes.filter((f) => f.segId === s.id)
          return (
            <div key={s.id} data-seg={s.id} onClick={() => onSelect(s.id)}
              className={cn("rounded-md border border-transparent px-3 py-2", s.id === selected && "border-border bg-muted/40")}>
              <div className="mb-1 flex h-6 items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox checked={s[kind]} onCheckedChange={() => onToggle(s.id, kind)} aria-label={stage === "review" ? "Verified" : "Confirmed"} onClick={(e) => e.stopPropagation()} />
                <span>{stage === "review" ? "Verified" : "Confirmed"}</span>
                <span className="tabular-nums">¶{s.n} · p. {s.page}</span>
                <span className="ml-auto"><HistoryDot seg={s} /></span>
              </div>
              {stage === "review" ? (
                <p className="reading text-[15px]" lang="en">{marked(s.en, [...termMarks, ...threadMarks(s, "en")])}</p>
              ) : (
                <div className="grid grid-cols-2 gap-6">
                  <p className="reading text-[15px] text-muted-foreground" lang="en">{marked(s.en, [...termMarks, ...threadMarks(s, "en")])}</p>
                  <div>
                    {s.ko ? (
                      <p className="reading text-[15px]" lang="ko">{marked(s.ko, [...threadMarks(s, "ko"), ...noteMarks(s)])}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not translated yet</p>
                    )}
                    {fns.length > 0 && (
                      // the notes are the translation's footnotes: they sit under the paragraph they belong to
                      <div className="mt-2 space-y-1.5 border-t border-dashed pt-2">
                        {fns.map((f) => <FootnoteRow key={f.id} note={f} onSave={(body) => onFootnote(f.id, body)} />)}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The edited dot, as now on hover (what changed since the OCR); clicked, the paragraph's history as the History tab had it. */
function HistoryDot({ seg }: { seg: Seg }) {
  if (seg.ocr === seg.en) return null
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger render={<button type="button" aria-label="History of this paragraph" className="flex size-5 items-center justify-center rounded hover:bg-muted" onClick={(e) => e.stopPropagation()} />} />
          }
        >
          <span className="block size-2 rounded-full border border-muted-foreground/50 bg-background" />
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-sm px-2.5 py-1.5">
          <div>
            <div className="mb-1 text-[11px] opacity-70">Edited — original OCR · click for history</div>
            <DiffView before={seg.ocr} after={seg.en} className="text-[13px]" />
          </div>
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="left" align="start" className="w-96 gap-0 p-0">
        <div className="border-b px-3 py-2">
          <div className="mb-1 text-xs font-medium">Now vs. original</div>
          <DiffView before={seg.ocr} after={seg.en} className="text-[13px]" />
        </div>
        <ul className="max-h-72 divide-y overflow-auto text-xs" aria-label="History of this paragraph">
          {seg.ops.map((o, i) => (
            <li key={i} className={o.undone ? "text-muted-foreground" : ""}>
              {o.before !== undefined && o.after !== undefined ? (
                <Collapsible>
                  <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50">
                    <IconChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
                    <span className="tabular-nums">{o.at}</span><span className="truncate">{o.label}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-3 pb-2 pl-8"><DiffView before={o.before} after={o.after} /></CollapsibleContent>
                </Collapsible>
              ) : (
                <div className="flex gap-2 px-3 py-2 pl-8"><span className="tabular-nums">{o.at}</span><span>{o.label}</span></div>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/** A comment opened where it was made: the thread, reply, resolve, delete. */
function ThreadCard({ thread: t, onChange, onDelete }: { thread: Thread; onChange: (patch: Partial<Thread>) => void; onDelete: () => void }) {
  const [reply, setReply] = useState("")
  return (
    <div className="space-y-2 p-3 text-xs">
      <div className="flex items-center gap-2">
        <IconMessage className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-muted-foreground" lang={t.side}>“{t.quote}”</span>
        <span className="ml-auto flex shrink-0">
          <Button size="icon-xs" variant="ghost" aria-label={t.resolved ? "Reopen" : "Resolve"} onClick={() => onChange({ resolved: !t.resolved })}>
            <IconCheck className={cn(t.resolved && "text-mark-term-ink")} />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Delete comment" onClick={onDelete}><IconTrash /></Button>
        </span>
      </div>
      <p className={cn("text-[13px]", t.resolved && "line-through")}>{t.body}</p>
      {t.replies.map((r, i) => (
        <p key={i} className="border-l-2 pl-2 text-muted-foreground">
          {r.claude && <Badge variant="secondary" className="mr-1">Claude</Badge>}{r.body}
        </p>
      ))}
      {!t.resolved && (
        <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" aria-label="Reply" rows={1} className="min-h-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && reply.trim()) { e.preventDefault(); onChange({ replies: [...t.replies, { claude: false, body: reply.trim() }] }); setReply("") }
          }} />
      )}
    </div>
  )
}

/** A glossary term in the source: hover shows the agreed translation (as now); click to set it without leaving the text. */
function TermMark({ term: t, onSave, onOpenGlossary, children }: { term: Term; onSave: (term: string, patch: Partial<Term>) => void; onOpenGlossary: () => void; children: ReactNode }) {
  const agreed = t.translation.trim().length > 0
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger nativeButton={false} render={
              <mark data-term={t.term} onClick={(e) => e.stopPropagation()} className={cn(
                "cursor-pointer border-b-2 bg-transparent box-decoration-clone text-inherit transition-colors",
                agreed ? "border-mark-term hover:bg-mark-term/40" : "border-dotted border-muted-foreground/50 hover:bg-muted",
              )} />
            } />
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipContent side="top">{agreed ? <span>{t.term} → <b>{t.translation}</b></span> : `${t.term} · no translation yet`}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-72">
        <TermEditor term={t} onSave={onSave} onOpenGlossary={onOpenGlossary} />
      </PopoverContent>
    </Popover>
  )
}

function TermEditor({ term: t, onSave, onOpenGlossary }: { term: Term; onSave: (term: string, patch: Partial<Term>) => void; onOpenGlossary: () => void }) {
  const [translation, setTranslation] = useState(t.translation)
  const [aliases, setAliases] = useState(t.aliases)
  const save = () => { if (translation !== t.translation || aliases !== t.aliases) onSave(t.term, { translation: translation.trim(), aliases: aliases.trim() }) }
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur() }
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="reading text-[13px] font-medium" lang="en">{t.term}</span>
        <Badge variant="outline">{t.kind}</Badge>
        <span className="ml-auto text-muted-foreground tabular-nums">{t.mentions}×</span>
      </div>
      <Input lang="ko" value={translation} placeholder="Translation" aria-label={`Translation of ${t.term}`} onChange={(e) => setTranslation(e.target.value)} onBlur={save} onKeyDown={enter} />
      <Input lang="ko" value={aliases} placeholder="Aliases, comma-separated" aria-label={`Aliases of ${t.term}`} onChange={(e) => setAliases(e.target.value)} onBlur={save} onKeyDown={enter} />
      <Button size="xs" variant="link" className="px-0" onClick={onOpenGlossary}>Open Glossary →</Button>
    </div>
  )
}

/** A footnote of the translation, edited where it belongs (blur saves). */
function FootnoteRow({ note: f, onSave }: { note: Footnote; onSave: (body: string) => void }) {
  const [body, setBody] = useState(f.body)
  return (
    <div className="flex items-start gap-1.5 text-xs" onClick={(e) => e.stopPropagation()}>
      <sup className="mt-1.5 border-b-2 border-mark-note bg-mark-note/40 px-0.5 text-[11px] font-medium text-mark-note-ink">{f.label}</sup>
      <div className="min-w-0 flex-1">
        <div className="text-muted-foreground">{f.translator ? "Translator's note" : "Author's note"}</div>
        {f.source && <p className="reading text-[13px] text-muted-foreground" lang="en">{f.source}</p>}
        <Textarea value={body} lang="ko" rows={1} aria-label="Note body" onChange={(e) => setBody(e.target.value)} onBlur={() => body.trim() && body !== f.body && onSave(body.trim())}
          className="min-h-0 resize-none border-transparent bg-transparent px-1 py-0.5 text-xs shadow-none hover:border-input dark:bg-transparent" />
      </div>
    </div>
  )
}

/** The status bar's count of open comments opens their list; picking one opens it in the text. */
function CommentsButton({ threads, segs, onOpen }: { threads: Thread[]; segs: Seg[]; onOpen: (t: Thread) => void }) {
  const [open, setOpen] = useState(false)
  const unresolved = threads.filter((t) => !t.resolved)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<button type="button" className="hover:text-foreground" />}>Comments {unresolved.length} open</PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 gap-0 p-0">
        <div className="border-b px-3 py-2 text-xs font-medium">Open comments in this chapter</div>
        {unresolved.length === 0 ? <p className="p-3 text-xs text-muted-foreground">None open.</p> : (
          <ul className="max-h-72 divide-y overflow-auto text-xs">
            {unresolved.map((t) => (
              <li key={t.id}>
                <button type="button" className="w-full space-y-0.5 px-3 py-2 text-left hover:bg-muted/50" onClick={() => { setOpen(false); onOpen(t) }}>
                  <div className="flex gap-2 text-muted-foreground"><span>¶{segs.find((s) => s.id === t.segId)?.n}</span><span className="truncate" lang={t.side}>“{t.quote}”</span></div>
                  <p className="truncate">{t.body}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** The book's author notes the pipeline could not place, from the status bar. Link opens the paragraph picker (as now). */
function UnlinkedButton({ notes, onLink }: { notes: typeof UNLINKED; onLink: (id: number) => void }) {
  return (
    <Popover>
      <PopoverTrigger render={<button type="button" className="hover:text-foreground" />}>Unlinked notes {notes.length}</PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 gap-0 p-0">
        <div className="border-b px-3 py-2 text-xs font-medium">Author's notes not placed in the text</div>
        {notes.length === 0 ? <p className="p-3 text-xs text-muted-foreground">All notes are linked to the text.</p> : (
          <ul className="max-h-72 divide-y overflow-auto text-xs">
            {notes.map((n) => (
              <li key={n.id} className="space-y-1 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground tabular-nums">p. {n.page}</span>
                  <Button size="xs" variant="outline" className="ml-auto" onClick={() => onLink(n.id)} title="Opens the paragraph picker, as now">Link…</Button>
                </div>
                <p className="reading text-[13px] font-medium" lang="en">“{n.quote}”</p>
                <p className="reading text-[13px] text-muted-foreground" lang="en">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** The glossary as a page: a table to go through, untranslated first, edited in place (blur saves). */
function GlossaryPage({ terms, onSave, onJump }: { terms: Term[]; onSave: (term: string, patch: Partial<Term>) => void; onJump: (segId: number) => void }) {
  const [filter, setFilter] = useState("")
  const [onlyPending, setOnlyPending] = useState(false)
  const pending = terms.filter((t) => !t.translation).length
  const rows = terms
    .filter((t) => (!onlyPending || !t.translation) && `${t.term} ${t.translation} ${t.aliases}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => Number(!!a.translation) - Number(!!b.translation) || a.term.localeCompare(b.term))
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter terms" aria-label="Filter terms" className="h-8 w-64" />
        <Button size="sm" variant={onlyPending ? "secondary" : "outline"} aria-pressed={onlyPending} onClick={() => setOnlyPending(!onlyPending)}>
          Without translation <Badge variant="secondary">{pending}</Badge>
        </Button>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{terms.length} terms</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">Term</TableHead>
              <TableHead className="w-28">Kind</TableHead>
              <TableHead>Translation</TableHead>
              <TableHead>Aliases</TableHead>
              <TableHead className="w-24 text-right">Mentions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => <GlossaryRow key={t.term} term={t} onSave={onSave} onJump={onJump} />)}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function GlossaryRow({ term: t, onSave, onJump }: { term: Term; onSave: (term: string, patch: Partial<Term>) => void; onJump: (segId: number) => void }) {
  const [translation, setTranslation] = useState(t.translation)
  const [aliases, setAliases] = useState(t.aliases)
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur() }
  const cell = "h-8 border-transparent bg-transparent shadow-none hover:border-input dark:bg-transparent"
  return (
    <TableRow data-glossary-term={t.term}>
      <TableCell>
        <button type="button" className="reading text-[14px] font-medium hover:underline disabled:no-underline" lang="en" disabled={t.first === null}
          onClick={() => t.first !== null && onJump(t.first)} title={t.first !== null ? "Jump to first mention" : "No mention in the mockup's text"}>
          {t.term}
        </button>
      </TableCell>
      <TableCell>
        <Select value={t.kind} onValueChange={(v) => v && onSave(t.term, { kind: v as Term["kind"] })}>
          <SelectTrigger size="sm" aria-label="Kind" className="h-7 border-transparent px-1 text-muted-foreground"><SelectValue>{t.kind}</SelectValue></SelectTrigger>
          <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input lang="ko" value={translation} placeholder="Translation" aria-label={`Translation of ${t.term}`} className={cell}
          onChange={(e) => setTranslation(e.target.value)} onBlur={() => translation !== t.translation && onSave(t.term, { translation: translation.trim() })} onKeyDown={enter} />
      </TableCell>
      <TableCell>
        <Input lang="ko" value={aliases} placeholder="Aliases" aria-label={`Aliases of ${t.term}`} className={cell}
          onChange={(e) => setAliases(e.target.value)} onBlur={() => aliases !== t.aliases && onSave(t.term, { aliases: aliases.trim() })} onKeyDown={enter} />
      </TableCell>
      <TableCell className="text-right text-muted-foreground tabular-nums">{t.mentions}</TableCell>
    </TableRow>
  )
}

function Scan({ page }: { page: number | undefined }) {
  return (
    <div className="flex h-full flex-col bg-muted/40">
      <div className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">Scan · p. {page ?? "—"}</div>
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        <div className="mx-auto aspect-[2/3] w-full max-w-sm space-y-2 rounded-sm bg-background p-6 shadow-sm">
          {Array.from({ length: 22 }, (_, i) => <div key={i} className={cn("h-2 rounded-full bg-muted", i % 6 === 5 ? "w-2/3" : "w-full")} />)}
        </div>
      </div>
    </div>
  )
}

/** The Claude panel's type to compare. B is what the editor's panel has now (the reading 14px, the controls 12px, buttons
 *  24px); A reads smaller; C makes the controls larger too. */
const SCALES = {
  a: { name: "A · 13 / 12", read: "text-[13px]/relaxed md:text-[13px]/relaxed", ui: "text-xs/relaxed", button: "sm", buttonText: "" },
  b: { name: "B · 14 / 12", read: "text-sm/relaxed md:text-sm/relaxed", ui: "text-xs/relaxed", button: "sm", buttonText: "" },
  c: { name: "C · 14 / 13", read: "text-sm/relaxed md:text-sm/relaxed", ui: "text-[13px]/relaxed", button: "default", buttonText: "text-[13px]" },
} as const
type Scale = keyof typeof SCALES
const scaleParam = new URLSearchParams(location.search).get("scale")
const FIRST_SCALE: Scale = scaleParam === "a" || scaleParam === "c" ? scaleParam : "b"

function ScalePicker({ scale, onScale }: { scale: Scale; onScale: (s: Scale) => void }) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <span>Claude 글자</span>
      <div className="flex gap-0.5 rounded-md border p-0.5">
        {(Object.keys(SCALES) as Scale[]).map((k) => (
          <Button key={k} size="xs" variant={scale === k ? "secondary" : "ghost"} aria-pressed={scale === k} onClick={() => onScale(k)}>{SCALES[k].name}</Button>
        ))}
      </div>
    </div>
  )
}

/** The right panel is Claude's alone: no tab row, its head is the conversation and this chapter's suggestions (as now).
 *  Laid out as the editor's panel is (features/agent, features/suggestions), in the type picked above. */
function ClaudePanel({ composerRef, scale }: { composerRef: Ref<HTMLTextAreaElement>; scale: Scale }) {
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const t = SCALES[scale]
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Collapsible open={suggestionsOpen} onOpenChange={setSuggestionsOpen} className="shrink-0 border-b">
        <div className="flex h-9 items-center gap-1 px-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size={t.button} variant="ghost" className={cn("min-w-0 shrink justify-start", t.buttonText)} />}>
              <span className="truncate">¶3 reserve 말장난</span><IconChevronDown data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuItem><IconPlus />New conversation</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Recent</DropdownMenuLabel>
                <DropdownMenuItem>¶3 reserve 말장난<span className="ml-auto text-muted-foreground">now</span></DropdownMenuItem>
                <DropdownMenuItem>West Egg 표기<span className="ml-auto text-muted-foreground">2h</span></DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size={t.button} variant={suggestionsOpen ? "secondary" : "ghost"} className={cn("ml-auto shrink-0", t.buttonText)} aria-expanded={suggestionsOpen} onClick={() => setSuggestionsOpen(!suggestionsOpen)}>
            Suggestions <Badge variant="secondary">2</Badge>
          </Button>
        </div>
        <CollapsibleContent className="max-h-72 overflow-auto border-t">
          {[
            ["¶3", "모든 판단을 유보하는", "섣불리 판단하지 않는", "앞 문장의 ‘말을 아끼면서도’와 같은 낱말(reserve)로 이어지게 했습니다."],
            ["¶3", "말을 아끼면서도", "말수는 적어도", "‘아끼다’가 뒤의 ‘유보’와 겹쳐 읽힙니다."],
          ].map(([p, q, r, why]) => (
            <div key={q} className={cn("space-y-1.5 border-b px-3 py-2 last:border-b-0", t.read)}>
              <div className={cn("flex items-center gap-1.5 text-muted-foreground", t.ui)}>{p}<Badge variant="secondary">medium</Badge></div>
              <p lang="ko"><span className="line-through decoration-destructive/60">{q}</span> → <span className="text-mark-term-ink">{r}</span></p>
              <p lang="ko" className={cn("text-muted-foreground", t.ui)}>{why}</p>
              <div className="flex gap-1">
                <Button size={t.button} className={t.buttonText}><IconCheck data-icon="inline-start" />Accept</Button>
                <Button size={t.button} variant="ghost" className={t.buttonText}>Dismiss</Button>
              </div>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-3">
        <Message align="end">
          <MessageContent>
            <Bubble align="end" variant="muted">
              <BubbleContent className={t.read} lang="ko">¶3의 reserved와 reserve all judgments, 말장난이야? 어떻게 살리면 좋을까?</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
        <Message>
          <MessageContent className="gap-3">
            <Trace>
              <TraceLine className={t.ui}><TraceIcon><IconBook /></TraceIcon><TraceTitle>Read ¶3 and 3 around</TraceTitle></TraceLine>
              <TraceLine className={t.ui}><TraceTitle>Thought</TraceTitle><TraceIcon><IconChevronRight /></TraceIcon></TraceLine>
            </Trace>
            <div className={cn("space-y-2", t.read)} lang="ko">
              <p>네, 말장난입니다. 앞의 <i>reserved</i>(말을 아끼는)와 뒤의 <i>reserve</i>(판단을 미루다)가 같은 낱말로 이어집니다.</p>
              <p>"유보하는"은 뜻은 맞지만 앞의 "말을 아끼면서도"와 이어지지 않습니다. "섣불리 판단하지 않는"이면 결이 맞습니다.</p>
            </div>
            <MessageFooter className={cn("gap-1 px-0 font-normal", t.ui)}>6s · $0.02</MessageFooter>
          </MessageContent>
        </Message>
      </div>
      <div className="shrink-0 p-2">
        <InputGroup>
          <InputGroupTextarea ref={composerRef} aria-label="Message" placeholder="Ask Claude about this chapter…" className={cn("min-h-14", t.read)} />
          <InputGroupAddon align="block-end" className="pt-1">
            <InputGroupButton size="sm" variant="ghost" className={cn("text-muted-foreground", t.buttonText)}>Opus 5.5 · medium<IconChevronDown data-icon="inline-end" /></InputGroupButton>
            <InputGroupButton size="icon-sm" variant="default" className="ml-auto" aria-label="Send"><IconArrowUp /></InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  )
}

/** What to try, for whoever opens the mockup. */
function Guide() {
  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" variant="ghost" className="text-muted-foreground" />}>
        <IconInfoCircle data-icon="inline-start" />목업 안내
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 text-xs leading-relaxed">
        <ul className="list-disc space-y-1.5 pl-4">
          <li><b>사이드바</b>: ⌘B나 가장자리 클릭으로 아이콘만 남김. 그때 장 목록은 숨고, 장은 머리줄의 <b>Chapter ▾</b>에서 바꿈.</li>
          <li><b>Find</b>: 사이드바 입력에 <code>tbe</code> → 장 목록 자리에 결과. 눌러서 이동, <b>Replace all</b>. Esc로 장 목록 복귀. 어디서든 ⌘F.</li>
          <li><b>Translate</b>: 노란 칠(댓글) 클릭 → 그 자리에서 스레드. 초록·점선 밑줄(용어) 클릭 → 번역을 바로 고침. ¶4 번역 아래는 각주 칸.</li>
          <li><b>History</b>: 편집된 문단 오른쪽의 빈 점. 올리면 원문과 달라진 곳(지금처럼), 누르면 기록.</li>
          <li><b>Claude</b>: 오른쪽 위 ✦로 패널 열고 닫기(⌘L). 닫혀 있을 때 제안이 있으면 점.</li>
          <li><b>Claude 글자</b>: B가 지금 에디터의 패널(읽는 글 14px · 조작 12px). A는 읽는 글 13px, C는 조작까지 13px·버튼 28px.</li>
          <li><b>상태줄</b>: Comments·Unlinked notes를 누르면 목록.</li>
          <li><b>Glossary</b>(사이드바 아래) → 전체 폭 표. <b>Export</b> → 장 목록이 숨음.</li>
        </ul>
      </PopoverContent>
    </Popover>
  )
}
