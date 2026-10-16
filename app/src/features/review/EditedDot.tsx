import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DiffView } from "./DiffView"

/** Hollow dot marking a paragraph whose text differs from the OCR original; hover shows the cumulative diff. */
export function EditedDot({ ocr, text }: { ocr: string | null; text: string }) {
  if (ocr == null || ocr === text) return null
  return (
    <Tooltip>
      <TooltipTrigger render={<span data-edited aria-label="Edited" className="block size-2 rounded-full border border-muted-foreground/40 bg-background" />} />
      <TooltipContent side="right" className="max-w-sm px-2.5 py-1.5">
        <div className="mb-1 text-[11px] opacity-70">Edited — original OCR</div>
        <DiffView before={ocr} after={text} className="text-[13px]" />
      </TooltipContent>
    </Tooltip>
  )
}
