"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { MessagePayload } from "firebase/messaging"
import apiClient from "@/lib/api-client"
import {
  isFirebaseConfigured,
  getFCMToken,
  onForegroundMessage,
} from "@/lib/firebase"
import { canUseWebPush, getIOSPushRequirementMessage } from "@/lib/pwa-utils"
import { withTimeout } from "@/lib/with-timeout"

interface FCMState {
  isSupported: boolean
  isSubscribed: boolean
  isLoading: boolean
  error: string | null
  permission: NotificationPermission | null
}

interface UseFCMNotificationsReturn extends FCMState {
  subscribe: () => Promise<boolean>
  unsubscribe: () => Promise<boolean>
  requestPermission: () => Promise<NotificationPermission>
}

const TOKEN_REGISTER_TIMEOUT_MS = 20_000
const API_REGISTER_TIMEOUT_MS = 15_000

// Shared across hook instances (FcmRegistrar + PushNotificationToggle on same page)
let autoRegisterPromise: Promise<boolean> | null = null
let sharedForegroundHandler: (() => void) | null = null

/**
 * Hook for managing Firebase Cloud Messaging (FCM) push notifications
 * 
 * Simplified logic:
 * - On app load: If permission is granted, auto-register token with backend
 * - This ensures the token is always fresh (Firebase returns cached or new token)
 * - Multi-browser support: Each browser gets its own token
 */
export function useFCMNotifications(): UseFCMNotificationsReturn {
  const [state, setState] = useState<FCMState>({
    isSupported: false,
    isSubscribed: false,
    isLoading: true,
    error: null,
    permission: null,
  })

  const initRef = useRef(false)

  // Initialize on mount - auto-register token if permission is granted
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    
    initializeFCM()
  }, [])

  async function initializeFCM() {
    try {
      if (typeof window === "undefined") {
        setState({
          isSupported: false,
          isSubscribed: false,
          isLoading: false,
          error: "Not running in browser",
          permission: null,
        })
        return
      }

      if (!isFirebaseConfigured()) {
        setState({
          isSupported: false,
          isSubscribed: false,
          isLoading: false,
          error: "Firebase is not configured",
          permission: null,
        })
        return
      }

      const iosRequirement = getIOSPushRequirementMessage()
      if (iosRequirement) {
        setState({
          isSupported: false,
          isSubscribed: false,
          isLoading: false,
          error: iosRequirement,
          permission: Notification.permission,
        })
        return
      }

      if (!canUseWebPush()) {
        setState({
          isSupported: false,
          isSubscribed: false,
          isLoading: false,
          error: "Push notifications are not supported in this browser",
          permission: null,
        })
        return
      }

      const permission = Notification.permission

      // Show UI immediately — token registration can hang on some iOS builds
      setState({
        isSupported: true,
        isSubscribed: false,
        isLoading: false,
        permission,
        error: null,
      })

      if (permission === "granted") {
        const subscribed = await autoRegisterTokenOnce()
        if (subscribed) {
          setState((prev) => ({ ...prev, isSubscribed: true }))
        }
      }
    } catch (error) {
      console.warn("[FCM] Initialization failed:", error)
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: prev.error || "Failed to initialize push notifications",
      }))
    }
  }

  // Request notification permission
  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!state.isSupported) {
      return "denied"
    }

    try {
      const permission = await Notification.requestPermission()
      setState((prev) => ({ ...prev, permission }))
      return permission
    } catch (error) {
      console.error("[FCM] Permission request failed:", error)
      return "denied"
    }
  }, [state.isSupported])

  // Subscribe to FCM notifications
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported) {
      setState((prev) => ({ ...prev, error: "FCM not supported" }))
      return false
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }))

    try {
      let permission = Notification.permission
      if (permission === "default") {
        permission = await requestPermission()
      }

      if (permission !== "granted") {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: "Notification permission denied",
        }))
        return false
      }

      const subscribed = await autoRegisterTokenOnce()
      if (!subscribed) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: "Failed to get FCM token. Try closing and reopening the app.",
        }))
        return false
      }

      setState((prev) => ({
        ...prev,
        isSubscribed: true,
        isLoading: false,
        permission,
        error: null,
      }))

      return true
    } catch (error: any) {
      console.error("[FCM] Subscription failed:", error)
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error.response?.data?.detail || error.message || "Failed to subscribe",
      }))
      return false
    }
  }, [state.isSupported, requestPermission])

  // Unsubscribe from FCM notifications
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }))

    try {
      const token = await withTimeout(
        getFCMToken(),
        TOKEN_REGISTER_TIMEOUT_MS,
        "FCM token request timed out"
      )
      if (token) {
        await withTimeout(
          apiClient.post("/push/fcm/unregister", { token }),
          API_REGISTER_TIMEOUT_MS,
          "FCM unregister API timed out"
        )
      }

      if (sharedForegroundHandler) {
        sharedForegroundHandler()
        sharedForegroundHandler = null
      }

      setState((prev) => ({
        ...prev,
        isSubscribed: false,
        isLoading: false,
        error: null,
      }))

      return true
    } catch (error: any) {
      console.error("[FCM] Unsubscribe failed:", error)
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error.response?.data?.detail || error.message || "Failed to unsubscribe",
      }))
      return false
    }
  }, [])

  return {
    ...state,
    subscribe,
    unsubscribe,
    requestPermission,
  }
}

