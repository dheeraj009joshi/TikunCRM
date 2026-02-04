"use client"

import { useState } from "react"
import { Bell, BellOff, Loader2, AlertCircle, Send } from "lucide-react"
import { usePushNotifications } from "@/hooks/use-push-notifications"
import apiClient from "@/lib/api-client"

interface PushNotificationToggleProps {
  showLabel?: boolean
  className?: string
  showTestButton?: boolean
}

export function PushNotificationToggle({ 
  showLabel = true,
  className = "",
  showTestButton = true
}: PushNotificationToggleProps) {
  const {
    isSupported,
    isSubscribed,
    isLoading,
    error,
    permission,
    browserInfo,
    subscribe,
    unsubscribe,
  } = usePushNotifications()
  
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ message: string; isError: boolean } | null>(null)

  if (!isSupported) {
    return (
      <div className={`space-y-2 ${className}`}>
        <div className="flex items-start gap-2 text-muted-foreground text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium">Push notifications not available</div>
            {error && <div className="text-xs mt-1">{error}</div>}
            {browserInfo?.isSafari && (
              <div className="text-xs mt-1 text-amber-600">
                For Safari, make sure you&apos;re on macOS Ventura (13.0) or later.
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  async function handleToggle() {
    if (isSubscribed) {
      await unsubscribe()
    } else {
      await subscribe()
    }
  }
  
  async function handleTestNotification() {
    setIsTesting(true)
    setTestResult(null)
    try {
      const response = await apiClient.post("/push/test")
      setTestResult({ 
        message: response.data.message || "Test notification sent! Check your notifications.", 
        isError: false 
      })
    } catch (err: any) {
      const errorMessage = err.response?.data?.detail || "Failed to send test notification"
      setTestResult({ message: errorMessage, isError: true })
      console.error("[Push] Test notification failed:", err)
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-4">
        {showLabel && (
          <div className="flex-1">
            <div className="font-medium text-sm">Push Notifications</div>
            <div className="text-xs text-muted-foreground">
              {isSubscribed 
                ? "Receive instant notifications on this device" 
                : "Enable notifications to stay updated"
              }
            </div>
            {error && (
              <div className="text-xs text-destructive mt-1">{error}</div>
            )}
            {permission === "denied" && (
              <div className="text-xs text-amber-600 mt-1">
                Notifications blocked. Please enable in browser settings.
              </div>
            )}
          </div>
        )}
        
        <button
          onClick={handleToggle}
          disabled={isLoading || permission === "denied"}
          className={`relative inline-flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
            isSubscribed
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title={isSubscribed ? "Disable notifications" : "Enable notifications"}
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isSubscribed ? (
            <Bell className="h-5 w-5" />
          ) : (
            <BellOff className="h-5 w-5" />
          )}
        </button>
      </div>
      
      {/* Test Notification Button */}
      {showTestButton && isSubscribed && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleTestNotification}
              disabled={isTesting}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-muted hover:bg-muted/80 rounded-md transition-colors disabled:opacity-50"
            >
              {isTesting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send Test Notification
            </button>
          </div>
          {testResult && (
            <div className={`text-xs ${testResult.isError ? "text-destructive" : "text-green-600"}`}>
              {testResult.message}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            If you don&apos;t see the notification, check that notifications are allowed in your browser/system settings.
          </div>
        </div>
      )}
    </div>
  )
}

// Compact version for header/sidebar
export function PushNotificationButton() {
  const {
    isSupported,
    isSubscribed,
    isLoading,
    subscribe,
    unsubscribe,
  } = usePushNotifications()

  if (!isSupported) return null

  async function handleClick() {
    if (isSubscribed) {
      await unsubscribe()
    } else {
      await subscribe()
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className={`p-2 rounded-lg transition-colors ${
        isSubscribed
          ? "text-primary hover:bg-primary/10"
          : "text-muted-foreground hover:bg-muted"
      }`}
      title={isSubscribed ? "Push notifications enabled" : "Enable push notifications"}
    >
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : isSubscribed ? (
        <Bell className="h-5 w-5" />
      ) : (
        <BellOff className="h-5 w-5" />
      )}
    </button>
  )
}
