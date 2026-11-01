import { useEffect, useRef, type CSSProperties, type ReactNode } from "react"
import { useDefaultLayout, usePanelRef } from "react-resizable-panels"
import { IconBook, IconCards, IconFileExport, IconLanguage, IconLayoutSidebar, IconScan, IconSparkles, type Icon } from "@tabler/icons-react"

import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarRail, SidebarTrigger,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** The stages of the work; and, at the sidebar's foot, the page of the whole book: Session (the day's quiz,
 *  docs/session.md). */
export type Mode = "review" | "translate" | "session"

const STAGES: { value: Mode; label: string; icon: Icon }[] = [
  { value: "review", label: "Review", icon: IconScan },
  { value: "translate", label: "Translate", icon: IconLanguage },
]

interface AppShellProps {
  mode: Mode
  onModeChange: (mode: Mode) => void
  /** The book, at the sidebar's head. */
  book: { title: string; author: string | null } | null
  /** Find in book, under the book. */
  find: ReactNode
  /** How far the book is in a stage, in percent: the stage's badge. */
  stageProgress: Partial<Record<Mode, number>>
  /** Glossary terms without a translation: a dot on the reference button while the column is closed (the glossary's tab
   *  has the count). */
  pendingTerms: number
  /** Today's cards and challenges not yet done: Session's badge, and a dot when the sidebar is folded to icons. */
  sessionLeft: number
  /** The chapters, under the stages (or what Find found); none on a page of the whole book (Session). */
  sidebar: ReactNode
  /** The breadcrumb after the stage: the chapter, as a menu. None in a stage of the whole book. */
  crumb: ReactNode
  /** The reference column (§35), the left one: the scan, the glossary, the relations, as tabs. */
  left: ReactNode
  /** The reference column is open: the header's button and ⌘I toggle it. Closed, it is not rendered. */
  referenceOpen: boolean
  onReferenceToggle: () => void
  /** Export: the header's button opens its dialog (§35). */
  onExport: () => void
  right: ReactNode
  /** Claude's panel, the right one. */
  panel: ReactNode
  /** Claude's panel is open: the header's button and ⌘L open it, dragging its edge to nothing closes it. */
  claudeOpen: boolean
  onClaudeOpenChange: (open: boolean) => void
  /** What of Claude's waits (an answer it asks for, its suggestions): a dot on the header's button while the panel is
   *  closed, saying this. */
  claudeWaiting: string | null
  status: ReactNode
  /** A full-width page that replaces the three panels (Session). */
  main?: ReactNode
}

/** The sidebar provider writes its open state to a cookie; read it back so the choice survives reloads. */
const sidebarDefaultOpen = () => !/(?:^|; )sidebar_state=false/.test(document.cookie)

/** Fixed frame: sidebar (sidebar-07: the book, the stages, the chapters; folds to icons) | [breadcrumb /
 *  left+right+panel / status]. Content is injected per mode. */
