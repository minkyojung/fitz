import { useEffect, useEffectEvent, useMemo, useState, type CSSProperties } from "react"
import {
  IconAffiliate, IconArrowUp, IconBook, IconBook2, IconCards, IconChevronDown, IconChevronRight, IconDownload, IconFileExport,
  IconInfoCircle, IconLanguage, IconLayoutSidebar, IconScan, IconSearch, IconSparkles,
} from "@tabler/icons-react"
import {
  Background, BaseEdge, EdgeLabelRenderer, Handle, Position, ReactFlow, getBezierPath, type Edge, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react"
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js"
import "@xyflow/react/dist/style.css"

import { Badge } from "@/components/ui/badge"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarInset, SidebarMenu,
  SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger,
} from "@/components/ui/sidebar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"

// Design check before the reference column is built (the plan of 2026-11-01): the editor's left column, which holds the
// scan, becomes a column of tabs — Scan, Glossary, Relations — so the paragraph never leaves the screen. Glossary and
// Export stop being pages of their own: the glossary is a tab here, Export a dialog from the header. The sidebar is left
// with where to go (stages, chapters, Find, Session). The right panel stays Claude's.
// Sample text: The Great Gatsby (public domain).

type Stage = "review" | "translate" | "session"
type Reference = "scan" | "glossary" | "relations"

const STAGES = [
  { value: "review", label: "Review", icon: IconScan },
  { value: "translate", label: "Translate", icon: IconLanguage },
] as const

interface Chapter { id: number; title: string; total: number; verified: number; confirmed: number }
const CHAPTERS: Chapter[] = [
  [46, 46, 46], [38, 38, 30], [52, 52, 12], [41, 30, 0], [35, 12, 0], [44, 0, 0], [61, 0, 0], [39, 0, 0], [48, 0, 0],
].map(([total, verified, confirmed], i) => ({ id: i + 1, title: `Chapter ${["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"][i]}`, total, verified, confirmed }))

interface Seg { id: number; chapterId: number; n: number; page: number; en: string; ko: string }
const SEGS: Seg[] = [
  { id: 1, chapterId: 1, n: 1, page: 1, en: "In my younger and more vulnerable years my father gave me some advice that I've been turning over in my mind ever since.", ko: "지금보다 어리고 쉽게 상처받던 시절, 아버지가 내게 해 주신 충고가 있는데 나는 그 뒤로 줄곧 그 말을 곱씹어 왔다." },
  { id: 2, chapterId: 1, n: 2, page: 1, en: "“Whenever you feel like criticizing any one,” he told me, “just remember that all the people in this world haven't had the advantages that you've had.”", ko: "“누군가를 비판하고 싶어질 때면,” 아버지는 내게 말씀하셨다. “이 세상 모든 사람이 다 너처럼 좋은 조건을 누린 건 아니라는 걸 기억하렴.”" },
  { id: 3, chapterId: 1, n: 3, page: 2, en: "My family have been prominent, well-to-do people in this Middle Western city for three generations. I graduated from New Haven in 1915, just a quarter of a century after my father.", ko: "우리 집안은 이 중서부 도시에서 삼대째 이름난 유복한 사람들이었다. 나는 1915년에 뉴헤이븐을 졸업했는데, 아버지보다 꼭 사반세기 뒤였다." },
  { id: 4, chapterId: 1, n: 4, page: 3, en: "I lived at West Egg, the—well, the less fashionable of the two, though this is a most superficial tag to express the bizarre and not a little sinister contrast between them.", ko: "나는 웨스트에그에 살았다. 두 곳 중 덜 세련된 쪽이었는데, 이건 둘 사이의 기묘하고 꽤나 불길한 대비를 나타내기엔 아주 피상적인 이름표일 뿐이다." },
  { id: 5, chapterId: 1, n: 5, page: 3, en: "Across the courtesy bay the white palaces of fashionable East Egg glittered along the water, and the history of the summer really begins on the evening I drove over there to have dinner with the Tom Buchanans. Daisy was my second cousin once removed.", ko: "작은 만 건너편으로 세련된 이스트에그의 하얀 저택들이 물가를 따라 반짝였다. 그해 여름의 이야기는 내가 톰 뷰캐넌 부부와 저녁을 먹으러 그리로 차를 몰고 간 날 저녁에 시작된다. 데이지는 내 육촌 여동생이었다." },
  { id: 6, chapterId: 1, n: 6, page: 4, en: "Instead of being the warm centre of the world, the Middle West now seemed like the ragged edge of the universe.", ko: "" },
  { id: 7, chapterId: 3, n: 1, page: 39, en: "There was music from my neighbor's house through the summer nights. In his blue gardens men and girls came and went like moths among the whisperings and the champagne and the stars.", ko: "여름밤 내내 이웃집에서 음악이 흘러나왔다. 그의 푸른 정원에서 남자들과 여자들이 속삭임과 샴페인과 별들 사이를 나방처럼 오갔다." },
  { id: 8, chapterId: 5, n: 1, page: 81, en: "“If it wasn't for the mist we could see your home across the bay,” said Gatsby. “You always have a green light that burns all night at the end of your dock.”", ko: "“안개만 아니면 만 건너 당신 집이 보일 텐데요.” 개츠비가 말했다. “당신 집 선착장 끝에는 밤새 타오르는 초록 불빛이 있지요.”" },
]