async function autoRegisterTokenOnce(): Promise<boolean> {
  if (autoRegisterPromise) {
    return autoRegisterPromise
  }

  autoRegisterPromise = (async () => {
    try {
      const token = await withTimeout(
        getFCMToken(),
        TOKEN_REGISTER_TIMEOUT_MS,
        "FCM token request timed out"
      )
      if (!token) {
        return false
      }

      await withTimeout(
        apiClient.post("/push/fcm/register", {
          token,
          device_name: getDeviceName(),
        }),
        API_REGISTER_TIMEOUT_MS,
        "FCM register API timed out"
      )
      console.log("[FCM] Token auto-registered on app load")
      setupSharedForegroundHandler()
      return true
    } catch (error) {
      console.warn("[FCM] Auto-registration failed:", error)
      autoRegisterPromise = null
      return false
    }
  })()

  return autoRegisterPromise
}

function setupSharedForegroundHandler() {
  if (sharedForegroundHandler) return

  const unsub = onForegroundMessage((payload: MessagePayload) => {
    console.log("[FCM] Foreground message received:", payload)

    const notificationData = payload.notification || {}
    const data = payload.data || {}
    const type = data.type || ""

    if (type === "incoming_call" && typeof document !== "undefined" && !document.hidden) {
      return
    }

    const title = notificationData.title || data.title || "TikunCRM"
    const body = notificationData.body || data.body || "You have a new notification"
    const url = data.url || "/notifications"
    const icon = notificationData.icon || data.icon || "/brand/app-icon-192.png"
    const tag = data.tag || "tikuncrm-fcm"

    if (Notification.permission === "granted") {
      try {
        const notification = new Notification(title, {
          body,
          icon,
          badge: icon,
          tag,
          data: { url, type },
          requireInteraction: true,
        })

        notification.onclick = () => {
          window.focus()
          window.location.href = url
          notification.close()
        }
      } catch (err) {
        console.error("[FCM] Failed to show notification:", err)
      }
    }
  })

  if (unsub) {
    sharedForegroundHandler = unsub
  }
}

/**
 * Get a friendly device name for display
 */
function getDeviceName(): string {
  if (typeof window === "undefined") return "Unknown Device"

  const ua = navigator.userAgent
  let device = "Desktop"
  let browser = "Browser"

  if (/iPad/.test(ua)) device = "iPad"
  else if (/iPhone/.test(ua)) device = "iPhone"
  else if (/Android/.test(ua) && /Mobile/.test(ua)) device = "Android Phone"
  else if (/Android/.test(ua)) device = "Android Tablet"
  else if (/Macintosh/.test(ua)) device = "Mac"
  else if (/Windows/.test(ua)) device = "Windows PC"
  else if (/Linux/.test(ua)) device = "Linux PC"

  if (/Chrome/.test(ua) && !/Edg/.test(ua)) browser = "Chrome"
  else if (/Safari/.test(ua) && !/Chrome/.test(ua)) browser = "Safari"
  else if (/Firefox/.test(ua)) browser = "Firefox"
  else if (/Edg/.test(ua)) browser = "Edge"

  return `${device} (${browser})`
}

/**
 * Standalone function to register FCM token
 * Can be called from login flow or anywhere else
 */
export async function registerFCMToken(): Promise<boolean> {
  if (typeof window === "undefined") return false
  if (!isFirebaseConfigured()) return false
  if (!canUseWebPush()) return false
  
  if (Notification.permission !== "granted") {
    console.log("[FCM] Permission not granted, skipping token registration")
    return false
  }

  return autoRegisterTokenOnce()
}

export default useFCMNotifications
