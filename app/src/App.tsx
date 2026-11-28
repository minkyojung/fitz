import { useState } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { ChapterView } from "@/components/chapter-view"
import { LoadError } from "@/components/load-error"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { hello, request } from "@/data/api"
import { useLoad } from "@/hooks/use-load"

export function App() {
  // hello first: a server of another protocol is asked nothing else
  const loaded = useLoad("book", async (signal) => {
    await hello(signal)
    const [book, chapters] = await Promise.all([request("getBook", {}, signal), request("listChapters", {}, signal)])
    return { book, chapters }
  })
  const [pickedId, setPickedId] = useState<number | null>(null)

  if (loaded.status === "loading") return <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">Opening the book…</div>
  if (loaded.status === "error") return <div className="flex min-h-svh items-center justify-center p-6"><LoadError what="The book could not be opened" error={loaded.error} retry={loaded.retry} /></div>

  const { book, chapters } = loaded.data
  const chapter = chapters.find((c) => c.id === pickedId) ?? chapters[0]

  return (
    <SidebarProvider>
      <title>{book.title}</title>
      <AppSidebar
        book={book}
        chapters={chapters}
        selectedId={chapter?.id ?? null}
        onPick={(id) => {
          setPickedId(id)
          window.scrollTo({ top: 0 })
        }}
      />
      <SidebarInset>
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
        {chapter ? (
          <ChapterView key={chapter.id} chapter={chapter} />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">This book has no chapters.</p>
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