type Kind = "person" | "place" | "org" | "work" | "other"
interface Term { term: string; kind: Kind; translation: string; aliases: string; mentions: number; first: number | null }
const KINDS: Kind[] = ["person", "place", "org", "work", "other"]
const TERMS: Term[] = [
  { term: "Gatsby", kind: "person", translation: "개츠비", aliases: "", mentions: 262, first: 8 },
  { term: "Nick Carraway", kind: "person", translation: "닉 캐러웨이", aliases: "Nick, Carraway", mentions: 41, first: null },
  { term: "Daisy Buchanan", kind: "person", translation: "데이지 뷰캐넌", aliases: "Daisy", mentions: 188, first: 5 },
  { term: "Tom Buchanan", kind: "person", translation: "톰 뷰캐넌", aliases: "Tom", mentions: 151, first: 5 },
  { term: "West Egg", kind: "place", translation: "웨스트에그", aliases: "", mentions: 18, first: 4 },
  { term: "East Egg", kind: "place", translation: "이스트에그", aliases: "", mentions: 9, first: 5 },
  { term: "Middle West", kind: "place", translation: "", aliases: "Middle Western", mentions: 4, first: 3 },
  { term: "Yale", kind: "org", translation: "예일", aliases: "New Haven", mentions: 6, first: 3 },
  { term: "The Saturday Evening Post", kind: "work", translation: "", aliases: "", mentions: 1, first: null },
]
/** The kind's colour, the one its mark in the text has. */
const KIND_CLASS: Record<Kind, string> = {
  person: "bg-mark-term text-mark-term-ink", place: "bg-mark-note text-mark-note-ink", org: "bg-mark-comment text-mark-comment-ink",
  work: "bg-mark-italic text-mark-italic-ink", other: "bg-muted text-foreground",
}

/** A relation: two glossary terms, a label, and the paragraph it rests on (docs/relations.md). */
interface Relation { id: number; from: string; to: string; label: string; segId: number }
const RELATIONS: Relation[] = [
  { id: 1, from: "Nick Carraway", to: "Middle West", label: "고향", segId: 3 },
  { id: 2, from: "Nick Carraway", to: "Yale", label: "1915년 졸업", segId: 3 },
  { id: 3, from: "Nick Carraway", to: "West Egg", label: "산다", segId: 4 },
  { id: 4, from: "Tom Buchanan", to: "East Egg", label: "산다", segId: 5 },
  { id: 5, from: "Nick Carraway", to: "Daisy Buchanan", label: "육촌 여동생", segId: 5 },
  { id: 6, from: "Tom Buchanan", to: "Daisy Buchanan", label: "부부", segId: 5 },
  { id: 7, from: "Gatsby", to: "Nick Carraway", label: "이웃", segId: 7 },
  { id: 8, from: "Gatsby", to: "Daisy Buchanan", label: "만 건너 집을 바라본다", segId: 8 },
]

