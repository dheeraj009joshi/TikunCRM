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
    subscribe,
    unsubscribe,
  } = usePushNotifications()
  
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  if (!isSupported) {
    return (
      <div className={`flex items-center gap-2 text-muted-foreground text-sm ${className}`}>
        <AlertCircle className="h-4 w-4" />
        <span>Push notifications not supported</span>
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
      setTestResult(response.data.message || "Test notification sent!")
    } catch (err: any) {
      setTestResult(err.response?.data?.detail || "Failed to send test notification")
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
          {testResult && (
            <span className="text-xs text-muted-foreground">{testResult}</span>
          )}
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
