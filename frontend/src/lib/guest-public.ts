/**
 * Server-safe helpers for the public guest share page (/g/[token]).
 * Used by generateMetadata and opengraph-image.
 */

import { API_BASE_URL } from "@/lib/api-client"
import type { GuestPublicProfile } from "@/services/guest-service"
import { parseAsUTC } from "@/utils/timezone"

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://tikuncrm.com"

export function guestSharePageUrl(token: string): string {
    return `${BASE_URL.replace(/\/$/, "")}/g/${token}`
}

export async function fetchPublicGuest(token: string): Promise<GuestPublicProfile | null> {
    if (!token?.trim()) return null
    try {
        const res = await fetch(`${API_BASE_URL}/public/guests/${encodeURIComponent(token)}`, {
            headers: { "Content-Type": "application/json" },
            next: { revalidate: 60 },
        })
        if (!res.ok) return null
        return (await res.json()) as GuestPublicProfile
    } catch {
        return null
    }
}

/** e.g. Tuesday - Jul 7, 2026 - 5:00 PM */
export function formatGuestAppointmentLabel(isoDate?: string | null): string | null {
    if (!isoDate?.trim()) return null
    try {
        const dt = parseAsUTC(isoDate.trim())
        if (Number.isNaN(dt.getTime())) return null
        const weekday = dt.toLocaleDateString("en-US", { weekday: "long" })
        const month = dt.toLocaleDateString("en-US", { month: "short" })
        const day = Number(dt.toLocaleDateString("en-US", { day: "numeric" }))
        const year = Number(dt.toLocaleDateString("en-US", { year: "numeric" }))
        const time = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
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
    const appt = formatGuestAppointmentLabel(profile.appointment_at)
    const dealer = profile.dealership_name?.trim()
    const parts = [
        appt ? `Appointment: ${appt}` : null,
        dealer || null,
        "Scan the QR or open this link for full guest details.",
    ].filter(Boolean)
    return parts.join(" · ")
}
