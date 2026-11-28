import { useCallback, useState } from "react"

import { AppSidebar, type Stage } from "@/components/app-sidebar"
import { ChapterView } from "@/components/chapter-view"
import { LoadError } from "@/components/load-error"
import { ReviewView } from "@/components/review-view"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { hello, request } from "@/data/api"
import { useBookUndo } from "@/hooks/use-book-undo"
import { useLoad } from "@/hooks/use-load"

export function App() {
  // The book changed (a save, an undo): everything on screen is asked for again. The server holds the book; the page
  // holds only what it was last told.
  const [changes, setChanges] = useState(0)
  const bookChanged = useCallback(() => setChanges((n) => n + 1), [])
  useBookUndo(bookChanged)
  // hello first: a server of another protocol is asked nothing else
  const loaded = useLoad("book", async (signal) => {
    await hello(signal)
    const [book, chapters, pages] = await Promise.all([request("getBook", {}, signal), request("listChapters", {}, signal), request("listPages", {}, signal)])
    return { book, chapters, pages }
  }, changes)
  const [stage, setStage] = useState<Stage>("translate")
  const [pickedId, setPickedId] = useState<number | null>(null)
  // the page the review screen opens on, when the chapter was reached by turning the scan past the last one's end
  const [arrivalPage, setArrivalPage] = useState<number | null>(null)

  if (loaded.status === "loading") return <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">Opening the book…</div>
  if (loaded.status === "error") return <div className="flex min-h-svh items-center justify-center p-6"><LoadError what="The book could not be opened" error={loaded.error} retry={loaded.retry} /></div>

  const { book, chapters, pages } = loaded.data
  const chapter = chapters.find((c) => c.id === pickedId) ?? chapters[0]

  return (
    <SidebarProvider>
      <title>{book.title}</title>
      <AppSidebar
        book={book}
        stage={stage}
        onStage={setStage}
        chapters={chapters}
        selectedId={chapter?.id ?? null}
        onPick={(id) => {
          setPickedId(id)
          setArrivalPage(null)
          window.scrollTo({ top: 0 })
        }}
      />
      {/* in review the scan and the list scroll each on their own, within the window */}
      <SidebarInset className={stage === "review" ? "h-svh overflow-hidden md:h-[calc(100svh-1rem)]" : undefined}>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">{book.title}</BreadcrumbItem>
                {chapter && (
                  <>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{chapter.title}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        {chapter && stage === "review" ? (
          <ReviewView
            key={chapter.id}
            chapter={chapter}
            chapters={chapters}
            pages={pages}
            arrivalPage={arrivalPage}
            changes={changes}
            onChanged={bookChanged}
            onChapter={(id, pageNo) => {
              setPickedId(id)
              setArrivalPage(pageNo)
            }}
          />
        ) : chapter ? (
          <ChapterView key={chapter.id} chapter={chapter} changes={changes} onChanged={bookChanged} />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">This book has no chapters.</p>
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
