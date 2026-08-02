/** Shared helpers for guest QR PNG/PDF export and clipboard copy (matches BDC report naming). */

import { jsPDF } from "jspdf"
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

        const tomorrowDate = new Date(Date.now() + 86_400_000)
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

export type GuestWhatsAppInfoItem = {
    emoji: string
    /** Full human-readable text after the emoji, e.g. "Has license" or "Down payment: $3,000" */
    text: string
    /** Dedupe key */
    key?: string
}

export type GuestWhatsAppMessageOptions = {
    guestName: string
    phone?: string | null
    appointmentAt?: string | null
    dealershipTimezone?: string | null
    downPayment?: number | string | null
    vehicleOfInterest?: string | null
    tradeIn?: string | null
    payoff?: number | string | null
    payoffBank?: string | null
    miles?: number | string | null
    email?: string | null
    /** Stip / uploaded document category names */
    documents?: { category_name: string }[]
    /** Extra Info lines from trust score / eligibility — already human-readable */
    infoItems?: GuestWhatsAppInfoItem[]
    shareUrl?: string | null
}

function normalizeInfoKey(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function isDownPaymentLike(label: string): boolean {
    const k = normalizeInfoKey(label)
    return k.includes("down payment") || k === "down" || k.includes("downpayment")
}

function isLicenseLike(label: string): boolean {
    const k = normalizeInfoKey(label)
    return k.includes("license") || k.includes("licence") || k.includes("driver")
}

/** Parse a money-ish value; strips $ and commas. */
export function parseMoneyAmount(raw: unknown): number | null {
    if (raw == null || raw === "") return null
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
    const cleaned = String(raw).trim().replace(/[$,\s]/g, "")
    if (!cleaned) return null
    // Support "4k" / "4K" shorthand used in dealer notes
    const kMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*k$/i)
    if (kMatch) {
        const n = Number(kMatch[1]) * 1000
        return Number.isFinite(n) ? n : null
    }
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
}

function formatMoney(value: number | string | null | undefined): string | null {
    const n = parseMoneyAmount(value)
    if (n == null || n <= 0) return null
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    }).format(n)
}

type DownPaymentAssessmentItem = {
    label: string
    auto_field?: string | null
    input_type?: string
    value?: Record<string, unknown> | null
    auto_value?: unknown
    weight?: number | string
    points?: number | string
    config?: {
        options?: Array<{ label?: string; value?: string; fraction?: number }>
    } | null
}

/**
 * Pick a real down-payment dollar amount from guest / lead / trust score.
 * Ignores tiny numbers that are just criterion weight/points or bad sheet codes (e.g. 4).
 */
export function resolveDownPaymentAmount(options: {
    guestDownPayment?: unknown
    leadDownPayment?: unknown
    assessment?: { items?: DownPaymentAssessmentItem[] } | null
}): number | null {
    const candidates: number[] = []

    for (const raw of [options.guestDownPayment, options.leadDownPayment]) {
        const n = parseMoneyAmount(raw)
        if (n != null && n > 0) candidates.push(n)
    }

    for (const item of options.assessment?.items || []) {
        if (!(item.auto_field === "down_payment" || isDownPaymentLike(item.label))) continue
        // Skip select auto_value — often a bad sheet code (e.g. 4), not dollars
        if (item.input_type === "select") continue
        const n = parseMoneyAmount(item.value?.number ?? item.auto_value)
        if (n == null || n <= 0) continue
        const weight = parseMoneyAmount(item.weight)
        const points = parseMoneyAmount(item.points)
        // Trust-score weight/points are often 1–20 — never treat those as dollars
        if (weight != null && n === weight && n < 100) continue
        if (points != null && n === points && n < 100) continue
        candidates.push(n)
    }

    if (!candidates.length) return null

    // Prefer realistic dollar amounts
    const dollars = candidates.filter((n) => n >= 100)
    if (dollars.length) return Math.max(...dollars)

    // 50–99 could be a real small deposit; still prefer max
    const modest = candidates.filter((n) => n >= 50)
    if (modest.length) return Math.max(...modest)

    // Only tiny values left (e.g. 4) — almost certainly not a dollar amount
    return null
}

