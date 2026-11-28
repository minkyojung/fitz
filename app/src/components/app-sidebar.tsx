import { Book02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import type { Book, Chapter } from "@shared/protocol.ts"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

/** The book and its chapters. Each chapter says how many of its paragraphs are translated. */
export function AppSidebar({
  book,
  chapters,
  selectedId,
  onPick,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  book: Book
  chapters: Chapter[]
  selectedId: number | null
  onPick: (chapterId: number) => void
}) {
  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-2 p-2">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <HugeiconsIcon icon={Book02Icon} strokeWidth={2} className="size-4" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{book.title}</span>
            {book.author && <span className="truncate text-xs">{book.author}</span>}
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Chapters</SidebarGroupLabel>
          <SidebarMenu>
            {chapters.map((chapter) => (
              <SidebarMenuItem key={chapter.id} data-chapter-id={chapter.id}>
                <SidebarMenuButton
                  isActive={chapter.id === selectedId}
                  aria-current={chapter.id === selectedId ? "true" : undefined}
                  className="pr-14"
                  onClick={() => onPick(chapter.id)}
                >
                  <span>{chapter.title}</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>
                  {chapter.translatedCount}/{chapter.segmentCount}
                </SidebarMenuBadge>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
