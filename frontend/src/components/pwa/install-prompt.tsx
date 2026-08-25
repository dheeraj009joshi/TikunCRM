"use client"

import { useEffect, useState } from "react"
import { Download, Share, X, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  dismissInstallPrompt,
  isBeforeInstallPromptEvent,
  isIOS,
  isStandalonePWA,
  type BeforeInstallPromptEvent,
  wasInstallPromptDismissed,
} from "@/lib/pwa-utils"

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const [showIosHelp, setShowIosHelp] = useState(false)

  useEffect(() => {
    if (isStandalonePWA() || wasInstallPromptDismissed()) return

    if (isIOS()) {
      setShowIosHelp(true)
      setVisible(true)
      return
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      if (isBeforeInstallPromptEvent(event)) {
        setDeferredPrompt(event)
        setVisible(true)
      }
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall)

    const timer = window.setTimeout(() => {
      if (!isStandalonePWA() && !wasInstallPromptDismissed()) {
        setVisible(true)
      }
    }, 4000)

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall)
      window.clearTimeout(timer)
    }
  }, [])

  const handleDismiss = () => {
    dismissInstallPrompt()
    setVisible(false)
  }

  const handleInstall = async () => {
    if (!deferredPrompt) return

    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    setDeferredPrompt(null)

    if (choice.outcome === "accepted") {
      setVisible(false)
      dismissInstallPrompt()
    }
  }

  if (!visible || isStandalonePWA()) return null

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 md:bottom-6 md:left-auto md:right-6 md:max-w-sm">
      <div className="rounded-xl border border-border bg-card p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-sm">Install TikunCRM</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add to your home screen for push alerts and faster access,
                  even when the browser tab is closed.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDismiss}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Dismiss install prompt"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {showIosHelp ? (
              <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">On iPhone or iPad:</p>
                <ol className="list-decimal space-y-1 pl-4">
                  <li className="flex items-center gap-1">
                    Tap <Share className="inline h-3.5 w-3.5" /> Share in Safari
                  </li>
                  <li>Choose &quot;Add to Home Screen&quot;</li>
                  <li>Open TikunCRM from your home screen</li>
                </ol>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="mt-2 w-full"
                  onClick={handleDismiss}
                >
                  Got it
                </Button>
              </div>
            ) : deferredPrompt ? (
              <Button
                type="button"
                size="sm"
                className="mt-3 w-full"
                onClick={() => void handleInstall()}
              >
                <Download className="mr-2 h-4 w-4" />
                Install app
              </Button>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Use your browser menu and choose &quot;Install app&quot; or
                &quot;Add to Home Screen&quot;.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
