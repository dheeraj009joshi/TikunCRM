/** Shared helpers for guest QR PNG export and clipboard copy (matches BDC report naming). */

import { parseAsUTC } from "@/utils/timezone"

export function sanitizeFilenamePart(text: string, maxLen = 60): string {
    if (!text) return ""
    let cleaned = text
    for (const ch of '<>:"/\\|?*\n\r\t') {
        cleaned = cleaned.replaceAll(ch, "-")
    }
    cleaned = cleaned.split(/\s+/).join(" ").trim().replace(/[ .]+$/g, "")
    return cleaned.slice(0, maxLen) || ""
}

/** e.g. Monday - Jul 5, 2026 - 2:30 PM (in dealership timezone if provided) */
export function formatAppointmentForFilename(
    isoDate: string | null | undefined,
    timezone?: string | null
): string {
    if (!isoDate?.trim()) return "No Appointment"
    try {
        const dt = parseAsUTC(isoDate.trim())
        if (Number.isNaN(dt.getTime())) return "Appointment"
        const opts: Intl.DateTimeFormatOptions = timezone ? { timeZone: timezone } : {}
        const weekday = dt.toLocaleDateString("en-US", { ...opts, weekday: "long" })
        const month = dt.toLocaleDateString("en-US", { ...opts, month: "short" })
        const day = Number(dt.toLocaleDateString("en-US", { ...opts, day: "numeric" }))
        const year = Number(dt.toLocaleDateString("en-US", { ...opts, year: "numeric" }))
        const time = dt.toLocaleTimeString("en-US", { ...opts, hour: "numeric", minute: "2-digit" })
        return `${weekday} - ${month} ${day}, ${year} - ${time}`
    } catch {
        return "Appointment"
    }
}

export function formatAppointmentLabel(
    isoDate: string | null | undefined,
    timezone?: string | null
): string {
    if (!isoDate?.trim()) return "No appointment scheduled"
    try {
        const dt = parseAsUTC(isoDate.trim())
        if (Number.isNaN(dt.getTime())) return "Appointment"
        const opts: Intl.DateTimeFormatOptions = {
            weekday: "long",
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            ...(timezone ? { timeZone: timezone } : {}),
        }
        return dt.toLocaleString("en-US", opts)
    } catch {
        return "Appointment"
    }
}

export function guestQrExportFilename(
    guestName: string,
    appointmentAt: string | null | undefined,
    timezone?: string | null
): string {
    const name = sanitizeFilenamePart(guestName, 50) || "Guest"
    const appt = sanitizeFilenamePart(formatAppointmentForFilename(appointmentAt, timezone), 80)
    return `${name} - ${appt}.png`
}

export type GuestQrImageOptions = {
    svg: SVGElement
    guestName: string
    appointmentAt?: string | null
    dealershipName?: string | null
    dealershipTimezone?: string | null
}

