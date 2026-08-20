"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useAiCopilot } from "@/contexts/ai-copilot-context"

/** Legacy /assistant route — opens Copilot panel and returns to dashboard. */
export default function AssistantRedirectPage() {
  const router = useRouter()
  const { setOpen } = useAiCopilot()

  React.useEffect(() => {
    setOpen(true)
    router.replace("/dashboard")
  }, [router, setOpen])

  return null
}
