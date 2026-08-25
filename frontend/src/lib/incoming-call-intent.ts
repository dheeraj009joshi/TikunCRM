/**
 * Persists "open/accept incoming call from push notification" across cold starts.
 * Service worker may postMessage before React mounts; URL + sessionStorage bridge the gap.
 */

const STORAGE_KEY = "tikuncrm_incoming_call_intent"
const INTENT_TTL_MS = 60_000

export interface IncomingCallIntent {
  autoAccept: boolean
  callSid?: string
  leadId?: string
  createdAt: number
}

export function saveIncomingCallIntent(intent: Omit<IncomingCallIntent, "createdAt">): void {
  if (typeof sessionStorage === "undefined") return
  const payload: IncomingCallIntent = {
    ...intent,
    createdAt: Date.now(),
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function clearIncomingCallIntent(): void {
  if (typeof sessionStorage === "undefined") return
  sessionStorage.removeItem(STORAGE_KEY)
}

export function readIncomingCallIntent(): IncomingCallIntent | null {
  if (typeof window === "undefined") return null

  // URL params win (set by service worker on openWindow)
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get("incoming_call") === "1") {
      const intent: IncomingCallIntent = {
        autoAccept: params.get("auto_accept") === "1",
        callSid: params.get("call_sid") || undefined,
        leadId: params.get("lead_id") || undefined,
        createdAt: Date.now(),
      }
      saveIncomingCallIntent(intent)
      // Clean query so refresh doesn't re-trigger forever
      params.delete("incoming_call")
      params.delete("auto_accept")
      params.delete("call_sid")
      params.delete("lead_id")
      const qs = params.toString()
      const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`
      window.history.replaceState({}, "", next)
      return intent
    }
  } catch {
    /* ignore */
  }

  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as IncomingCallIntent
    if (!parsed?.createdAt || Date.now() - parsed.createdAt > INTENT_TTL_MS) {
      clearIncomingCallIntent()
      return null
    }
    return parsed
  } catch {
    clearIncomingCallIntent()
    return null
  }
}

/** Build absolute CRM URL for clients.openWindow (relative URLs are unreliable). */
export function buildIncomingCallOpenUrl(opts: {
  baseUrl?: string
  path?: string
  autoAccept?: boolean
  callSid?: string
  leadId?: string
}): string {
  const origin =
    opts.baseUrl ||
    (typeof self !== "undefined" && "location" in self
      ? self.location.origin
      : "")
  const path = opts.path && opts.path.startsWith("/") ? opts.path : "/dashboard"
  // Prefer dashboard so Softphone always mounts; lead deep-link can confuse cold start
  const openPath =
    path.startsWith("/leads/") || path === "/" || path === "/notifications"
      ? "/dashboard"
      : path
  const params = new URLSearchParams()
  params.set("incoming_call", "1")
  if (opts.autoAccept) params.set("auto_accept", "1")
  if (opts.callSid) params.set("call_sid", opts.callSid)
  if (opts.leadId) params.set("lead_id", opts.leadId)
  return `${origin}${openPath}?${params.toString()}`
}
