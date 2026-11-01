import { StrictMode, Suspense, lazy } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"

// the design galleries, and what only they pull in, load only when one is opened
const Gallery = lazy(() => import("./gallery/Gallery.tsx").then((m) => ({ default: m.Gallery })))

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light">
      <TooltipProvider>
        {location.search.includes("gallery") ? <Suspense fallback={null}><Gallery /></Suspense> : <App />}
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
)