export function ReferenceGallery() {
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
  const [stage, setStage] = useState<Stage>("translate")
  const [chapterId, setChapterId] = useState(1)
  const [selected, setSelected] = useState<number | null>(5)
  const [claudeOpen, setClaudeOpen] = useState(true)
  // the reference column: open on the scan while reviewing, folded while translating (as the scan is today)
  const [reference, setReference] = useState<Record<Stage, Reference | null>>({ review: "scan", translate: null, session: null })
  const [lastTab, setLastTab] = useState<Reference>("scan")
  const [exportOpen, setExportOpen] = useState(false)
  const [terms, setTerms] = useState(TERMS)
  const [relations] = useState(RELATIONS)

  const tab = reference[stage]
  const showTab = (t: Reference | null) => { setReference((r) => ({ ...r, [stage]: t })); if (t) setLastTab(t) }
  const toggleReference = () => showTab(tab ? null : lastTab)
  const openChapter = (id: number, segId: number | null = null) => { if (stage === "session") setStage("translate"); setChapterId(id); setSelected(segId) }
  const jumpTo = (segId: number) => { const s = SEGS.find((x) => x.id === segId); if (s) openChapter(s.chapterId, s.id) }

  // ⌘I: the reference column, as the scan today; ⌘L: Claude
  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || stage === "session") return
    const k = e.key.toLowerCase()
    if (k === "i") { e.preventDefault(); toggleReference() }
    if (k === "l") { e.preventDefault(); setClaudeOpen(true) }
  })
  useEffect(() => {
    window.addEventListener("keydown", onShortcut)
    return () => window.removeEventListener("keydown", onShortcut)
  }, [])

  const chapter = CHAPTERS.find((c) => c.id === chapterId)!
  const chapterSegs = SEGS.filter((s) => s.chapterId === chapterId)
  const pendingTerms = terms.filter((t) => !t.translation).length
  const inChapter = stage !== "session"

  return (
    <>
      <AppSidebar stage={stage} onStage={setStage} chapterId={chapterId} onChapter={(id) => openChapter(id)} />
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="-ml-1" title="Toggle sidebar (⌘B)" />
          <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
          {inChapter && (
            <Tooltip>
              <TooltipTrigger render={<Button size="icon-sm" variant={tab ? "secondary" : "ghost"} aria-label="Reference" aria-pressed={!!tab} className="relative" onClick={toggleReference} />}>
                <IconLayoutSidebar />
                {!tab && pendingTerms > 0 && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" aria-hidden />}
              </TooltipTrigger>
              <TooltipContent side="bottom">Scan · Glossary · Relations <Kbd>⌘I</Kbd></TooltipContent>
            </Tooltip>
          )}
          <Breadcrumb>
            <BreadcrumbList>
              {inChapter ? (
                <>
                  <BreadcrumbItem>{stage === "review" ? "Review" : "Translate"}</BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="flex items-center gap-1 font-normal text-foreground outline-none">
                        {chapter.title}<IconChevronDown className="size-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48">
                        {CHAPTERS.map((c) => (
                          <DropdownMenuItem key={c.id} onClick={() => openChapter(c.id)}>
                            {c.title}<span className="ml-auto text-muted-foreground tabular-nums">{stage === "review" ? c.verified : c.confirmed}/{c.total}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </BreadcrumbItem>
                </>
              ) : <BreadcrumbItem>Session</BreadcrumbItem>}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-1">
            <Guide />
            {/* Export is an action on the book, not a place: a dialog, as Save As */}
            <Tooltip>
              <TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Export" onClick={() => setExportOpen(true)} />}><IconFileExport /></TooltipTrigger>
              <TooltipContent side="bottom">Export…</TooltipContent>
            </Tooltip>
            {inChapter && (
              <Tooltip>
                <TooltipTrigger render={<Button size="icon-sm" variant={claudeOpen ? "secondary" : "ghost"} aria-label="Claude" aria-pressed={claudeOpen} onClick={() => setClaudeOpen((o) => !o)} />}>
                  <IconSparkles />
                </TooltipTrigger>
                <TooltipContent side="bottom">Claude <Kbd>⌘L</Kbd></TooltipContent>
              </Tooltip>
            )}
          </div>
        </header>

        {stage === "session" ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="max-w-md rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Session은 지금과 같습니다. 카드를 한 장씩 푸는 별도의 활동이라 전체 화면을 씁니다.</p>
          </div>
        ) : (
          <ResizablePanelGroup key={`${stage}-${tab ? 1 : 0}-${claudeOpen ? 1 : 0}`} orientation="horizontal" className="min-h-0 flex-1">
            {tab && (
              <>
                <ResizablePanel id="reference" defaultSize="34" minSize={260}>
                  <ReferenceColumn
                    tab={tab} onTab={showTab} page={chapterSegs.find((s) => s.id === selected)?.page ?? chapterSegs[0]?.page}
                    terms={terms} pendingTerms={pendingTerms} onSaveTerm={(term, patch) => setTerms((ts) => ts.map((t) => (t.term === term ? { ...t, ...patch } : t)))}
                    relations={relations} selected={selected} onJump={jumpTo}
                  />
                </ResizablePanel>
                <ResizableHandle />
              </>
            )}
            <ResizablePanel id="main" minSize={320}>
              <ChapterView stage={stage} segs={chapterSegs} selected={selected} onSelect={setSelected} terms={terms} relations={relations} onShowRelations={() => showTab("relations")} />
            </ResizablePanel>
            {claudeOpen && (
              <>
                <ResizableHandle />
                <ResizablePanel id="claude" defaultSize="24" minSize={240}><ClaudePanel /></ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        )}

        <footer className="flex h-7 shrink-0 items-center gap-4 border-t px-3 text-xs text-muted-foreground tabular-nums">
          {inChapter ? (
            <>
              <span>{chapter.title}</span>
              <span>{stage === "review" ? "Verified" : "Confirmed"} {stage === "review" ? chapter.verified : chapter.confirmed} / {chapter.total}</span>
            </>
          ) : <span>Session</span>}
          <span className="ml-auto">Saved</span>
        </footer>
      </SidebarInset>
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </>
  )
}

/** The sidebar is where to go, nothing else: the stages, the chapters, Find, Session. Glossary and Export are gone from it. */
function AppSidebar({ stage, onStage, chapterId, onChapter }: { stage: Stage; onStage: (s: Stage) => void; chapterId: number; onChapter: (id: number) => void }) {
  const kind = stage === "review" ? "verified" : "confirmed"
  const all = CHAPTERS.reduce((n, c) => n + c.total, 0)
  const pct = (k: "verified" | "confirmed") => Math.round((CHAPTERS.reduce((n, c) => n + c[k], 0) / all) * 100)
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
          <SidebarInput placeholder="Find in book" aria-label="Find in book" className="pr-9 pl-8" />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground">⌘F</kbd>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {STAGES.map((s) => (
              <SidebarMenuItem key={s.value}>
                <SidebarMenuButton isActive={stage === s.value} tooltip={s.label} onClick={() => onStage(s.value)}><s.icon /><span>{s.label}</span></SidebarMenuButton>
                <SidebarMenuBadge>{pct(s.value === "review" ? "verified" : "confirmed")}%</SidebarMenuBadge>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        {stage !== "session" && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Chapters</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0">
                {CHAPTERS.map((c) => (
                  <SidebarMenuItem key={c.id}>
                    <SidebarMenuButton isActive={c.id === chapterId} onClick={() => onChapter(c.id)} className="h-auto flex-col items-stretch gap-1 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{c.title}</span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">{c[kind]}/{c.total}</span>
                      </div>
                      <Progress value={Math.round((c[kind] / c.total) * 100)} aria-label={`${c.title} progress`} />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup className="mt-auto">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={stage === "session"} tooltip="Session" onClick={() => onStage("session")}><IconCards /><span>Session</span></SidebarMenuButton>
              <SidebarMenuBadge>7</SidebarMenuBadge>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

/** The left column: what you look at while you write. One column, one width; the tabs share it. */
function ReferenceColumn({ tab, onTab, page, terms, pendingTerms, onSaveTerm, relations, selected, onJump }: {
  tab: Reference; onTab: (t: Reference) => void; page: number | undefined
  terms: Term[]; pendingTerms: number; onSaveTerm: (term: string, patch: Partial<Term>) => void
  relations: Relation[]; selected: number | null; onJump: (segId: number) => void
}) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as Reference)} className="h-full gap-0">
      <div className="flex h-9 shrink-0 items-center border-b px-1.5">
        <TabsList variant="line" className="h-9">
          <TabsTrigger value="scan"><IconScan />Scan</TabsTrigger>
          <TabsTrigger value="glossary"><IconBook2 />Glossary{pendingTerms > 0 && <Badge variant="secondary">{pendingTerms}</Badge>}</TabsTrigger>
          <TabsTrigger value="relations"><IconAffiliate />Relations</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="scan" className="min-h-0 flex-1"><Scan page={page} /></TabsContent>
      <TabsContent value="glossary" className="min-h-0 flex-1 overflow-auto"><GlossaryList terms={terms} onSave={onSaveTerm} onJump={onJump} /></TabsContent>
      <TabsContent value="relations" className="min-h-0 flex-1"><RelationsGraph terms={terms} relations={relations} selected={selected} onJump={onJump} /></TabsContent>
    </Tabs>
  )
}

function Scan({ page }: { page: number | undefined }) {
  return (
    <div className="flex h-full flex-col bg-muted/40">
      <div className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">p. {page ?? "—"}</div>
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        <div className="mx-auto aspect-[2/3] w-full max-w-sm space-y-2 rounded-sm bg-background p-6 shadow-sm">
          {Array.from({ length: 22 }, (_, i) => <div key={i} className={cn("h-2 rounded-full bg-muted", i % 6 === 5 ? "w-2/3" : "w-full")} />)}
        </div>
      </div>
    </div>
  )
}

/** The glossary page's table, narrowed to a list: a row is the term and its Korean; opened, its kind, aliases and where it first occurs. */
function GlossaryList({ terms, onSave, onJump }: { terms: Term[]; onSave: (term: string, patch: Partial<Term>) => void; onJump: (segId: number) => void }) {
  const [filter, setFilter] = useState("")
  const [onlyPending, setOnlyPending] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const needle = filter.trim().toLowerCase()
  const shown = terms
    .filter((t) => (!onlyPending || !t.translation) && (!needle || `${t.term} ${t.translation} ${t.aliases}`.toLowerCase().includes(needle)))
    .sort((a, b) => Number(!!a.translation) - Number(!!b.translation) || a.term.localeCompare(b.term))
  const pending = terms.filter((t) => !t.translation).length
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b bg-background px-2 py-1.5">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter terms" aria-label="Filter terms" className="h-7 min-w-0 flex-1 text-xs" />
        <Button size="xs" variant={onlyPending ? "secondary" : "outline"} aria-pressed={onlyPending} onClick={() => setOnlyPending(!onlyPending)}>Without translation <Badge variant="secondary">{pending}</Badge></Button>
      </div>
      <ul className="divide-y text-xs">
        {shown.map((t) => {
          const isOpen = open === t.term
          return (
            <li key={t.term}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.term)}>
                <span className={cn("size-2 shrink-0 rounded-full", KIND_CLASS[t.kind].split(" ")[0])} aria-label={t.kind} />
                <span className="min-w-0 flex-1 truncate">{t.term}</span>
                {t.translation ? <span lang="ko" className="truncate text-muted-foreground">{t.translation}</span> : <span className="text-mark-warning-ink">—</span>}
                <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">{t.mentions}</span>
                <IconChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
              </button>
              {isOpen && (
                <div className="space-y-2 bg-muted/30 px-3 pt-1 pb-3 pl-7">
                  <label className="grid gap-1">Translation<Input defaultValue={t.translation} lang="ko" className="h-7 text-xs" onBlur={(e) => onSave(t.term, { translation: e.target.value })} /></label>
                  <label className="grid gap-1">Aliases<Input defaultValue={t.aliases} placeholder="Comma-separated" className="h-7 text-xs" onBlur={(e) => onSave(t.term, { aliases: e.target.value })} /></label>
                  <div className="flex items-center gap-2">
                    <Select value={t.kind} onValueChange={(v) => onSave(t.term, { kind: v as Kind })}>
                      <SelectTrigger size="sm" className="h-7 w-28 text-xs" aria-label="Kind"><SelectValue /></SelectTrigger>
                      <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                    </Select>
                    {t.first !== null && <Button size="xs" variant="ghost" className="ml-auto" onClick={() => onJump(t.first!)}>First mention ¶</Button>}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <p className="px-3 py-2 text-[11px] text-muted-foreground">{terms.length} terms · 본문의 용어 밑줄을 누르면 여기서 그 행이 열립니다.</p>
    </div>
  )
}

// --- Relations: React Flow draws, ELK places. Nothing here is a coordinate anyone typed. ---

type TermNode = Node<{ term: Term; dim: boolean }, "term">
type RelationEdge = Edge<{ label: string; segId: number; lit: boolean; dim: boolean }, "relation">

function TermNodeView({ data }: NodeProps<TermNode>) {
  const { term, dim } = data
  return (
    <div className={cn("rounded-md border px-2 py-1 text-xs shadow-sm transition-opacity", KIND_CLASS[term.kind], dim && "opacity-30")}>
      <Handle type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-transparent" />
      <div className="font-medium">{term.term}</div>
      {term.translation && <div lang="ko" className="opacity-80">{term.translation}</div>}
      <Handle type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-transparent" />
    </div>
  )
}

function RelationEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<RelationEdge>) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const { label, lit, dim } = data!
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: lit ? "var(--primary)" : "var(--border)", strokeWidth: lit ? 2 : 1.25, opacity: dim ? 0.25 : 1 }} />
      <EdgeLabelRenderer>
        <div
          className={cn("nodrag nopan pointer-events-auto absolute cursor-pointer rounded bg-background px-1 text-[10px] whitespace-nowrap", lit ? "text-primary font-medium" : "text-muted-foreground", dim && "opacity-25")}
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }} lang="ko"
        >{label}</div>
      </EdgeLabelRenderer>
    </>
  )
}

const nodeTypes = { term: TermNodeView }
const edgeTypes = { relation: RelationEdgeView }
const elk = new ELK()

/** The graph of the relations so far, placed by ELK. The selected paragraph lights the edges that rest on it and dims the
 *  rest; clicking an edge selects its paragraph in the text. The column is narrow: the graph is zoomed to fit. */
function RelationsGraph({ terms, relations, selected, onJump }: { terms: Term[]; relations: Relation[]; selected: number | null; onJump: (segId: number) => void }) {
  const [placed, setPlaced] = useState<Map<string, { x: number; y: number }> | null>(null)
  const linked = useMemo(() => terms.filter((t) => relations.some((r) => r.from === t.term || r.to === t.term)), [terms, relations])

  useEffect(() => {
    let live = true
    const graph: ElkNode = {
      id: "root",
      layoutOptions: { "elk.algorithm": "layered", "elk.direction": "DOWN", "elk.spacing.nodeNode": "28", "elk.layered.spacing.nodeNodeBetweenLayers": "56", "elk.edgeRouting": "SPLINES" },
      children: linked.map((t) => ({ id: t.term, width: Math.max(72, t.term.length * 6.5 + 18), height: t.translation ? 42 : 26 })),
      edges: relations.map((r) => ({ id: String(r.id), sources: [r.from], targets: [r.to] })),
    }
    void elk.layout(graph).then((out) => { if (live) setPlaced(new Map((out.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]))) })
    return () => { live = false }
  }, [linked, relations])

  const anyLit = selected !== null && relations.some((r) => r.segId === selected)
  const nodes: TermNode[] = useMemo(() => linked.map((t) => ({
    id: t.term, type: "term", position: placed?.get(t.term) ?? { x: 0, y: 0 },
    data: { term: t, dim: anyLit && !relations.some((r) => r.segId === selected && (r.from === t.term || r.to === t.term)) },
  })), [linked, placed, anyLit, relations, selected])
  const edges: RelationEdge[] = useMemo(() => relations.map((r) => ({
    id: String(r.id), type: "relation", source: r.from, target: r.to,
    data: { label: r.label, segId: r.segId, lit: r.segId === selected, dim: anyLit && r.segId !== selected },
  })), [relations, selected, anyLit])

  if (!placed) return <div className="p-3 text-xs text-muted-foreground">Placing…</div>
  return (
    <div className="h-full text-foreground">
      <ReactFlow
        key={placed.size} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        fitView fitViewOptions={{ padding: 0.1, minZoom: 0.9, maxZoom: 1.2 }} minZoom={0.3} proOptions={{ hideAttribution: true }}
        nodesConnectable={false} elementsSelectable={false} onEdgeClick={(_, e) => onJump(e.data!.segId)}
      >
        <Background gap={16} />
      </ReactFlow>
    </div>
  )
}

