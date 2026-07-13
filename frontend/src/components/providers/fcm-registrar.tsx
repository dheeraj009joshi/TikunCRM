"use client"

/**
 * Keeps FCM push tokens registered for the logged-in user on every dashboard visit.
 * Required so incoming-call pushes work when the CRM tab is backgrounded.
 */
import { useFCMNotifications } from "@/hooks/use-fcm-notifications"

export function FcmRegistrar() {
  useFCMNotifications()
  return null
}
