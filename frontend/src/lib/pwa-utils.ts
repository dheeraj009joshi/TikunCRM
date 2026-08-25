const INSTALL_DISMISSED_KEY = "pwa_install_dismissed"
const NOTIFICATION_PROMPT_DISMISSED_KEY = "pwa_notification_prompt_dismissed"

export const PWA_INSTALL_DISMISSED_EVENT = "pwa-install-dismissed"

export function isStandalonePWA(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
}

export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false
  return /Android/.test(navigator.userAgent)
}

export function isMobileDevice(): boolean {
  return isIOS() || isAndroid()
}

export function canUseWebPush(): boolean {
  if (typeof window === "undefined") return false
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

export function wasInstallPromptDismissed(): boolean {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem(INSTALL_DISMISSED_KEY) === "true"
}

export function dismissInstallPrompt(): void {
  localStorage.setItem(INSTALL_DISMISSED_KEY, "true")
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PWA_INSTALL_DISMISSED_EVENT))
  }
}

export function wasNotificationPromptDismissed(): boolean {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem(NOTIFICATION_PROMPT_DISMISSED_KEY) === "true"
}

export function dismissNotificationPrompt(): void {
  localStorage.setItem(NOTIFICATION_PROMPT_DISMISSED_KEY, "true")
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export function isBeforeInstallPromptEvent(
  event: Event
): event is BeforeInstallPromptEvent {
  return "prompt" in event && "userChoice" in event
}
