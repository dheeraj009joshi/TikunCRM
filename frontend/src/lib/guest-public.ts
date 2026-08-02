/**
 * Server-safe helpers for the public guest share page (/g/[token]).
 * Used by generateMetadata and opengraph-image.
 */

import { API_BASE_URL } from "@/lib/api-client"
import type { GuestPublicProfile } from "@/services/guest-service"
import { parseAsUTC, resolveDealershipTimezone } from "@/utils/timezone"

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://tikuncrm.com"

export function guestSharePageUrl(token: string): string {
    return `${BASE_URL.replace(/\/$/, "")}/g/${token}`
}

export async function fetchPublicGuest(token: string): Promise<GuestPublicProfile | null> {
    if (!token?.trim()) return null
    try {
        const res = await fetch(`${API_BASE_URL}/public/guests/${encodeURIComponent(token)}`, {
            headers: { "Content-Type": "application/json" },
            // Always fresh for share previews — appointment TZ must not be stale/UTC-cached
            cache: "no-store",
        })
        if (!res.ok) return null
        return (await res.json()) as GuestPublicProfile
    } catch {
        return null
    }
}

/** Prefer API-provided label; else format ISO in dealership timezone (never bare UTC). */
export function resolveGuestAppointmentLabel(profile: GuestPublicProfile | null | undefined): string | null {
    if (!profile) return null
    if (profile.appointment_label?.trim()) return profile.appointment_label.trim()
    return formatGuestAppointmentLabel(profile.appointment_at, profile.dealership_timezone)
}

/** e.g. Tuesday - Jul 7, 2026 - 5:00 PM (always in dealership timezone) */
export function formatGuestAppointmentLabel(
    isoDate?: string | null,
    timezone?: string | null
): string | null {
    if (!isoDate?.trim()) return null
    try {
        const dt = parseAsUTC(isoDate.trim())
        if (Number.isNaN(dt.getTime())) return null
        const tz = resolveDealershipTimezone(timezone)
        const opts: Intl.DateTimeFormatOptions = { timeZone: tz }
        const weekday = dt.toLocaleDateString("en-US", { ...opts, weekday: "long" })
        const month = dt.toLocaleDateString("en-US", { ...opts, month: "short" })
        const day = Number(dt.toLocaleDateString("en-US", { ...opts, day: "numeric" }))
        const year = Number(dt.toLocaleDateString("en-US", { ...opts, year: "numeric" }))
        const time = dt.toLocaleTimeString("en-US", {
            ...opts,
            hour: "numeric",
            minute: "2-digit",
        })
        return `${weekday} - ${month} ${day}, ${year} - ${time}`
    } catch {
        return null
    }
}

export function guestOgTitle(profile: GuestPublicProfile | null): string {
    return profile?.full_name?.trim() || "Guest Profile"
}

export function guestOgDescription(profile: GuestPublicProfile | null): string {
    if (!profile) return "Guest profile shared via TikunCRM"
    const appt = resolveGuestAppointmentLabel(profile)
    const dealer = profile.dealership_name?.trim()
    const parts = [
        appt ? `Appointment: ${appt}` : null,
        dealer || null,
        "Scan the QR or open this link for full guest details.",
    ].filter(Boolean)
    return parts.join(" · ")
}
