import { Button } from "@/components/ui/button"

const SOURCE =
  "Sam Zemurray arrived in America in 1891, a tall, gaunt boy of fourteen with nothing but the clothes on his back. Within a decade he was buying “ripes,” bananas too mature for the big companies to bother with, and selling them from a boxcar before they spoiled."
const TARGET =
  "샘 제무레이는 1891년, 입고 있던 옷가지 말고는 아무것도 없는 열네 살의 키 크고 야윈 소년으로 미국에 도착했다. 십 년이 채 지나기 전에 그는 큰 회사들이 거들떠보지 않는 너무 익은 바나나, 이른바 ‘라이프’를 사들여 상하기 전에 화물칸에서 팔아 치우고 있었다."

export function App() {
  return (
    <div className="flex min-h-svh flex-col gap-6 p-8">
      <header className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">타이포 견본</span>
        <span>UI 12px · 본문 16px</span>
        <span className="tabular-nums">p. 142 / 1,480매</span>
        <Button size="sm" variant="outline">버튼</Button>
        <span className="ml-auto"><kbd>d</kbd> 다크 모드</span>
      </header>
      <div className="grid grid-cols-2 gap-10">
        <section className="reading" lang="en">
          <h2 className="mb-3 font-semibold">Ripes</h2>
          <p>{SOURCE}</p>
          <p className="mt-4">
            He read <em>The Fruit Dispatch</em> every morning. <span className="bg-mark-term">United Fruit</span> was the{" "}
            <span className="bg-mark-comment">Octopus</span>, and he meant to swallow it.
          </p>
        </section>
        <section className="reading" lang="ko">
          <h2 className="mb-3 font-semibold">라이프</h2>
          <p>{TARGET}</p>
          <p className="mt-4">
            그는 매일 아침 <em>프루트 디스패치</em>를 읽었다. <span className="bg-mark-term">유나이티드 프루트</span>는{" "}
            <span className="bg-mark-comment">문어</span>였고, 그는 그것을 삼킬 작정이었다.
            <sup className="bg-mark-note px-0.5">1</sup>
            <span className="bg-mark-italic">이탤릭 후보</span> <span className="bg-mark-warning">미연결 미주</span>
          </p>
        </section>
      </div>
    </div>
  )
}

export default App
