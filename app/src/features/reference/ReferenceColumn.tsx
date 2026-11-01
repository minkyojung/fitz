import type { ReactNode } from "react"
import { IconScan } from "@tabler/icons-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/** The tabs of the reference column (docs/agent.md §35): what you look at while you write. */
export type Reference = "scan"

/** The left column: one column, one width; the tabs share it. */
export function ReferenceColumn({ tab, onTab, scan }: { tab: Reference; onTab: (tab: Reference) => void; scan: ReactNode }) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as Reference)} className="h-full gap-0">
      <div className="flex h-9 shrink-0 items-center border-b px-1.5">
        <TabsList variant="line" className="h-9" aria-label="Reference">
          <TabsTrigger value="scan"><IconScan />Scan</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="scan" className="min-h-0 flex-1">{scan}</TabsContent>
    </Tabs>
  )
}
