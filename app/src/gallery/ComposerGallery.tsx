import { useState } from "react"
import { IconArrowUp, IconChevronDown } from "@tabler/icons-react"

import { Checkbox } from "@/components/ui/checkbox"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Pointed } from "@/features/agent/Pointed"
import { cn } from "cn"

/** ?gallery&composer — where the words of Claude's box start, against the model button under them. The box as the
 *  app draws it (Composer.tsx), with only the side gutters and the button's trim changed. */
const VARIANTS = [
  { key: "now", title: "지금", note: "글자 9px, 모델 버튼 글자 18px: 버튼의 안쪽 여백만큼 들어가 보인다", gutter: 2, trim: false },
  { key: "12", title: "A · 12px", note: "좌우 여백 12px(shadcn 기본 입력창). 모델 버튼은 자기 여백만큼 당겨 글자를 맞춘다", gutter: 3, trim: true },
  { key: "16", title: "B · 16px", note: "좌우 여백 16px. 버튼의 회색 배경과 테두리 사이가 아래 간격(8px)과 같다", gutter: 4, trim: true },
] as const

// literal class names, so Tailwind sees them
const GUTTER = {
  2: { area: "px-2", addon: "px-2" },
  3: { area: "px-3", addon: "px-3" },
  4: { area: "px-4", addon: "px-4" },
} as const

const TEXT = "이 문장의 뉘앙스를 살리려면 어떻게 옮기는 게 좋을까?"

export function ComposerGallery() {
  const [guide, setGuide] = useState(true)
  return (
    <div className="min-h-svh bg-background p-8 text-foreground">
      <h1 className="text-lg font-semibold">Claude 입력창의 좌우 여백</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        테두리가 보이는 것(구절 칩, 보내기 버튼)은 상자를, 테두리 없는 것(모델 버튼)은 글자를 입력창 글자의 시작선에 맞춘다.
        shadcn의 InputGroup이 입력창 옆 버튼에 이미 하는 일(<code>has-[&gt;button]:ml-[-0.275rem]</code>)을 아래 줄에도.
        폭은 Claude 패널과 비슷한 300px.
      </p>
      <label className="mt-4 flex w-fit items-center gap-2 text-sm">
        <Checkbox checked={guide} onCheckedChange={(v) => setGuide(v === true)} />
        기준선(입력창 글자의 시작) 보기
      </label>
      <div className="mt-6 flex flex-wrap gap-10">
        {VARIANTS.map((v) => (
          <section key={v.key} data-variant={v.key} className="w-[300px] space-y-3">
            <div>
              <h2 className="text-sm font-medium">{v.title}</h2>
              <p className="text-xs/relaxed text-muted-foreground">{v.note}</p>
            </div>
            <Caption>빈 입력창</Caption>
            <Box gutter={v.gutter} trim={v.trim} guide={guide} />
            <Caption>가리킨 구절과 글</Caption>
            <Box gutter={v.gutter} trim={v.trim} guide={guide} pointed text={TEXT} />
            <Caption>모델 버튼에 마우스를 올렸을 때</Caption>
            <Box gutter={v.gutter} trim={v.trim} guide={guide} hovered />
          </section>
        ))}
      </div>
    </div>
  )
}

const Caption = ({ children }: { children: React.ReactNode }) => <p className="text-xs text-muted-foreground">{children}</p>

function Box({ gutter, trim, guide, pointed, text, hovered }: {
  gutter: 2 | 3 | 4; trim: boolean; guide: boolean; pointed?: boolean; text?: string; hovered?: boolean
}) {
  const g = GUTTER[gutter]
  return (
    <div className="relative">
      <InputGroup>
        {pointed && (
          <InputGroupAddon align="block-start" className={g.addon}>
            <Pointed pointed={{ segmentId: 36, side: "source", quote: "unusually communicative in a reserved way" }} onRemove={() => {}} />
          </InputGroupAddon>
        )}
        <InputGroupTextarea aria-label="Message to Claude" placeholder="Ask Claude about this chapter…" defaultValue={text}
          className={cn("min-h-14 text-sm/relaxed md:text-sm/relaxed", g.area)} lang="ko" />
        <InputGroupAddon align="block-end" className={cn("pt-1", g.addon)}>
          {/* the button's border (1px) and padding (8px): pulled out by both, its words start where the box's do */}
          <InputGroupButton size="sm" variant="ghost" data-model
            className={cn("text-muted-foreground", trim && "-ml-2.25", hovered && "bg-muted text-foreground")}>
            Opus 5.5 · medium<IconChevronDown data-icon="inline-end" />
          </InputGroupButton>
          <InputGroupButton type="button" size="icon-sm" variant="default" className="ml-auto" aria-label="Send" disabled={!text}>
            <IconArrowUp />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {guide && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-dashed border-red-500/70" style={{ left: 1 + gutter * 4 }} />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-dashed border-red-500/70" style={{ right: 1 + gutter * 4 }} />
        </>
      )}
    </div>
  )
}
