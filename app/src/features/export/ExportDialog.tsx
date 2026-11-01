import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { Chapter } from "@/data/api"
import { ExportView } from "./ExportView"

/** Export is an action on the book, not a place (§35): the Export view in a dialog opened from the header. */
export function ExportDialog({ open, onOpenChange, chapters }: { open: boolean; onOpenChange: (open: boolean) => void; chapters: Chapter[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-auto p-0 sm:max-w-4xl">
        <DialogHeader className="px-6 pt-4">
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>A Word file of the chapters picked, notes in the scheme the publisher asked for.</DialogDescription>
        </DialogHeader>
        {open && <ExportView chapters={chapters} />}
      </DialogContent>
    </Dialog>
  )
}
