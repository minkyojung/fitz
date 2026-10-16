import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { Gallery } from "./gallery/Gallery.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light">
      <TooltipProvider>
        {location.search.includes("gallery") ? <Gallery /> : <App />}
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
)
