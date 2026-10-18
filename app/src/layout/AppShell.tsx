import type { ReactNode } from "react"
import { useDefaultLayout } from "react-resizable-panels"

import { Sidebar, SidebarContent, SidebarHeader, SidebarInset, SidebarProvider, SidebarRail, SidebarTrigger } from "@/components/ui/sidebar"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type Mode = "review" | "translate" | "export"

const MODES: { value: Mode; label: string }[] = [
  { value: "review", label: "Review" },
  { value: "translate", label: "Translate" },
  { value: "export", label: "Export" },
]

interface AppShellProps {
  mode: Mode
  onModeChange: (mode: Mode) => void
  sidebar: ReactNode
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

/** Fixed frame: sidebar | [tabs / left+right+panel / status]. Content is injected per mode. */
export function AppShell({ mode, onModeChange, sidebar, left, right, panel, status, leftCollapsed = false, main }: AppShellProps) {
  // The widths the translator dragged the panels to, kept across reloads: one layout with the scan, one without. A
  // hidden scan is not rendered, so the library keeps the two apart (panelIds).
  const layout = useDefaultLayout({
    id: "fitz-panels", panelIds: leftCollapsed ? ["main", "panel"] : ["scan", "main", "panel"], storage: localStorage, onlySaveAfterUserInteractions: true,
  })
  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen()} style={{ "--sidebar-width": "15rem" } as React.CSSProperties}>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="border-b px-3 py-2 text-xs font-medium">The Fish That Ate the Whale</SidebarHeader>
        <SidebarContent>{sidebar}</SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
          <SidebarTrigger aria-label="Toggle chapters" title="Toggle chapters (⌘B)" />
          <Tabs value={mode} onValueChange={(v) => onModeChange(v as Mode)}>
            <TabsList>
              {MODES.map((m) => (
                <TabsTrigger key={m.value} value={m.value}>
                  {m.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
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
