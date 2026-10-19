import { useEffect, useRef, useState } from "react"
import { IconDownload } from "@tabler/icons-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/data/http"
import type { Chapter, ExportScheme, ExportSummary, ExportWarning } from "@/data/api"
import { formatSheets, SHEET_CHARS } from "@/lib/manuscript"
import { cn } from "cn"

export const SCHEMES: { value: ExportScheme; label: string; blurb: string }[] = [
  { value: "A", label: "A · Author endnotes, translator * footnotes", blurb: "Author's notes numbered and collected at the end of each chapter; translator's notes as * † ‡ footnotes at the foot of the page. CMOS 14.25." },
  { value: "B", label: "B · All footnotes, one series", blurb: "Everything numbered in one series at the foot of the page; translator's notes end with —옮긴이. CMOS 14.53." },
  { value: "C", label: "C · All endnotes, one series", blurb: "The same single series, collected at the end of each chapter; translator's notes end with —옮긴이." },
]

const WARNING_LABEL: Record<ExportWarning["kind"], string> = {
  untranslated: "Untranslated paragraphs (the English is exported, highlighted)",
  unplaced: "Author's notes not placed (the number sits at the end of the paragraph)",
  untranslatedNote: "Author's notes not translated (exported in English)",
  lostAnchor: "Notes whose anchor no longer matches (placed at the end of the paragraph)",
}

interface Props { chapters: Chapter[] }

/** The Export tab: pick chapters and a note scheme, see what the file will contain, download it. */
export function ExportView({ chapters }: Props) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(chapters.map((c) => c.id)))
  const [scheme, setScheme] = useState<ExportScheme>("A")
  const [summary, setSummary] = useState<ExportSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  const chapterIds = chapters.filter((c) => picked.has(c.id)).map((c) => c.id)
  const key = chapterIds.join(",")

  useEffect(() => {
    const id = ++request.current
    if (!chapterIds.length) { setSummary(null); return }
    api.exportSummary({ chapterIds, scheme })
      .then((s) => { if (id === request.current) setSummary(s) })
      .catch((e: Error) => toast.error("Export summary failed", { description: e.message }))
  }, [key, scheme]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: number, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n })
  const download = async () => {
    setBusy(true)
    try {
      const { blob, filename } = await api.exportDocx({ chapterIds, scheme })
      const url = URL.createObjectURL(blob)
      const a = Object.assign(document.createElement("a"), { href: url, download: filename })
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error("Export failed", { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const byChapter = new Map(summary?.chapters.map((c) => [c.id, c]) ?? [])
  const grouped = (["untranslated", "unplaced", "untranslatedNote", "lostAnchor"] as const).map((kind) => ({ kind, items: summary?.warnings.filter((w) => w.kind === kind) ?? [] })).filter((g) => g.items.length)
  const titleOf = (id: number) => chapters.find((c) => c.id === id)?.title ?? ""

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-[minmax(16rem,1fr)_minmax(20rem,1.4fr)] gap-8 p-6">
      <section>
        <div className="mb-2 flex items-center gap-2 text-xs">
          <span className="font-medium">Chapters</span>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(chapters.map((c) => c.id)))}>All</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>None</Button>
        </div>
        <ul className="divide-y rounded-md border text-xs">
          {chapters.map((c) => {
            const s = byChapter.get(c.id)
            return (
              <li key={c.id} className="flex items-center gap-2 px-2 py-1.5">
                <Checkbox checked={picked.has(c.id)} onCheckedChange={(v) => toggle(c.id, v === true)} aria-label={c.title} />
                <span className="truncate">{c.title}</span>
                <span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">{c.confirmedCount}/{c.segmentCount} confirmed</span>
                {s && s.untranslated > 0 && <Badge variant="outline" title="Untranslated paragraphs">{s.untranslated} untranslated</Badge>}
                {s && s.unplaced > 0 && <Badge variant="outline" title="Author's notes not placed">{s.unplaced} unplaced</Badge>}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="space-y-4 text-xs">
        <div>
          <div className="mb-2 font-medium">Notes</div>
          <ToggleGroup value={[scheme]} onValueChange={(v) => v[0] && setScheme(v[0] as ExportScheme)} size="sm" variant="outline" spacing={0}>
            {SCHEMES.map((s) => <ToggleGroupItem key={s.value} value={s.value} className="text-xs">{s.label}</ToggleGroupItem>)}
          </ToggleGroup>
          <p className="mt-1.5 text-muted-foreground">{SCHEMES.find((s) => s.value === scheme)!.blurb}</p>
        </div>

        <div className="rounded-md border p-3" data-export-summary>
          {summary ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tabular-nums">
              <dt className="text-muted-foreground">Chapters</dt><dd>{summary.stats.chapters}</dd>
              <dt className="text-muted-foreground">Paragraphs</dt><dd>{summary.stats.segments} <span className="text-muted-foreground">({summary.stats.untranslated} untranslated)</span></dd>
              <dt className="text-muted-foreground">Notes</dt><dd>{summary.stats.authorNotes} author's, {summary.stats.translatorNotes} translator's <span className="text-muted-foreground">({summary.stats.unplaced} not placed, {summary.stats.untranslatedNotes} untranslated)</span></dd>
              <dt className="text-muted-foreground">Length</dt><dd>{formatSheets(Math.round((summary.stats.chars / SHEET_CHARS) * 10) / 10)} <span className="text-muted-foreground">({summary.stats.chars.toLocaleString("en-US")} characters, translated text only)</span></dd>
              <dt className="text-muted-foreground">File</dt><dd className="font-mono">{summary.filename}</dd>
            </dl>
          ) : (
            <p className="text-muted-foreground">Pick at least one chapter.</p>
          )}
        </div>

        {grouped.map((g) => (
          <div key={g.kind} data-export-warning={g.kind}>
            <div className={cn("mb-1 font-medium", g.kind === "untranslated" ? "text-destructive" : "text-mark-warning-ink")}>{WARNING_LABEL[g.kind]} · {g.items.length}</div>
            <ul className="max-h-40 overflow-auto text-muted-foreground">
              {g.items.slice(0, 200).map((w, i) => (
                <li key={i}>{titleOf(w.chapterId)} · paragraph {w.idx + 1}{w.noteId ? ` · note #${w.noteId}` : ""}</li>
              ))}
              {g.items.length > 200 && <li>… and {g.items.length - 200} more</li>}
            </ul>
          </div>
        ))}

        <Button onClick={() => void download()} disabled={!summary || busy}>
          <IconDownload data-icon="inline-start" /> {busy ? "Preparing…" : "Download .docx"}
        </Button>
      </section>
    </div>
  )
}
