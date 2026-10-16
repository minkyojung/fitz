import type { ReactNode } from "react"

import { Sidebar, SidebarContent, SidebarHeader, SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
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
}

/** Fixed frame: sidebar | [tabs / left+right+panel / status]. Content is injected per mode. */
export function AppShell({ mode, onModeChange, sidebar, left, right, panel, status }: AppShellProps) {
  return (
    <SidebarProvider style={{ "--sidebar-width": "15rem" } as React.CSSProperties}>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="border-b px-3 py-2 text-xs font-medium">The Fish That Ate the Whale</SidebarHeader>
        <SidebarContent>{sidebar}</SidebarContent>
      </Sidebar>
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-9 shrink-0 items-center border-b px-2">
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
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize="42" minSize={240}>
            {left}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="38" minSize={320}>
            {right}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="20" minSize={200} collapsible collapsedSize={0}>
            {panel}
          </ResizablePanel>
        </ResizablePanelGroup>
        <footer className="flex h-7 shrink-0 items-center gap-4 border-t px-3 text-xs text-muted-foreground tabular-nums">
          {status}
        </footer>
      </SidebarInset>
    </SidebarProvider>
  )
}
