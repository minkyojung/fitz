import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { Progress } from "@/components/ui/progress"
import type { Chapter } from "@/data/api"

interface Props {
  chapters: Chapter[]
  selectedId: number | null
  onSelect: (id: number) => void
  /** Which count drives the progress bar. */
  progress: "verified" | "confirmed"
}

export function ChapterList({ chapters, selectedId, onSelect, progress }: Props) {
  return (
    <SidebarMenu className="gap-0 px-1 py-1">
      {chapters.map((c) => {
        const done = progress === "verified" ? c.verifiedCount : c.confirmedCount
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
  )
}