/**
 * Display text for WhatsApp: prefer trust-score dropdown range (e.g. "2000-3000"),
 * then a real dollar amount. Never surface junk auto codes like "4".
 */
export function resolveDownPaymentDisplay(options: {
    guestDownPayment?: unknown
    leadDownPayment?: unknown
    assessment?: { items?: DownPaymentAssessmentItem[] } | null
}): string | null {
    for (const item of options.assessment?.items || []) {
        if (!(item.auto_field === "down_payment" || isDownPaymentLike(item.label))) continue
        if (item.input_type !== "select") continue
        const optionValue =
            typeof item.value?.option === "string" ? item.value.option : null
        const optionLabel = resolveSelectOptionLabel(optionValue, item.config?.options)
        if (optionLabel) return optionLabel
        if (optionValue) return optionValue
    }

    const amount = resolveDownPaymentAmount(options)
    return formatMoney(amount)
}

function formatNumeric(value: number | string | null | undefined): string | null {
    if (value == null || String(value).trim() === "") return null
    const n = Number(value)
    if (Number.isNaN(n)) return String(value).trim()
    return String(n)
}

function resolveSelectOptionLabel(
    optionValue: string | null | undefined,
    options?: Array<{ label?: string; value?: string }> | null
): string | null {
    if (!optionValue) return null
    const match = (options || []).find((o) => String(o.value) === String(optionValue))
    const label = match?.label?.trim()
    if (label) return label
    // Ignore cryptic single-letter codes like "t"
    if (optionValue.length <= 2) return null
    return optionValue
}

/** WhatsApp-style Customer + Info lines (text message + optional PDF/PNG details). */
export function buildGuestWhatsAppDetailLines(options: GuestWhatsAppMessageOptions): string[] {
    const name = options.guestName.trim() || "Guest"
    const phone = options.phone?.trim() || "—"
    const when = formatAppointmentForWhatsApp(options.appointmentAt, options.dealershipTimezone)
    const lines = [
        "Customer:",
        `👶: ${name}`,
        `📞: ${phone}`,
        `📍: ${when}`,
    ]
    if (options.email?.trim()) {
        lines.push(`✉️: ${options.email.trim()}`)
    }

    lines.push("", "Info:")

    const seen = new Set<string>()
    const pushLine = (emoji: string, text: string, key?: string) => {
        const trimmed = text.trim()
        if (!trimmed) return
        const dedupe = normalizeInfoKey(key || trimmed)
        if (!dedupe || seen.has(dedupe)) return
        for (const existing of seen) {
            if (
                (existing.includes(dedupe) || dedupe.includes(existing)) &&
                Math.min(existing.length, dedupe.length) >= 6
            ) {
                return
            }
        }
        seen.add(dedupe)
        lines.push(`${emoji}: ${trimmed}`)
    }

    // downPayment may already be a range label ("2000-3000") or a dollar amount
    const downDisplay =
        typeof options.downPayment === "string" && options.downPayment.trim() !== ""
            ? formatMoney(options.downPayment) || options.downPayment.trim()
            : formatMoney(options.downPayment)
    if (downDisplay) {
        pushLine("💰", `Down payment: ${downDisplay}`, "down payment")
    }

    if (options.vehicleOfInterest?.trim()) {
        pushLine("🚗", `Vehicle: ${options.vehicleOfInterest.trim()}`, "vehicle")
    }

    if (options.tradeIn?.trim()) {
        const payoffMoney = formatMoney(options.payoff)
        const bank = options.payoffBank?.trim()
        let tradeText = `Trade-in: ${options.tradeIn.trim()}`
        if (payoffMoney) tradeText += ` (payoff ${payoffMoney}${bank ? ` · ${bank}` : ""})`
        pushLine("🔄", tradeText, "trade in")
    } else {
        const payoffMoney = formatMoney(options.payoff)
        if (payoffMoney) {
            const bank = options.payoffBank?.trim()
            pushLine("🏦", bank ? `${bank} payoff: ${payoffMoney}` : `Payoff: ${payoffMoney}`, "payoff")
        }
    }

    const miles = formatNumeric(options.miles)
    if (miles != null) {
        pushLine("🛣️", `Miles: ${miles}`, "miles")
    }

    for (const doc of options.documents || []) {
        const label = (doc.category_name || "").trim()
        if (!label) continue
        // e.g. "Georgia License on file" / "Social Security on file"
        const text = /on file$/i.test(label) ? label : `${label} on file`
        pushLine(documentEmoji(label), text, label)
    }

    for (const item of options.infoItems || []) {
        if (!item?.text?.trim()) continue
        if (isDownPaymentLike(item.text) && downDisplay) continue
        pushLine(item.emoji || "📄", item.text, item.key || item.text)
    }

    if (options.shareUrl?.trim()) {
        lines.push(`👉: ${options.shareUrl.trim()}`)
    }

    return lines
}

