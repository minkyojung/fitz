import type { ReactNode } from "react"
import { IconAffiliate, IconBook2, IconScan } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/** The tabs of the reference column (docs/agent.md §35): what you look at while you write. */
export type Reference = "scan" | "glossary" | "relations"

/** The left column: one column, one width; the tabs share it. */
export function ReferenceColumn({ tab, onTab, scan, glossary, relations, pendingTerms }: {
  tab: Reference
  onTab: (tab: Reference) => void
  scan: ReactNode
  glossary: ReactNode
  relations: ReactNode
  /** Glossary terms without a translation: the tab's badge. */
  pendingTerms: number
}) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as Reference)} className="h-full gap-0">
      <div className="flex h-9 shrink-0 items-center border-b px-1.5">
        <TabsList variant="line" className="h-9" aria-label="Reference">
          <TabsTrigger value="scan"><IconScan />Scan</TabsTrigger>
          <TabsTrigger value="glossary"><IconBook2 />Glossary{pendingTerms > 0 && <Badge variant="secondary" title="Terms without a translation">{pendingTerms}</Badge>}</TabsTrigger>
          <TabsTrigger value="relations"><IconAffiliate />Relations</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="scan" className="min-h-0 flex-1">{scan}</TabsContent>
      <TabsContent value="glossary" className="min-h-0 flex-1">{glossary}</TabsContent>
      <TabsContent value="relations" className="min-h-0 flex-1">{relations}</TabsContent>
    </Tabs>
  )
}
