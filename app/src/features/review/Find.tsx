import { useEffect, useEffectEvent, useRef, useState } from "react"
import { IconSearch } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarInput, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar"
import { api } from "@/data/http"
import type { SearchHit } from "@/data/api"

interface InputProps {
  query: string
  onQuery: (query: string) => void
  /** Bumped by ⌘F: the box takes the cursor, the sidebar opening first if it is folded. */
  focusToken: number
}

/** Find in book, at the sidebar's head: a literal, case-sensitive search of the source. Folded to icons, a button. */
export function FindInput({ query, onQuery, focusToken }: InputProps) {
  const { open, setOpen } = useSidebar()
  const box = useRef<HTMLInputElement>(null)
  // folded, the box is not shown: it takes the cursor once the sidebar has opened
  const pending = useRef(false)
  const takeCursor = () => {
    if (open) box.current?.select()
    else { pending.current = true; setOpen(true) }
  }
  const onFocusToken = useEffectEvent(takeCursor)
  useEffect(() => { if (focusToken) onFocusToken() }, [focusToken])
  useEffect(() => { if (open && pending.current) { pending.current = false; box.current?.select() } }, [open])
  return (
    <>
      <div role="search" className="relative group-data-[collapsible=icon]:hidden">
        <IconSearch className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50" />
        <SidebarInput ref={box} value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Find in book" aria-label="Find in book"
          className="pr-9 pl-8" onKeyDown={(e) => { if (e.key === "Escape") { onQuery(""); e.currentTarget.blur() } }} />
        <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground">⌘F</kbd>
      </div>
      <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="Find in book (⌘F)" onClick={takeCursor}>
            <IconSearch />
            <span>Find in book</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  )
}

interface ResultsProps {
  query: string
  /** Changes after any write, so the hits are looked up again. */
  refreshKey: unknown
  /** The paragraph selected in the text, marked among the hits. */
  selectedId: number | null
  onJump: (segmentId: number, chapterId: number) => void
  onReplaceAll: (query: string, replacement: string) => Promise<unknown>
}

/** What Find found, in the chapters' place until the box is emptied (Esc). Replace all is one undo step. */
export function FindResults({ query, refreshKey, selectedId, onJump, onReplaceAll }: ResultsProps) {
  const [replacement, setReplacement] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  useEffect(() => {
    let live = true
    const t = window.setTimeout(() => void api.search(query).then((h) => live && setHits(h)), 200)
    return () => { live = false; window.clearTimeout(t) }
  }, [query, refreshKey])
  const total = hits.reduce((n, h) => n + h.count, 0)

  return (
    <SidebarGroup role="region" aria-label="Find results" className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel role="status" className="tabular-nums">{hits.length ? `${hits.length} paragraphs, ${total} matches` : "No matches"}</SidebarGroupLabel>
      <div className="flex gap-1 pb-2">
        <SidebarInput value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Replace with" aria-label="Replace with" />
        <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={!hits.length} onClick={() => void onReplaceAll(query, replacement)}>
          Replace all{total ? ` (${total})` : ""}
        </Button>
      </div>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          {hits.map((h) => (
            <SidebarMenuItem key={h.segmentId}>
              <SidebarMenuButton isActive={h.segmentId === selectedId} onClick={() => onJump(h.segmentId, h.chapterId)}
                className="h-auto flex-col items-stretch gap-0.5 py-1.5">
                <div className="flex gap-2 text-muted-foreground">
                  <span className="truncate">{h.chapterTitle}</span>
                  <span className="ml-auto shrink-0 tabular-nums">p. {h.pageStart}{h.count > 1 ? ` · ${h.count}×` : ""}</span>
                </div>
                <p className="reading line-clamp-2 text-[13px] font-normal" lang="en">…{marked(h.snippet, query)}…</p>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** The snippet with each occurrence of the query marked. */
const marked = (snippet: string, query: string) =>
  snippet.split(query).flatMap((part, i) => (i ? [<mark key={i} className="rounded-sm bg-mark-warning/70 text-inherit">{query}</mark>, part] : [part]))
