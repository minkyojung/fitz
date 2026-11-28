import { Book02Icon, DocumentValidationIcon, TranslateIcon } from "@hugeicons/core-free-icons"
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

/** The two stages of the work on a book: checking the source against the scan, then translating it. */
export type Stage = "review" | "translate"
const STAGES: { stage: Stage; label: string; icon: typeof TranslateIcon }[] = [
  { stage: "review", label: "Review", icon: DocumentValidationIcon },
  { stage: "translate", label: "Translate", icon: TranslateIcon },
]

/** The book, its stages, and its chapters. Each chapter counts what is done in the stage: paragraphs checked against
 *  the scan in Review, translated in Translate. */
export function AppSidebar({
  book,
  stage,
  onStage,
  chapters,
  selectedId,
  onPick,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  book: Book
  stage: Stage
  onStage: (stage: Stage) => void
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
          <SidebarGroupLabel>Stage</SidebarGroupLabel>
          <SidebarMenu>
            {STAGES.map((s) => (
              <SidebarMenuItem key={s.stage} data-stage={s.stage}>
                <SidebarMenuButton isActive={s.stage === stage} aria-current={s.stage === stage ? "true" : undefined} onClick={() => onStage(s.stage)}>
                  <HugeiconsIcon icon={s.icon} strokeWidth={2} />
                  <span>{s.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
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
                  {stage === "review" ? chapter.verifiedCount : chapter.translatedCount}/{chapter.segmentCount}
                </SidebarMenuBadge>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
