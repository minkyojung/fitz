import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatSheets, sheets } from "@/lib/manuscript"
import { cn } from "cn"

type Status = "untranslated" | "draft" | "reviewed" | "final"
const STATUS_LABEL: Record<Status, string> = { untranslated: "Untranslated", draft: "Draft", reviewed: "Reviewed", final: "Final" }
const STATUS_CLASS: Record<Status, string> = {
  untranslated: "border-border text-muted-foreground",
  draft: "bg-secondary text-secondary-foreground",
  reviewed: "bg-mark-note text-foreground",
  final: "bg-mark-term text-foreground",
}

const ROWS: { page: number; kind: string; source: string; target: string; status: Status }[] = [
  { page: 11, kind: "Heading", source: "Selma", target: "셀마", status: "final" },
  { page: 11, kind: "Paragraph", status: "reviewed",
    source: "Sam Zemurray saw his first banana in 1893. In the lore, this is presented as a moment of clarity, wherein the future was revealed. In some versions, the original banana is presented as a platonic ideal, an archetype circling the young man’s head.",
    target: "샘 제무레이가 처음 바나나를 본 것은 1893년이었다. 전해지는 이야기에서 이 순간은 앞날이 환히 드러난 깨달음의 순간으로 그려진다. 어떤 판본에서는 그 첫 바나나가 플라톤적 이데아처럼, 젊은이의 머리 위를 맴도는 원형으로 묘사된다." },
  { page: 11, kind: "Paragraph", status: "draft",
    source: "The most likely version has Sam seeing that first banana in the wares of a peddler in the alley behind his uncle’s store in Selma. The American banana trade had begun twenty years before, but it was still embryonic.",
    target: "가장 그럴듯한 판본은 샘이 셀마에 있는 삼촌 가게 뒷골목, 행상의 좌판에서 그 첫 바나나를 보았다는 것이다. 미국의 바나나 무역은 이십 년 전에 시작되었지만 아직 걸음마 단계였다." },
  { page: 12, kind: "Paragraph", status: "untranslated",
    source: "Few people had ever seen a banana. If they were spoken of at all, it was as an oddity, the way a person might speak of an African cucumber today.",
    target: "" },
  { page: 12, kind: "Quote", status: "untranslated",
    source: "“What are those?” he asked, pointing to the fruit piled on the wharf.",
    target: "" },
]

/** How the translation mode reads: source above (read-only), Korean below in Noto Serif KR, click to edit. */
export function TranslateGallery() {
  const [rows, setRows] = useState(ROWS)
  const [editing, setEditing] = useState<number | null>(null)
  const total = useMemo(() => sheets(rows.map((r) => r.target).join("\n")), [rows])
  const done = rows.filter((r) => r.status === "reviewed" || r.status === "final").length

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-8">
      <h1 className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Translate mode gallery</span>
        <span>source above · Korean below (Noto Serif KR) · click the Korean to edit · status per paragraph</span>
        <span className="ml-auto tabular-nums">{done}/{rows.length} reviewed · {formatSheets(total)}</span>
      </h1>
      {rows.map((r, i) => (
        <div key={i} className={cn("rounded-md border px-2 py-1.5", editing === i ? "border-border bg-muted/60" : "border-transparent bg-muted/40")}>
          <div className="mb-1 flex min-h-6 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
            <span className="text-muted-foreground tabular-nums">p. {r.page}</span>
            <Badge variant="outline">{r.kind}</Badge>
            <Select value={r.status} onValueChange={(v) => v && setRows((rs) => rs.map((x, k) => (k === i ? { ...x, status: v as Status } : x)))}>
              <SelectTrigger size="sm" aria-label="Status" className={cn("ml-auto border-transparent", STATUS_CLASS[r.status])}>
                <SelectValue>{STATUS_LABEL[r.status]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {r.target && <span className="text-muted-foreground tabular-nums">{formatSheets(sheets(r.target))}</span>}
          </div>
          <p className={cn("reading text-[15px] text-muted-foreground", r.kind === "Heading" && "font-semibold")} lang="en">
            {r.source}
          </p>
          {editing === i ? (
            <textarea
              autoFocus
              lang="ko"
              className={cn("reading mt-2 w-full resize-none bg-transparent text-[16px] outline-none", r.kind === "Heading" && "font-semibold")}
              rows={Math.max(2, Math.ceil(r.target.length / 38))}
              value={r.target}
              onChange={(e) => setRows((rs) => rs.map((x, k) => (k === i ? { ...x, target: e.target.value, status: x.status === "untranslated" && e.target.value ? "draft" : x.status } : x)))}
              onBlur={() => setEditing(null)}
            />
          ) : (
            <p
              lang="ko"
              onClick={() => setEditing(i)}
              className={cn("reading mt-2 cursor-text text-[16px]", r.kind === "Heading" && "font-semibold", !r.target && "text-muted-foreground/60")}
            >
              {r.target || "Translate…"}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
