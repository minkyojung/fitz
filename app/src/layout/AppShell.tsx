import type { CSSProperties, ReactNode } from "react"
import { useDefaultLayout } from "react-resizable-panels"
import { IconBook, IconFileExport, IconLanguage, IconScan, type Icon } from "@tabler/icons-react"

import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarRail, SidebarTrigger,
} from "@/components/ui/sidebar"

export type Mode = "review" | "translate" | "export"

const MODES: { value: Mode; label: string; icon: Icon }[] = [
  { value: "review", label: "Review", icon: IconScan },
  { value: "translate", label: "Translate", icon: IconLanguage },
  { value: "export", label: "Export", icon: IconFileExport },
]

interface AppShellProps {
  mode: Mode
  onModeChange: (mode: Mode) => void
  /** The book, at the sidebar's head. */
  book: { title: string; author: string | null } | null
  /** How far the book is in a stage, in percent: the stage's badge. */
  stageProgress: Partial<Record<Mode, number>>
  /** The chapters, under the stages; none in a stage of the whole book (Export). */
  sidebar: ReactNode
  /** The breadcrumb after the stage: the chapter, as a menu. None in a stage of the whole book. */
  crumb: ReactNode
  left: ReactNode
  right: ReactNode
  panel: ReactNode
  status: ReactNode
  /** Hide the scan (left) panel, e.g. while translating. */
  leftCollapsed?: boolean
  /** A full-width view that replaces the three panels (the Export tab). */
  main?: ReactNode
}

/** The sidebar provider writes its open state to a cookie; read it back so the choice survives reloads. */
const sidebarDefaultOpen = () => !/(?:^|; )sidebar_state=false/.test(document.cookie)

/** Fixed frame: sidebar (sidebar-07: the book, the stages, the chapters; folds to icons) | [breadcrumb /
 *  left+right+panel / status]. Content is injected per mode. */
export function AppShell({ mode, onModeChange, book, stageProgress, sidebar, crumb, left, right, panel, status, leftCollapsed = false, main }: AppShellProps) {
  // The widths the translator dragged the panels to, kept across reloads: one layout with the scan, one without. A
  // hidden scan is not rendered, so the library keeps the two apart (panelIds).
  const layout = useDefaultLayout({
    id: "fitz-panels", panelIds: leftCollapsed ? ["main", "panel"] : ["scan", "main", "panel"], storage: localStorage, onlySaveAfterUserInteractions: true,
  })
  const label = MODES.find((m) => m.value === mode)!.label
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
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {MODES.map((m) => (
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
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="-ml-1" aria-label="Toggle sidebar" title="Toggle sidebar (⌘B)" />
          <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
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
        </header>
        {main ? <div className="min-h-0 flex-1 overflow-auto">{main}</div> : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
          {!leftCollapsed && (
            <>
              <ResizablePanel id="scan" defaultSize="42" minSize={240} collapsible collapsedSize={0}>
                {left}
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}
          <ResizablePanel id="main" defaultSize={leftCollapsed ? "80" : "38"} minSize={320}>
            {right}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="panel" defaultSize="20" minSize={200} collapsible collapsedSize={0}>
            {panel}
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
