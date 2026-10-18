/**
 * Build the WhatsApp text for every appointment scheduled today at one partner store.
 * Each block matches the guest-profile share message (customer, phone, time, docs, link).
 */
import { Appointment, AppointmentStatus } from "@/services/appointment-service"
import { EligibilityService } from "@/services/eligibility-service"
import { Guest, GuestService } from "@/services/guest-service"
import { StipsService } from "@/services/stips-service"
import {
    buildGuestWhatsAppMessage,
    eligibilityToWhatsAppInfoItems,
    resolveDownPaymentDisplay,
} from "@/lib/qr-export"

const SHAREABLE_STATUSES = new Set<AppointmentStatus>([
    "scheduled",
    "confirmed",
    "arrived",
    "in_showroom",
    "in_progress",
])

function customerName(apt: Appointment): string {
    const customer = apt.lead?.customer
    if (!customer) return apt.title || "Guest"
    return (
        customer.full_name ||
        `${customer.first_name || ""} ${customer.last_name || ""}`.trim() ||
        apt.title ||
        "Guest"
    )
}

function shareUrlFor(guest: Guest, fallbackUrl?: string | null): string | null {
    const base =
        guest.share_token && !guest.share_revoked
            ? `${window.location.origin}/g/${guest.share_token}`
            : fallbackUrl || null
    if (!base) return null
    return base.split("?")[0]
}

function formatSharePhone(phone?: string | null): string {
    const raw = phone?.trim() || ""
    const digits = raw.replace(/\D/g, "")
    if (digits.length === 11 && digits.startsWith("1")) {
        return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
    }
    if (digits.length === 10) {
        return `+1 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
    }
    return raw || "—"
}

/** Keep the link readable without letting WhatsApp attach the large QR preview card. */
function linkWithoutPreview(url: string): string {
    return url.replace(/^https:\/\//, "https://\u200B")
}

function tidyShareBlock(raw: string, name: string): string {
    const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && line !== "Customer:" && line !== "Info:")
        .map((line) => {
            if (line.startsWith("👉")) {
                const url = line.replace(/^👉:\s*/, "")
                return linkWithoutPreview(url)
            }
            return line.replace(/^(\p{Extended_Pictographic}(?:\uFE0F)?):\s+/u, "$1 ")
        })
        .filter((line) => !line.startsWith("👶"))

    return [`*${name}*`, ...lines].join("\n")
}

async function messageForAppointment(
    apt: Appointment,
    timezone?: string | null
): Promise<string | null> {
    if (!apt.lead_id) return null

    const guest = await GuestService.getOrCreate({
        lead_id: apt.lead_id,
        appointment_id: apt.id,
        dealership_id: apt.dealership_id,
        full_name: customerName(apt),
        phone: apt.lead?.customer?.phone,
        email: apt.lead?.customer?.email,
    })

    let sharedUrl: string | null = null
    if (!guest.share_token || guest.share_revoked) {
        const shared = await GuestService.share(guest.id)
        sharedUrl = shared.share_url
        guest.share_token = shared.share_token
        guest.share_revoked = false
    }
    const shareUrl = shareUrlFor(guest, sharedUrl)
    if (!shareUrl) return null

    let documents: { category_name: string }[] = []
    try {
        const latest = await GuestService.getDocuments(guest.id)
        if (latest.length) {
            documents = latest
        } else {
            const stipDocs = await StipsService.listDocuments(apt.lead_id)
            documents = stipDocs.map((d) => ({ category_name: d.category_name }))
        }
    } catch {
        /* share still works without document lines */
    }

    let assessment = null
    try {
        assessment = await EligibilityService.getAssessment("guest", guest.id)
    } catch {
        /* share still works without trust-score lines */
    }

    const name = guest.full_name || customerName(apt)
    const raw = buildGuestWhatsAppMessage({
        guestName: name,
        phone: formatSharePhone(guest.phone || apt.lead?.customer?.phone),
        email: guest.email || apt.lead?.customer?.email,
        appointmentAt: apt.scheduled_at,
        dealershipTimezone: timezone,
        downPayment: resolveDownPaymentDisplay({
            guestDownPayment: guest.down_payment,
            assessment,
        }),
        vehicleOfInterest: guest.vehicle_of_interest,
        tradeIn: guest.trade_in,
        payoff: guest.payoff,
        payoffBank: guest.payoff_bank,
        miles: guest.miles,
        documents,
        infoItems: eligibilityToWhatsAppInfoItems(assessment),
        shareUrl,
    })
    return tidyShareBlock(raw, name)
}

export function shareableStoreAppointments(appointments: Appointment[]): Appointment[] {
    return appointments
        .filter((apt) => SHAREABLE_STATUSES.has(apt.status) && !!apt.lead_id)
        .slice()
        .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
}

export async function buildStoreAppointmentsWhatsAppMessage(
    appointments: Appointment[],
    options: {
        storeName: string
        timezoneFor: (dealershipId?: string | null) => string | null | undefined
    }
): Promise<{ text: string; shared: number; skipped: number }> {
    const shareable = shareableStoreAppointments(appointments)
    const blocks: string[] = []
    let skipped = 0

    for (const apt of shareable) {
        try {
            const block = await messageForAppointment(apt, options.timezoneFor(apt.dealership_id))
            if (block) blocks.push(block)
            else skipped += 1
        } catch {
            skipped += 1
        }
    }

    if (blocks.length === 0) {
        return { text: "", shared: 0, skipped }
    }

    const header = `*${options.storeName}*\nToday · ${blocks.length} appointment${blocks.length === 1 ? "" : "s"}`
    const text = `${header}\n\n${blocks.join("\n\n")}`
    return { text, shared: blocks.length, skipped }
}
