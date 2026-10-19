import { IconChevronDown } from "@tabler/icons-react"

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { Progress } from "@/components/ui/progress"
import type { Chapter } from "@/data/api"

interface Props {
  chapters: Chapter[]
  selectedId: number | null
  onSelect: (id: number) => void
  /** Which count drives the progress bar. */
  progress: "verified" | "confirmed"
}

const doneOf = (c: Chapter, progress: Props["progress"]) => (progress === "verified" ? c.verifiedCount : c.confirmedCount)

/** The chapters under the stages in the sidebar. Folded to icons, the sidebar hides them: the header's ChapterMenu
 *  stays. */
export function ChapterList({ chapters, selectedId, onSelect, progress }: Props) {
  return (
    <SidebarGroup role="navigation" aria-label="Chapters" className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Chapters</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          {chapters.map((c) => {
            const done = doneOf(c, progress)
            const pct = c.segmentCount ? Math.round((done / c.segmentCount) * 100) : 0
            return (
              <SidebarMenuItem key={c.id}>
                <SidebarMenuButton
                  isActive={c.id === selectedId}
                  onClick={() => onSelect(c.id)}
                  className="h-auto flex-col items-stretch gap-1 py-1.5"
                  title={c.title}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate">{c.title}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {done}/{c.segmentCount}
                    </span>
                  </span>
                  <Progress value={pct} aria-label={`${c.title} progress`} />
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** The chapter in the header's breadcrumb, a menu of the chapters: the way to another one when the sidebar is folded. */
export function ChapterMenu({ chapters, selectedId, onSelect, progress }: Props) {
  const current = chapters.find((c) => c.id === selectedId)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-w-0 items-center gap-1 rounded-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
        <span className="truncate">{current?.title ?? "—"}</span>
        <IconChevronDown className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup value={selectedId === null ? "" : String(selectedId)} onValueChange={(v) => onSelect(Number(v))}>
          {chapters.map((c) => (
            <DropdownMenuRadioItem key={c.id} value={String(c.id)} closeOnClick>
              <span className="truncate">{c.title}</span>
              <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{doneOf(c, progress)}/{c.segmentCount}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
