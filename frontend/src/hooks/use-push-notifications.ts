"use client"

import { useState, useEffect, useCallback } from "react"
import apiClient from "@/lib/api-client"

interface PushSubscriptionState {
  isSupported: boolean
  isSubscribed: boolean
  isLoading: boolean
  error: string | null
  permission: NotificationPermission | null
}

interface UsePushNotificationsReturn extends PushSubscriptionState {
  subscribe: () => Promise<boolean>
  unsubscribe: () => Promise<boolean>
  requestPermission: () => Promise<NotificationPermission>
}

// Get VAPID public key from environment or backend
async function getVapidPublicKey(): Promise<string | null> {
  try {
    // Try to get from environment first
    const envKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (envKey) return envKey
    
    // Otherwise fetch from backend
    const response = await apiClient.get("/push/vapid-public-key")
    return response.data.public_key
  } catch (error) {
    console.error("[Push] Failed to get VAPID key:", error)
    return null
  }
}

// Convert base64 string to Uint8Array for push subscription
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  
  return outputArray
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const [state, setState] = useState<PushSubscriptionState>({
    isSupported: false,
    isSubscribed: false,
    isLoading: true,
    error: null,
    permission: null,
  })

  // Check support and current subscription status
  useEffect(() => {
    async function checkStatus() {
      // Check if push is supported
      const isSupported = 
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window

      if (!isSupported) {
        setState({
          isSupported: false,
          isSubscribed: false,
          isLoading: false,
          error: "Push notifications are not supported in this browser",
          permission: null,
        })
        return
      }

      try {
        const permission = Notification.permission
        
        // Check if already subscribed
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        
        setState({
          isSupported: true,
          isSubscribed: !!subscription,
          isLoading: false,
          error: null,
          permission,
        })
      } catch (error) {
        setState({
          isSupported: true,
          isSubscribed: false,
          isLoading: false,
          error: "Failed to check subscription status",
          permission: Notification.permission,
        })
      }
    }

    checkStatus()
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
      console.error("[Push] Permission request failed:", error)
      return "denied"
    }
  }, [state.isSupported])

  // Subscribe to push notifications
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported) {
      setState((prev) => ({ ...prev, error: "Push notifications not supported" }))
      return false
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }))

    try {
      // Request permission if not granted
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

      // Get VAPID public key
      const vapidPublicKey = await getVapidPublicKey()
      if (!vapidPublicKey) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: "Push notifications not configured on server",
        }))
        return false
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready

      // Subscribe to push (cast needed: Uint8Array is valid BufferSource at runtime)
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      })

      // Send subscription to backend
      console.log("[Push] Sending subscription to backend:", subscription.toJSON())
      const response = await apiClient.post("/push/subscribe", {
        subscription: subscription.toJSON(),
      })
      console.log("[Push] Backend response:", response.data)

      setState((prev) => ({
        ...prev,
        isSubscribed: true,
        isLoading: false,
        error: null,
      }))

      console.log("[Push] Successfully subscribed to push notifications")
      return true
    } catch (error: any) {
      console.error("[Push] Subscription failed:", error)
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error.message || "Failed to subscribe to push notifications",
      }))
      return false
    }
  }, [state.isSupported, requestPermission])

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }))

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()

      if (subscription) {
        // Unsubscribe from push manager
        await subscription.unsubscribe()

        // Remove subscription from backend
        await apiClient.post("/push/unsubscribe", {
          endpoint: subscription.endpoint,
        })
      }

      setState((prev) => ({
        ...prev,
        isSubscribed: false,
        isLoading: false,
        error: null,
      }))

      console.log("[Push] Successfully unsubscribed from push notifications")
      return true
    } catch (error: any) {
      console.error("[Push] Unsubscribe failed:", error)
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error.message || "Failed to unsubscribe from push notifications",
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
