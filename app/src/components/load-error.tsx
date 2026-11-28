import { Button } from "@/components/ui/button"

/** Something that could not be loaded: what, why, and a way to try again. */
export function LoadError({ what, error, retry }: { what: string; error: Error; retry: () => void }) {
  return (
    <div role="alert" className="flex max-w-prose flex-col items-start gap-3 text-sm">
      <p className="font-medium">{what}</p>
      <p className="text-muted-foreground">{error.message}</p>
      <Button variant="outline" size="sm" onClick={retry}>
        Try again
      </Button>
    </div>
  )
}
