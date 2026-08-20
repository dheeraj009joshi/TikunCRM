"use client"

import * as React from "react"

interface AiCopilotContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

const AiCopilotContext = React.createContext<AiCopilotContextValue | null>(null)

export function AiCopilotProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)

  const toggle = React.useCallback(() => {
    setOpen((v) => !v)
  }, [])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Shift + J — open Tikun Copilot (avoid clash with ⌘K search)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === "Escape") {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const value = React.useMemo(
    () => ({ open, setOpen, toggle }),
    [open, toggle]
  )

  return (
    <AiCopilotContext.Provider value={value}>{children}</AiCopilotContext.Provider>
  )
}

export function useAiCopilot() {
  const ctx = React.useContext(AiCopilotContext)
  if (!ctx) {
    throw new Error("useAiCopilot must be used within AiCopilotProvider")
  }
  return ctx
}

export function useAiCopilotOptional() {
  return React.useContext(AiCopilotContext)
}
