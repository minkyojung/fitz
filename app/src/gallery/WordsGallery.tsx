import { useState } from "react"
import { Streamdown } from "streamdown"
import { cjk } from "@streamdown/cjk"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Checkbox } from "@/components/ui/checkbox"
import { Message, MessageContent } from "@/components/ui/message"
import { foldMessages, type SdkMessage } from "../../../server/agent/fold.mjs"
import nuanceRaw from "../../../server/agent/fixtures/nuance.jsonl?raw"
import { cn } from "cn"

/** ?gallery&words — Claude's answer in its panel, as it reads now and with Octave's reading rules, at three sizes.
 *  The answer is a recorded real one (the nuance recording); the panel is as wide as it opens (about 233px). */

const nuance: SdkMessage[] = nuanceRaw.trim().split("\n").map((l) => JSON.parse(l))
const ANSWER = foldMessages(nuance).items.flatMap((i) => (i.kind === "text" ? [i.text] : []))
const QUESTION = "¶4의 'unusually communicative in a reserved way'는 어떤 뉘앙스야? 어떻게 옮기면 좋을까?"
const PLUGINS = { cjk }

// as the panel draws it now (Thread.tsx)
const NOW = "space-y-2 [&_:is(h1,h2,h3,h4)]:mt-3 [&_:is(h1,h2,h3,h4)]:mb-1 [&_:is(h1,h2,h3,h4)]:text-sm [&_:is(h1,h2,h3,h4)]:font-semibold"

// Octave's rules (its styles: 16px apart, headings 1.25em and 1.125em, 1.6em above them, list items 4px apart with
// the marker outside, a quote not slanted) — none of which costs width
const PROPOSED = cn(
  "space-y-4 [&_p]:text-pretty",
  "[&_:is(h1,h2,h3,h4)]:mt-[1.6em] [&_:is(h1,h2,h3,h4)]:mb-2 [&_:is(h1,h2,h3,h4)]:leading-snug",
  "[&_:is(h1,h2)]:text-[1.25em] [&_:is(h1,h2)]:font-bold [&_h3]:text-[1.125em] [&_h3]:font-semibold [&_h4]:text-[1em] [&_h4]:font-semibold",
  "[&_:is(ul,ol)]:list-outside [&_:is(ul,ol)]:pl-5 [&_li]:my-1 [&_li]:py-0 [&_li::marker]:text-muted-foreground",
  "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:not-italic",
)

const COLUMNS = [
  { key: "now", title: "지금", note: "14px · 문단 8px · 제목은 본문 크기 · 목록 점이 안쪽 · 인용 기울임", size: null },
  { key: "14", title: "제안 · 14px", note: "글자 크기는 그대로, 나머지만 Octave처럼", size: 14 },
  { key: "15", title: "제안 · 15px", note: "한 줄에 한 글자쯤 덜 들어간다", size: 15 },
  { key: "16", title: "제안 · 16px", note: "Octave의 크기. 한 줄에 두 글자쯤 덜 들어간다", size: 16 },
] as const

export function WordsGallery() {
  const [soft, setSoft] = useState(true)
  const [whole, setWhole] = useState(true)
  return (
    <div className="min-h-svh bg-background p-8 text-foreground">
      <h1 className="text-lg font-semibold">Claude 답의 가독성: 지금과 Octave의 읽기 규칙</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        실제 녹화된 답(¶4 뉘앙스)을 Claude 패널이 열리는 폭(약 233px)에 그렸다. 제안은 폭을 쓰지 않는 것만 바꾼다:
        문단 사이 16px, 제목을 조금 크게·위를 넉넉히, 목록 점을 바깥으로, 인용을 기울이지 않게, 줄 끝 다듬기, 글자 선명하게.
        글자 크기만 14·15·16px로 나란히.
      </p>
      <label className="mt-4 flex w-fit items-center gap-2 text-sm">
        <Checkbox checked={soft} onCheckedChange={(v) => setSoft(v === true)} />
        제안에 부드러운 검정(Octave의 글자색)
      </label>
      <label className="mt-2 flex w-fit items-center gap-2 text-sm">
        <Checkbox checked={whole} onCheckedChange={(v) => setWhole(v === true)} />
        제안에 한국어 단어를 줄 끝에서 끊지 않기(keep-all, 한국어 웹 글의 표준. Octave에는 없다)
      </label>
      <div className="mt-6 flex items-start gap-6 overflow-x-auto pb-8">
        {COLUMNS.map((c) => (
          <section key={c.key} data-column={c.key} className="w-[233px] shrink-0">
            <h2 className="text-sm font-medium">{c.title}</h2>
            <p className="h-10 text-xs/relaxed text-muted-foreground">{c.note}</p>
            <div className="mt-2 flex flex-col gap-5 rounded-md border p-3">
              <Message align="end">
                <MessageContent>
                  <Bubble align="end" variant="muted">
                    <BubbleContent className="text-sm/relaxed"><p lang="ko">{QUESTION}</p></BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
              <Message>
                <MessageContent className="gap-3">
                  {ANSWER.map((text, i) =>
                    c.size === null ? (
                      <div key={i} lang="ko" className="text-sm/relaxed">
                        <Streamdown className={NOW} plugins={PLUGINS} mode="static">{text}</Streamdown>
                      </div>
                    ) : (
                      <div key={i} lang="ko" className={cn("leading-[1.625] antialiased", whole && "break-keep [overflow-wrap:anywhere]")}
                        style={{ fontSize: c.size, ...(soft && { color: "oklch(0.24 0 0)" }) }}>
                        <Streamdown className={PROPOSED} plugins={PLUGINS} mode="static">{text}</Streamdown>
                      </div>
                    ),
                  )}
                </MessageContent>
              </Message>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