async function renderGuestQrCanvas(options: GuestQrImageOptions): Promise<HTMLCanvasElement> {
    const { svg, guestName, appointmentAt, dealershipName, dealershipTimezone } = options
    const qrSize = 512
    const padding = 40
    const lineHeight = 36
    const name = guestName.trim() || "Guest"
    const dealer = (dealershipName || "").trim()
    const apptLabel = formatAppointmentForFilename(appointmentAt, dealershipTimezone)
    const textLines = dealer ? 3 : 2

    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas not supported")

    const textBlockHeight = lineHeight * textLines + 24
    canvas.width = qrSize + padding * 2
    canvas.height = qrSize + padding * 2 + textBlockHeight

    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const svgData = new XMLSerializer().serializeToString(svg)
    const img = new Image()

    await new Promise<void>((resolve, reject) => {
        img.onload = () => {
            ctx.drawImage(img, padding, padding, qrSize, qrSize)

            const maxTextWidth = canvas.width - padding * 2
            let y = qrSize + padding + 32

            ctx.textAlign = "center"

            if (dealer) {
                ctx.fillStyle = "#374151"
                ctx.font = "600 22px system-ui, -apple-system, sans-serif"
                ctx.fillText(dealer, canvas.width / 2, y, maxTextWidth)
                y += lineHeight
            }

            ctx.fillStyle = "#111827"
            ctx.font = "bold 28px system-ui, -apple-system, sans-serif"
            ctx.fillText(name, canvas.width / 2, y, maxTextWidth)
            y += lineHeight

            ctx.font = "22px system-ui, -apple-system, sans-serif"
            ctx.fillStyle = "#4b5563"
            ctx.fillText(apptLabel, canvas.width / 2, y, maxTextWidth)

            resolve()
        }
        img.onerror = () => reject(new Error("Failed to render QR code"))
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`
    })

    return canvas
}

export async function buildGuestQrImageBlob(options: GuestQrImageOptions): Promise<Blob> {
    const canvas = await renderGuestQrCanvas(options)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
    if (!blob) throw new Error("Failed to create image")
    return blob
}

export async function copyGuestQrImageToClipboard(options: GuestQrImageOptions): Promise<void> {
    const blob = await buildGuestQrImageBlob(options)
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("Copy image is not supported in this browser")
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
}

export async function exportGuestQrPng(options: GuestQrImageOptions): Promise<void> {
    const blob = await buildGuestQrImageBlob(options)
    const name = options.guestName.trim() || "Guest"
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = guestQrExportFilename(name, options.appointmentAt, options.dealershipTimezone)
    link.click()
    URL.revokeObjectURL(link.href)
}

export type GuestWhatsAppShareOptions = GuestQrImageOptions & {
    phone?: string | null
    downPayment?: number | null
    documents?: { category_name: string }[]
    shareUrl: string
}

function calendarDayKey(date: Date, timezone?: string | null): string {
    const opts: Intl.DateTimeFormatOptions = {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        ...(timezone ? { timeZone: timezone } : {}),
    }
    return date.toLocaleDateString("en-CA", opts)
}

/** e.g. Today 4:30 PM · Tomorrow 10:00 AM · Sat, Aug 1, 10:00 AM */
export function formatAppointmentForWhatsApp(
    isoDate: string | null | undefined,
    timezone?: string | null
): string {
    if (!isoDate?.trim()) return "TBD"
    try {
        const dt = parseAsUTC(isoDate.trim())
        if (Number.isNaN(dt.getTime())) return "TBD"
        const opts: Intl.DateTimeFormatOptions = timezone ? { timeZone: timezone } : {}
        const time = dt.toLocaleTimeString("en-US", {
            ...opts,
            hour: "numeric",
            minute: "2-digit",
        })
        const apptDay = calendarDayKey(dt, timezone)
        const today = calendarDayKey(new Date(), timezone)
        if (apptDay === today) return `Today ${time}`

        const tomorrowDate = new Date()
        tomorrowDate.setDate(tomorrowDate.getDate() + 1)
        if (apptDay === calendarDayKey(tomorrowDate, timezone)) return `Tomorrow ${time}`

        const weekday = dt.toLocaleDateString("en-US", { ...opts, weekday: "short" })
        const month = dt.toLocaleDateString("en-US", { ...opts, month: "short" })
        const day = Number(dt.toLocaleDateString("en-US", { ...opts, day: "numeric" }))
        return `${weekday}, ${month} ${day}, ${time}`
    } catch {
        return "TBD"
    }
}

function documentEmoji(categoryName: string): string {
    const c = categoryName.toLowerCase()
    if (
        c.includes("license") ||
        c.includes("licence") ||
        c.includes("driver") ||
        /\bid\b/.test(c) ||
        c.includes("identification")
    ) {
        return "🪪"
    }
    if (c.includes("social") || c.includes("ssn") || c.includes("security")) return "🏛️"
    if (c.includes("insurance")) return "🛡️"
    if (c.includes("pay stub") || c.includes("paystub") || c.includes("income") || c.includes("w2")) {
        return "💵"
    }
    if (c.includes("bank") || c.includes("statement")) return "🏦"
    return "📄"
}

/** WhatsApp-ready text block (Customer + Info), matching the showroom share format. */
export function buildGuestWhatsAppShareText(options: {
    guestName: string
    phone?: string | null
    appointmentAt?: string | null
    dealershipTimezone?: string | null
    downPayment?: number | null
    documents?: { category_name: string }[]
    shareUrl: string
}): string {
    const name = options.guestName.trim() || "Guest"
    const phone = options.phone?.trim() || "—"
    const when = formatAppointmentForWhatsApp(options.appointmentAt, options.dealershipTimezone)
    const lines = [
        "Customer:",
        `👶: ${name}`,
        `📞: ${phone}`,
        `📍: ${when}`,
        "",
        "Info:",
    ]

    if (options.downPayment != null && String(options.downPayment).trim() !== "") {
        const amount = Number(options.downPayment)
        if (!Number.isNaN(amount)) lines.push(`💰: ${amount}`)
    }

    const seen = new Set<string>()
    for (const doc of options.documents || []) {
        const label = (doc.category_name || "").trim()
        if (!label) continue
        const key = label.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        lines.push(`${documentEmoji(label)}: ${label}`)
    }

    lines.push(`👉: ${options.shareUrl}`)
    return lines.join("\n")
}

export type GuestWhatsAppShareResult = {
    /** How the share was delivered */
    method: "native_share" | "whatsapp_link" | "clipboard_text"
}

/**
 * Share guest QR for WhatsApp:
 * - Mobile: native share sheet with image + text when supported
 * - Desktop: copy QR image to clipboard and open WhatsApp with the message text pre-filled
 * - Fallback: copy the formatted text message to the clipboard
 */
export async function shareGuestQrOnWhatsApp(
    options: GuestWhatsAppShareOptions
): Promise<GuestWhatsAppShareResult> {
    const text = buildGuestWhatsAppShareText({
        guestName: options.guestName,
        phone: options.phone,
        appointmentAt: options.appointmentAt,
        dealershipTimezone: options.dealershipTimezone,
        downPayment: options.downPayment,
        documents: options.documents,
        shareUrl: options.shareUrl,
    })
    const blob = await buildGuestQrImageBlob(options)
    const file = new File(
        [blob],
        guestQrExportFilename(options.guestName, options.appointmentAt, options.dealershipTimezone),
        { type: "image/png" }
    )

    if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file], text })
    ) {
        await navigator.share({ files: [file], text, title: options.guestName.trim() || "Guest QR" })
        return { method: "native_share" }
    }

    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
    }

    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`
    const opened = window.open(waUrl, "_blank", "noopener,noreferrer")
    if (opened) return { method: "whatsapp_link" }

    await navigator.clipboard.writeText(text)
    return { method: "clipboard_text" }
}