/** The chapter's paragraphs: the source alone while reviewing, source beside translation while translating. A paragraph
 *  that a relation rests on wears a small mark; it opens that relation in the column. */
function ChapterView({ stage, segs, selected, onSelect, terms, relations, onShowRelations }: {
  stage: Stage; segs: Seg[]; selected: number | null; onSelect: (id: number) => void; terms: Term[]; relations: Relation[]; onShowRelations: () => void
}) {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl divide-y">
        {segs.map((s) => {
          const rels = relations.filter((r) => r.segId === s.id)
          return (
            <div key={s.id} className={cn("grid cursor-default gap-x-6 px-6 py-3", stage === "translate" ? "grid-cols-2" : "grid-cols-1", selected === s.id && "bg-muted/40")} onClick={() => onSelect(s.id)}>
              <div className="col-span-full mb-1 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                <span>¶{s.n}</span><span>p. {s.page}</span>
                {rels.length > 0 && (
                  <button type="button" className="ml-auto flex items-center gap-1 rounded px-1 hover:bg-muted" onClick={(e) => { e.stopPropagation(); onSelect(s.id); onShowRelations() }} title="Relations resting on this paragraph">
                    <IconAffiliate className="size-3" />{rels.length}
                  </button>
                )}
              </div>
              <p className="font-serif text-[15px]/relaxed">{markTerms(s.en, terms)}</p>
              {stage === "translate" && (s.ko ? <p lang="ko" className="text-[15px]/relaxed">{s.ko}</p> : <p className="text-sm text-muted-foreground italic">Not translated yet</p>)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The glossary's marks in the source, as the editor draws them. */
function markTerms(text: string, terms: Term[]) {
  const names = terms.flatMap((t) => [t.term, ...t.aliases.split(",").map((a) => a.trim()).filter(Boolean)].map((n) => [n, t] as const)).sort((a, b) => b[0].length - a[0].length)
  const out: (string | React.ReactElement)[] = []
  let rest = text
  while (rest) {
    let best: { at: number; name: string; term: Term } | null = null
    for (const [name, term] of names) { const at = rest.indexOf(name); if (at >= 0 && (!best || at < best.at)) best = { at, name, term } }
    if (!best) { out.push(rest); break }
    out.push(rest.slice(0, best.at), <span key={out.length} className={cn("rounded-sm px-0.5", KIND_CLASS[best.term.kind])}>{best.name}</span>)
    rest = rest.slice(best.at + best.name.length)
  }
  return out
}

const SCHEMES = { A: "A · Translation with footnotes", B: "B · Bilingual, facing" } as const

/** Export: the page's choices in a dialog. */
function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(CHAPTERS.map((c) => c.id)))
  const [scheme, setScheme] = useState<keyof typeof SCHEMES>("A")
  const n = CHAPTERS.filter((c) => picked.has(c.id))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>A Word file of the chapters picked, in the scheme the publisher asked for.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div className="grid grid-cols-3 gap-1.5">
            {CHAPTERS.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-xs">
                <Checkbox checked={picked.has(c.id)} onCheckedChange={(on) => setPicked((p) => { const s = new Set(p); if (on) s.add(c.id); else s.delete(c.id); return s })} />{c.title}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Scheme</span>
            <Select value={scheme} onValueChange={(v) => setScheme(v as keyof typeof SCHEMES)}>
              <SelectTrigger size="sm" className="w-64" aria-label="Scheme"><SelectValue>{SCHEMES[scheme]}</SelectValue></SelectTrigger>
              <SelectContent>
                {(Object.keys(SCHEMES) as (keyof typeof SCHEMES)[]).map((k) => <SelectItem key={k} value={k}>{SCHEMES[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">{n.length} chapters · {n.reduce((s, c) => s + c.confirmed, 0)} confirmed of {n.reduce((s, c) => s + c.total, 0)} · 3 author notes untranslated</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onOpenChange(false)}><IconDownload data-icon="inline-start" />Download .docx</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The right panel, Claude's, as it is. */
function ClaudePanel() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-1.5 text-xs">
        <Button size="sm" variant="ghost" className="min-w-0 shrink justify-start"><span className="truncate">1장 인물 관계</span><IconChevronDown data-icon="inline-end" /></Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3 text-sm/relaxed">
        <div className="ml-6 rounded-lg bg-muted px-3 py-2" lang="ko">1장 인물 관계 정리해줘</div>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Read relations · Read Chapter I</p>
          <div className="rounded-lg border p-3 text-xs">
            <div className="mb-1 font-medium">관계 추가</div>
            <p><span className="font-medium">Nick Carraway</span> → <span className="font-medium">Daisy Buchanan</span></p>
            <p lang="ko" className="text-muted-foreground">“육촌 여동생” · 근거 ¶5 “Daisy was my second cousin once removed.”</p>
            <div className="mt-2 flex gap-1"><Button size="xs">Allow</Button><Button size="xs" variant="ghost">Deny</Button></div>
          </div>
          <p lang="ko">1장에서 관계 다섯을 찾았습니다. 하나씩 묻겠습니다.</p>
        </div>
      </div>
      <div className="shrink-0 p-2">
        <InputGroup>
          <InputGroupTextarea aria-label="Message" placeholder="Ask Claude about this chapter…" className="min-h-14" />
          <InputGroupAddon align="block-end" className="pt-1">
            <InputGroupButton size="sm" variant="ghost" className="text-muted-foreground">Opus 5.5 · medium<IconChevronDown data-icon="inline-end" /></InputGroupButton>
            <InputGroupButton size="icon-sm" variant="default" className="ml-auto" aria-label="Send"><IconArrowUp /></InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  )
}

function Guide() {
  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" variant="ghost" className="text-muted-foreground" />}><IconInfoCircle data-icon="inline-start" />목업 안내</PopoverTrigger>
      <PopoverContent align="end" className="w-96 text-xs leading-relaxed">
        <ul className="list-disc space-y-1.5 pl-4">
          <li><b>참조 칸</b>: 머리줄 왼쪽의 ▯ 버튼 또는 ⌘I. Review에서는 Scan으로 열려 있고, Translate에서는 닫혀 있습니다(지금의 스캔과 같음). 탭은 Scan · Glossary · Relations.</li>
          <li><b>Glossary</b>: 표 대신 목록. 행을 누르면 번역·별칭·종류 편집과 첫 등장 단락으로 가기. 미정 수는 탭의 배지, 칸이 닫혀 있으면 버튼의 점.</li>
          <li><b>Relations</b>: 노드는 용어집, 선은 관계. 배치는 ELK가 자동. 본문의 단락을 고르면 그 단락이 근거인 선이 밝아지고 나머지는 흐려집니다. 선의 라벨을 누르면 본문이 그 단락으로.</li>
          <li><b>본문</b>: 관계가 걸린 단락의 머리줄에 ⌥ 수. 누르면 Relations 탭이 열립니다. ¶5를 골라 보세요.</li>
          <li><b>Export</b>: 머리줄 오른쪽 아이콘 → 대화상자. 페이지가 아닙니다.</li>
          <li><b>사이드바</b>: Review · Translate · 장 목록 · Session만. Glossary와 Export 항목이 없습니다.</li>
          <li><b>폭</b>: 1280px과 1440px에서 칸 셋이 다 열린 채로 봐 주세요. 칸 사이 손잡이는 끌립니다.</li>
        </ul>
      </PopoverContent>
    </Popover>
  )
}