export function AppShell({
  mode, onModeChange, book, find, stageProgress, pendingTerms, sessionLeft, sidebar, crumb, left, referenceOpen, onReferenceToggle, onExport, right, panel, claudeOpen,
  onClaudeOpenChange, claudeWaiting, status, main,
}: AppShellProps) {
  // The widths the translator dragged the panels to, kept across reloads: one layout with the reference column, one
  // without. A closed column is not rendered, so the library keeps the two apart (panelIds).
  const layout = useDefaultLayout({
    id: "fitz-panels", panelIds: referenceOpen ? ["reference", "main", "panel"] : ["main", "panel"], storage: localStorage, onlySaveAfterUserInteractions: true,
  })
  const label = mode === "session" ? "Session" : STAGES.find((m) => m.value === mode)!.label
  // The panel is what is open or not (its edge can be dragged shut, its layout is remembered), and says so on resize;
  // the header's button asks it to change. Only a change is acted on: a page opening keeps the panel as it was left.
  const claudePanel = usePanelRef()
  const askedOpen = useRef(claudeOpen)
  // the button is the translator's hand on the layout as much as a drag is: what it changes is remembered as a drag's is
  const byButton = useRef(false)
  useEffect(() => {
    if (askedOpen.current === claudeOpen) return
    askedOpen.current = claudeOpen
    const p = claudePanel.current
    if (!p || p.isCollapsed() === !claudeOpen) return
    byButton.current = true
    if (claudeOpen) p.expand()
    else p.collapse()
  }, [claudeOpen, claudePanel])
  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen()} style={{ "--sidebar-width": "17rem" } as CSSProperties}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" render={<div />} className="hover:bg-transparent active:bg-transparent">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <IconBook className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{book?.title}</span>
                  {book?.author && <span className="truncate text-xs text-muted-foreground">{book.author}</span>}
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {find}
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {STAGES.map((m) => (
                <SidebarMenuItem key={m.value}>
                  <SidebarMenuButton isActive={mode === m.value} aria-current={mode === m.value ? "page" : undefined} tooltip={m.label}
                    onClick={() => onModeChange(m.value)}>
                    <m.icon />
                    <span>{m.label}</span>
                  </SidebarMenuButton>
                  {stageProgress[m.value] !== undefined && <SidebarMenuBadge>{stageProgress[m.value]}%</SidebarMenuBadge>}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
          {sidebar}
          <SidebarGroup className="mt-auto">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={mode === "session"} aria-current={mode === "session" ? "page" : undefined} tooltip="Session"
                  onClick={() => onModeChange("session")}>
                  <IconCards />
                  <span>Session</span>
                </SidebarMenuButton>
                {sessionLeft > 0 && <SidebarMenuBadge title="Cards and challenges left today" data-session-left>{sessionLeft}</SidebarMenuBadge>}
                {/* folded to icons the badge is gone: a dot says something is waiting */}
                {sessionLeft > 0 && <span aria-hidden className="pointer-events-none absolute top-1.5 left-6 hidden size-1.5 rounded-full bg-primary group-data-[collapsible=icon]:block" />}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="-ml-1" aria-label="Toggle sidebar" title="Toggle sidebar (⌘B)" />
          <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
          {!main && (
            <Tooltip>
              <TooltipTrigger
                render={<Button size="icon-sm" variant={referenceOpen ? "secondary" : "ghost"} aria-label="Reference" aria-pressed={referenceOpen} className="relative" onClick={onReferenceToggle} />}
              >
                <IconLayoutSidebar />
                {!referenceOpen && pendingTerms > 0 && <span data-attention aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />}
              </TooltipTrigger>
              <TooltipContent side="bottom">Scan · Glossary · Relations{!referenceOpen && pendingTerms > 0 ? ` · ${pendingTerms} terms without a translation` : ""} <Kbd>⌘I</Kbd></TooltipContent>
            </Tooltip>
          )}
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap">
              {crumb ? (
                <>
                  <BreadcrumbItem>{label}</BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem className="min-w-0">{crumb}</BreadcrumbItem>
                </>
              ) : (
                <BreadcrumbItem><BreadcrumbPage>{label}</BreadcrumbPage></BreadcrumbItem>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          <Tooltip>
            <TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Export" className="ml-auto" onClick={onExport} />}><IconFileExport /></TooltipTrigger>
            <TooltipContent side="bottom">Export…</TooltipContent>
          </Tooltip>
          {!main && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button size="icon-sm" variant={claudeOpen ? "secondary" : "ghost"} aria-label="Claude" aria-pressed={claudeOpen} className="relative"
                    onClick={() => onClaudeOpenChange(!claudeOpen)} />
                }
              >
                <IconSparkles />
                {!claudeOpen && claudeWaiting && <span data-attention aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />}
              </TooltipTrigger>
              <TooltipContent side="bottom">{!claudeOpen && claudeWaiting ? claudeWaiting : "Claude"} <Kbd>⌘L</Kbd></TooltipContent>
            </Tooltip>
          )}
        </header>
        {main ? <div className="min-h-0 flex-1 overflow-auto">{main}</div> : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1" defaultLayout={layout.defaultLayout}
          onLayoutChanged={(next, meta) => {
            layout.onLayoutChanged(next, byButton.current ? { ...meta, isUserInteraction: true } : meta)
            byButton.current = false
          }}>
          {referenceOpen && (
            <>
              <ResizablePanel id="reference" defaultSize="42" minSize={240} collapsible collapsedSize={0}>
                {left}
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}
          <ResizablePanel id="main" defaultSize={referenceOpen ? "38" : "80"} minSize={320}>
            {right}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="panel" defaultSize="20" minSize={200} collapsible collapsedSize={0} panelRef={claudePanel}
            onResize={(size) => { if (size.inPixels > 0 !== claudeOpen) onClaudeOpenChange(size.inPixels > 0) }}>
            {/* closed, its content is gone too, not only out of sight: out of the tab order and what is read aloud */}
            <div hidden={!claudeOpen} className="h-full">{panel}</div>
          </ResizablePanel>
        </ResizablePanelGroup>
        )}
        <footer className="flex h-7 shrink-0 items-center gap-4 border-t px-3 text-xs text-muted-foreground tabular-nums">
          {status}
        </footer>
      </SidebarInset>
    </SidebarProvider>
  )
}