export function buildGuestWhatsAppMessage(options: GuestWhatsAppMessageOptions): string {
    return buildGuestWhatsAppDetailLines(options).join("\n")
}

export async function copyGuestWhatsAppMessageToClipboard(
    options: GuestWhatsAppMessageOptions & { shareUrl: string }
): Promise<void> {
    const text = buildGuestWhatsAppMessage(options)
    if (!navigator.clipboard?.writeText) {
        throw new Error("Copy text is not supported in this browser")
    }
    await navigator.clipboard.writeText(text)
}

type EligibilityItemForWhatsApp = {
    label: string
    is_met: boolean
    auto_field?: string | null
    input_type?: string
    value?: Record<string, unknown> | null
    auto_value?: unknown
    config?: {
        options?: Array<{ label?: string; value?: string; fraction?: number }>
    } | null
}

/** Map trust-score / eligibility into clear WhatsApp Info lines. */
export function eligibilityToWhatsAppInfoItems(
    assessment: { items?: EligibilityItemForWhatsApp[] } | null | undefined
): GuestWhatsAppInfoItem[] {
    if (!assessment?.items?.length) return []

    const items: GuestWhatsAppInfoItem[] = []
    for (const item of assessment.items) {
        if (!item.is_met) continue
        const label = (item.label || "").trim()
        if (!label) continue

        const autoField = item.auto_field || ""
        const numFromValue =
            typeof item.value?.number === "number"
                ? item.value.number
                : typeof item.auto_value === "number"
                  ? item.auto_value
                  : typeof item.auto_value === "string" && item.auto_value.trim() !== "" && !Number.isNaN(Number(item.auto_value))
                    ? Number(item.auto_value)
                    : null
        const optionValue =
            typeof item.value?.option === "string" ? item.value.option : null
        const optionLabel = resolveSelectOptionLabel(optionValue, item.config?.options)

        if (autoField === "down_payment" || isDownPaymentLike(label)) {
            // Skip here — caller resolves via resolveDownPaymentDisplay()
            continue
        }

        if (autoField === "has_license" || isLicenseLike(label)) {
            // Boolean / auto license flags → clear yes language
            const hasLicense =
                item.auto_value === true ||
                item.auto_value === "true" ||
                item.is_met
            if (hasLicense) {
                items.push({ emoji: "🪪", text: "Has license", key: "has license" })
            }
            continue
        }

        if (autoField === "credit_score" || /credit/.test(label.toLowerCase())) {
            if (numFromValue != null) {
                items.push({
                    emoji: "📊",
                    text: `Credit score: ${numFromValue}`,
                    key: "credit score",
                })
            }
            continue
        }

        if (autoField === "distance_miles" || /distance/.test(label.toLowerCase())) {
            if (numFromValue != null) {
                items.push({
                    emoji: "📍",
                    text: `Distance to store: ${numFromValue} mi`,
                    key: "distance",
                })
            }
            continue
        }

        const emoji = documentEmoji(label)

        if (item.input_type === "number" && numFromValue != null) {
            const moneyish = /payment|pay|price|amount|income|salary|budget/i.test(label)
            const valueText = moneyish ? formatMoney(numFromValue) || String(numFromValue) : String(numFromValue)
            items.push({ emoji, text: `${label}: ${valueText}`, key: label })
            continue
        }

        if (item.input_type === "select") {
            // Prefer human option label; never show cryptic codes like "t"
            if (optionLabel) {
                items.push({ emoji, text: `${label}: ${optionLabel}`, key: label })
            } else {
                items.push({ emoji, text: `${label}: on file`, key: label })
            }
            continue
        }

        // Boolean / checkbox criteria that are met
        if (item.input_type === "boolean" || item.input_type == null) {
            const lower = label.toLowerCase()
            if (lower.startsWith("has ")) {
                items.push({ emoji, text: label, key: label })
            } else if (/document|stip|id|ssn|insurance|proof|w2|pay stub|bank/i.test(lower)) {
                items.push({ emoji, text: `${label} on file`, key: label })
            } else {
                items.push({ emoji, text: `Has ${label.charAt(0).toLowerCase()}${label.slice(1)}`, key: label })
            }
            continue
        }

        items.push({ emoji, text: `${label}: yes`, key: label })
    }
    return items
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

/** Same naming as PNG: "{Lead name} - {Appointment}.pdf" */
export function guestQrPdfFilename(
    guestName: string,
    appointmentAt: string | null | undefined,
    timezone?: string | null
): string {
    return guestQrExportFilename(guestName, appointmentAt, timezone).replace(/\.png$/i, ".pdf")
}

/** PDF-safe detail lines (Helvetica can't render emoji reliably). */
function buildGuestPdfDetailLines(options: {
    guestName: string
    phone?: string | null
    appointmentAt?: string | null
    dealershipTimezone?: string | null
    downPayment?: number | null
    documents?: { category_name: string }[]
}): string[] {
    const name = options.guestName.trim() || "Guest"
    const phone = options.phone?.trim() || "—"
    const when = formatAppointmentForWhatsApp(options.appointmentAt, options.dealershipTimezone)
    const lines = [
        "Customer",
        `Name: ${name}`,
        `Phone: ${phone}`,
        `When: ${when}`,
        "",
        "Info",
    ]

    if (options.downPayment != null && String(options.downPayment).trim() !== "") {
        const amount = Number(options.downPayment)
        if (!Number.isNaN(amount)) lines.push(`Down payment: ${amount}`)
    }

    const seen = new Set<string>()
    for (const doc of options.documents || []) {
        const label = (doc.category_name || "").trim()
        if (!label) continue
        const key = label.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        lines.push(`Doc: ${label}`)
    }

    return lines
}

async function qrSvgToPngDataUrl(svg: SVGElement, size = 1024): Promise<string> {
    const canvas = document.createElement("canvas")
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas not supported")

    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, size, size)

    const svgData = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
        img.onload = () => {
            ctx.drawImage(img, 0, 0, size, size)
            resolve()
        }
        img.onerror = () => reject(new Error("Failed to render QR code"))
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`
    })

    return canvas.toDataURL("image/png")
}

/**
 * One-page guest PDF:
 * - Large QR at the top (WhatsApp doc preview shows this first — often scannable without opening)
 * - QR image area + profile URL are clickable links when the PDF is opened
 * - Customer/Info details below
 */
export async function buildGuestQrPdfBlob(options: GuestQrImageOptions): Promise<Blob> {
    const shareUrl = options.shareUrl?.trim()
    if (!shareUrl) throw new Error("Share URL is required for PDF export")

    const name = options.guestName.trim() || "Guest"
    const dealer = (options.dealershipName || "").trim()
    const apptLabel = formatAppointmentForFilename(options.appointmentAt, options.dealershipTimezone)
    const qrDataUrl = await qrSvgToPngDataUrl(options.svg, 1024)
    const detailLines = buildGuestPdfDetailLines({
        guestName: name,
        phone: options.phone,
        appointmentAt: options.appointmentAt,
        dealershipTimezone: options.dealershipTimezone,
        downPayment: options.downPayment,
        documents: options.documents,
    })

    // Compact portrait card — QR dominates the top for chat preview thumbnails
    const pageW = 100
    const pageH = 168
    const margin = 8
    const doc = new jsPDF({ unit: "mm", format: [pageW, pageH], compress: true })

    const qrMm = 72
    const qrX = (pageW - qrMm) / 2
    const qrY = 6
    doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrMm, qrMm, undefined, "FAST")
    // Entire QR is a clickable link when PDF is opened
    doc.link(qrX, qrY, qrMm, qrMm, { url: shareUrl })

    let y = qrY + qrMm + 7
    doc.setTextColor(55, 65, 81)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    if (dealer) {
        doc.text(dealer, pageW / 2, y, { align: "center", maxWidth: pageW - margin * 2 })
        y += 5
    }

    doc.setTextColor(17, 24, 39)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(13)
    doc.text(name, pageW / 2, y, { align: "center", maxWidth: pageW - margin * 2 })
    y += 6

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(75, 85, 99)
    doc.text(apptLabel, pageW / 2, y, { align: "center", maxWidth: pageW - margin * 2 })
    y += 6

    doc.setDrawColor(229, 231, 235)
    doc.setLineWidth(0.3)
    doc.line(margin, y, pageW - margin, y)
    y += 7

    doc.setFontSize(9.5)
    const maxW = pageW - margin * 2
    for (const line of detailLines) {
        if (!line) {
            y += 3
            continue
        }
        const isHeader = line === "Customer" || line === "Info"
        doc.setFont("helvetica", isHeader ? "bold" : "normal")
        doc.setTextColor(isHeader ? 17 : 31, isHeader ? 24 : 41, isHeader ? 39 : 55)
        const wrapped = doc.splitTextToSize(line, maxW) as string[]
        for (const part of wrapped) {
            if (y > pageH - 18) break
            doc.text(part, margin, y)
            y += 4.6
        }
    }

    y += 3
    if (y > pageH - 14) y = pageH - 14
    doc.setFont("helvetica", "bold")
    doc.setFontSize(9)
    doc.setTextColor(18, 140, 126)
    const linkLabel = "Open guest profile"
    doc.textWithLink(linkLabel, margin, y, { url: shareUrl })
    const linkW = doc.getTextWidth(linkLabel)
    // Underline for affordance
    doc.setDrawColor(18, 140, 126)
    doc.setLineWidth(0.2)
    doc.line(margin, y + 0.8, margin + linkW, y + 0.8)

    y += 5
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.5)
    doc.setTextColor(37, 99, 235)
    const urlLines = doc.splitTextToSize(shareUrl, maxW) as string[]
    for (const part of urlLines) {
        if (y > pageH - 6) break
        doc.textWithLink(part, margin, y, { url: shareUrl })
        y += 3.6
    }

    return doc.output("blob")
}

export async function exportGuestQrPdf(options: GuestQrImageOptions): Promise<void> {
    const blob = await buildGuestQrPdfBlob(options)
    const filename = guestQrPdfFilename(
        options.guestName,
        options.appointmentAt,
        options.dealershipTimezone
    )
    const file = new File([blob], filename, { type: "application/pdf" })

    // Prefer native share sheet (mobile) so user can send straight to WhatsApp
    if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
    ) {
        await navigator.share({
            files: [file],
            title: options.guestName.trim() || "Guest QR",
            text: options.shareUrl || undefined,
        })
        return
    }

    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
}

export type GuestQrImageOptions = {
    svg: SVGElement
    guestName: string
    appointmentAt?: string | null
    dealershipName?: string | null
    dealershipTimezone?: string | null
    phone?: string | null
    downPayment?: number | null
    documents?: { category_name: string }[]
    shareUrl?: string | null
    /** Bake Customer/Info onto the PNG card (default false — keep QR card clean). */
    includeDetails?: boolean
}

function wrapCanvasText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
): string[] {
    if (!text) return [""]
    if (ctx.measureText(text).width <= maxWidth) return [text]

    const chars = Array.from(text)
    const lines: string[] = []
    let current = ""
    for (const ch of chars) {
        const next = current + ch
        if (current && ctx.measureText(next).width > maxWidth) {
            lines.push(current)
            current = ch
        } else {
            current = next
        }
    }
    if (current) lines.push(current)
    return lines.length ? lines : [text]
}

async function renderGuestQrCanvas(options: GuestQrImageOptions): Promise<HTMLCanvasElement> {
    const {
        svg,
        guestName,
        appointmentAt,
        dealershipName,
        dealershipTimezone,
        phone,
        downPayment,
        documents,
        shareUrl,
        includeDetails = false,
    } = options
    const qrSize = 512
    const padding = 40
    const headerLineHeight = 36
    const detailLineHeight = 30
    const name = guestName.trim() || "Guest"
    const dealer = (dealershipName || "").trim()
    const apptLabel = formatAppointmentForFilename(appointmentAt, dealershipTimezone)
    const headerLines = dealer ? 3 : 2
    const detailLines = includeDetails
        ? buildGuestWhatsAppDetailLines({
              guestName: name,
              phone,
              appointmentAt,
              dealershipTimezone,
              downPayment,
              documents,
              shareUrl,
          })
        : []

    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas not supported")

    ctx.font = "22px system-ui, -apple-system, sans-serif"
    const contentWidth = qrSize
    const wrappedDetails: string[] = []
    for (const line of detailLines) {
        if (!line) {
            wrappedDetails.push("")
            continue
        }
        wrappedDetails.push(...wrapCanvasText(ctx, line, contentWidth))
    }

    const headerBlockHeight = headerLineHeight * headerLines + 24
    const detailsBlockHeight =
        wrappedDetails.length > 0 ? 28 + wrappedDetails.length * detailLineHeight + 20 : 0
    canvas.width = qrSize + padding * 2
    canvas.height = qrSize + padding * 2 + headerBlockHeight + detailsBlockHeight

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
                y += headerLineHeight
            }

            ctx.fillStyle = "#111827"
            ctx.font = "bold 28px system-ui, -apple-system, sans-serif"
            ctx.fillText(name, canvas.width / 2, y, maxTextWidth)
            y += headerLineHeight

            ctx.font = "22px system-ui, -apple-system, sans-serif"
            ctx.fillStyle = "#4b5563"
            ctx.fillText(apptLabel, canvas.width / 2, y, maxTextWidth)
            y += headerLineHeight + 8

            if (wrappedDetails.length > 0) {
                ctx.strokeStyle = "#e5e7eb"
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.moveTo(padding, y)
                ctx.lineTo(canvas.width - padding, y)
                ctx.stroke()
                y += 32

                ctx.textAlign = "left"

                for (const line of wrappedDetails) {
                    if (!line) {
                        y += detailLineHeight * 0.55
                        continue
                    }
                    const isHeader = line === "Customer:" || line === "Info:"
                    const isLink = line.startsWith("👉:")
                    ctx.fillStyle = isLink ? "#128C7E" : isHeader ? "#111827" : "#1f2937"
                    ctx.font = isHeader
                        ? "bold 22px system-ui, -apple-system, sans-serif"
                        : "22px system-ui, -apple-system, sans-serif"
                    ctx.fillText(line, padding, y, maxTextWidth)
                    y += detailLineHeight
                }
            }

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
    const blob = await buildGuestQrImageBlob({
        ...options,
        includeDetails: options.includeDetails ?? false,
    })
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("Copy image is not supported in this browser")
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
}

export async function exportGuestQrPng(options: GuestQrImageOptions): Promise<void> {
    const blob = await buildGuestQrImageBlob({
        ...options,
        includeDetails: options.includeDetails ?? false,
    })
    const name = options.guestName.trim() || "Guest"
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = guestQrExportFilename(name, options.appointmentAt, options.dealershipTimezone)
    link.click()
    URL.revokeObjectURL(link.href)
}
