"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { MessagePayload } from "firebase/messaging"
import apiClient from "@/lib/api-client"
import {
  isFirebaseConfigured,
  getFCMToken,
  onForegroundMessage,
} from "@/lib/firebase"

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

  const foregroundHandlerRef = useRef<(() => void) | null>(null)
  const initRef = useRef(false)

  // Initialize on mount - auto-register token if permission is granted
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    
    initializeFCM()
  }, [])

  async function initializeFCM() {
    // Check basic requirements
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

    // Check if Firebase is configured
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

    // Check browser support
    const hasSupport = 
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window

    if (!hasSupport) {
      setState({
        isSupported: false,
        isSubscribed: false,
        isLoading: false,
        error: "Push notifications are not supported in this browser",
        permission: null,
      })
      return
    }

    // Check current permission
    const permission = Notification.permission
    
    // If permission is granted, auto-register token
    // This ensures we always have a fresh token on app load
    if (permission === "granted") {
      try {
        const token = await getFCMToken()
        if (token) {
          // Register token with backend (backend handles deduplication)
          await apiClient.post("/push/fcm/register", {
            token,
            device_name: getDeviceName(),
          })
          console.log("[FCM] Token auto-registered on app load")
          
          // Set up foreground handler
          setupForegroundHandler()
          
          setState({
            isSupported: true,
            isSubscribed: true,
            isLoading: false,
            permission,
            error: null,
          })
          return
        }
      } catch (error) {
        console.warn("[FCM] Auto-registration failed:", error)
        // Continue with isSubscribed = false
      }
    }

    // Permission not granted or token failed - just set state
    setState({
      isSupported: true,
      isSubscribed: false,
      isLoading: false,
      permission,
      error: null,
    })
  }

  // Set up foreground message handler
  function setupForegroundHandler() {
    if (foregroundHandlerRef.current) return

    const unsub = onForegroundMessage((payload: MessagePayload) => {
      console.log("[FCM] Foreground message received:", payload)
      
      // Handle both notification+data and data-only payloads
      const notificationData = payload.notification || {}
      const data = payload.data || {}
      
      const title = notificationData.title || data.title || "TikunCRM"
      const body = notificationData.body || data.body || "You have a new notification"
      const url = data.url || "/notifications"
      const icon = notificationData.icon || data.icon || "/icon.svg"
      const tag = data.tag || "tikuncrm-fcm"

      // Show notification
      if (Notification.permission === "granted") {
        try {
          const notification = new Notification(title, {
            body,
            icon,
            badge: icon,
            tag,
            data: { url },
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
      foregroundHandlerRef.current = unsub
    }
  }

  // Cleanup foreground handler on unmount
  useEffect(() => {
    return () => {
      if (foregroundHandlerRef.current) {
        foregroundHandlerRef.current()
        foregroundHandlerRef.current = null
      }
    }
  }, [])

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
      // Request permission if needed
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

      // Get FCM token
      const token = await getFCMToken()
      if (!token) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: "Failed to get FCM token",
        }))
        return false
      }

      // Set up foreground handler
      setupForegroundHandler()

      // Register token with backend
      await apiClient.post("/push/fcm/register", {
        token,
        device_name: getDeviceName(),
      })
      console.log("[FCM] Token registered via subscribe()")

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
      // Get current token and unregister from backend
      const token = await getFCMToken()
      if (token) {
        await apiClient.post("/push/fcm/unregister", { token })
      }

      // Clean up foreground handler
      if (foregroundHandlerRef.current) {
        foregroundHandlerRef.current()
        foregroundHandlerRef.current = null
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

/**
 * Get a friendly device name for display
 */
function getDeviceName(): string {
  if (typeof window === "undefined") return "Unknown Device"

  const ua = navigator.userAgent
  let device = "Desktop"
  let browser = "Browser"

  // Detect device type
  if (/iPad/.test(ua)) device = "iPad"
  else if (/iPhone/.test(ua)) device = "iPhone"
  else if (/Android/.test(ua) && /Mobile/.test(ua)) device = "Android Phone"
  else if (/Android/.test(ua)) device = "Android Tablet"
  else if (/Macintosh/.test(ua)) device = "Mac"
  else if (/Windows/.test(ua)) device = "Windows PC"
  else if (/Linux/.test(ua)) device = "Linux PC"

  // Detect browser
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
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false
  
  // Only proceed if permission is already granted
  if (Notification.permission !== "granted") {
    console.log("[FCM] Permission not granted, skipping token registration")
    return false
  }

  try {
    const token = await getFCMToken()
    if (token) {
      await apiClient.post("/push/fcm/register", {
        token,
        device_name: getDeviceName(),
      })
      console.log("[FCM] Token registered successfully")
      return true
    }
  } catch (error) {
    console.error("[FCM] Token registration failed:", error)
  }
  return false
}

export default useFCMNotifications
