import * as React from "react"
import { cn } from "cn"

// each cell lights (column + |row − 1|) × 90ms after the first: a ">" moving right, and on a 650ms cycle two are
// always in flight
const DELAYS = Array.from({ length: 9 }, (_, i) => ((i % 3) + Math.abs(Math.floor(i / 3) - 1)) * 90)

/** Work under way, as a 3×3 grid of pixels a wave runs through (docs/agent.md §26). Opacity only, in the text's
 *  colour; with reduced motion it rests dim. Decorative: what is going on is said in words beside it. */
function PixelLoader({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span data-slot="pixel-loader" aria-hidden className={cn("grid grid-cols-[repeat(3,4px)] gap-px", className)} {...props}>
      {DELAYS.map((delay, i) => (
        <span key={i} style={{ animationDelay: `${delay}ms` }}
          className="size-1 rounded-[1px] bg-current opacity-20 animate-[pixel-on_650ms_ease-in-out_infinite] motion-reduce:animate-none" />
      ))}
    </span>
  )
}

export { PixelLoader }
