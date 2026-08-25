"use client"

import { useEffect, useState } from "react"
import { Bell, Phone, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useFCMNotifications } from "@/hooks/use-fcm-notifications"
import {
  canUseWebPush,
  dismissNotificationPrompt,
  isMobileDevice,
  isStandalonePWA,
  PWA_INSTALL_DISMISSED_EVENT,
  wasInstallPromptDismissed,
  wasNotificationPromptDismissed,
} from "@/lib/pwa-utils"

export function NotificationPermissionPrompt() {
  const { isSupported, isSubscribed, isLoading, subscribe } = useFCMNotifications()
  const [open, setOpen] = useState(false)
  const [isEnabling, setIsEnabling] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (wasNotificationPromptDismissed()) return
    if (!canUseWebPush()) return
    if (Notification.permission !== "default") return

    const maybeShowPrompt = () => {
      if (wasNotificationPromptDismissed()) return
      if (Notification.permission !== "default") return

      const installStillPending =
        isMobileDevice() &&
        !isStandalonePWA() &&
        !wasInstallPromptDismissed()

      if (installStillPending) return

      if (isSupported && !isSubscribed && !isLoading) {
        setOpen(true)
      }
    }

    const timer = window.setTimeout(maybeShowPrompt, 2500)
    window.addEventListener(PWA_INSTALL_DISMISSED_EVENT, maybeShowPrompt)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener(PWA_INSTALL_DISMISSED_EVENT, maybeShowPrompt)
    }
  }, [isSupported, isSubscribed, isLoading])

  useEffect(() => {
    if (isSubscribed) {
      setOpen(false)
    }
  }, [isSubscribed])

  const handleDismiss = () => {
    dismissNotificationPrompt()
    setOpen(false)
  }

  const handleEnable = async () => {
    setIsEnabling(true)
    try {
      const ok = await subscribe()
      if (ok) {
        dismissNotificationPrompt()
        setOpen(false)
      }
    } finally {
      setIsEnabling(false)
    }
  }

  if (!isSupported || isSubscribed) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" hideCloseButton>
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Bell className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center">
            Enable push notifications
          </DialogTitle>
          <DialogDescription className="text-center">
            Get instant alerts for new leads, follow-ups, and incoming calls —
            even when TikunCRM is in the background
            {isStandalonePWA() ? "" : " or not open"}.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            New leads and appointment reminders
          </li>
          <li className="flex items-start gap-2">
            <Phone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            Incoming call alerts with Accept action
          </li>
        </ul>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            type="button"
            className="w-full"
            onClick={() => void handleEnable()}
            disabled={isEnabling || isLoading}
          >
            {isEnabling ? "Enabling..." : "Enable notifications"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={handleDismiss}
          >
            <X className="mr-2 h-4 w-4" />
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
