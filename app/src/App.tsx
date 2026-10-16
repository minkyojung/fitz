import { useState } from "react"

import { AppShell, type Mode } from "@/layout/AppShell"

function Placeholder({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{label}</div>
}

export function App() {
  const [mode, setMode] = useState<Mode>("review")
  return (
    <AppShell
      mode={mode}
      onModeChange={setMode}
      sidebar={<Placeholder label="장 목록" />}
      left={<Placeholder label="원서 페이지 이미지" />}
      right={<Placeholder label="세그먼트" />}
      panel={<Placeholder label="댓글 · 주석 · 용어집" />}
      status={
        <>
          <span>장 —</span>
          <span>확인 0 / 0</span>
          <span>미연결 미주 0</span>
        </>
      }
    />
  )
}

export default App
