/** Shared helpers for guest QR PNG export and clipboard copy (matches BDC report naming). */

export function sanitizeFilenamePart(text: string, maxLen = 60): string {
    if (!text) return ""
    let cleaned = text
    for (const ch of '<>:"/\\|?*\n\r\t') {
        cleaned = cleaned.replaceAll(ch, "-")
    }
    cleaned = cleaned.split(/\s+/).join(" ").trim().replace(/[ .]+$/g, "")
    return cleaned.slice(0, maxLen) || ""
}

/** e.g. Monday - Jul 5, 2026 - 2:30 PM */
export function formatAppointmentForFilename(isoDate: string | null | undefined): string {
    if (!isoDate?.trim()) return "No Appointment"
    try {
        const dt = new Date(isoDate.trim())
        if (Number.isNaN(dt.getTime())) return "Appointment"
        const weekday = dt.toLocaleDateString(undefined, { weekday: "long" })
        const month = dt.toLocaleDateString(undefined, { month: "short" })
        const day = dt.getDate()
        const year = dt.getFullYear()
        const time = dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        return `${weekday} - ${month} ${day}, ${year} - ${time}`
    } catch {
        return "Appointment"
    }
}

export function formatAppointmentLabel(isoDate: string | null | undefined): string {
    if (!isoDate?.trim()) return "No appointment scheduled"
    try {
        const dt = new Date(isoDate.trim())
        if (Number.isNaN(dt.getTime())) return "Appointment"
        return dt.toLocaleString(undefined, {
            weekday: "long",
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
        })
    } catch {
        return "Appointment"
    }
}

export function guestQrExportFilename(
    guestName: string,
    appointmentAt: string | null | undefined
): string {
    const name = sanitizeFilenamePart(guestName, 50) || "Guest"
    const appt = sanitizeFilenamePart(formatAppointmentForFilename(appointmentAt), 80)
    return `${name} - ${appt}.png`
}

export type GuestQrImageOptions = {
    svg: SVGElement
    guestName: string
    appointmentAt?: string | null
    dealershipName?: string | null
}

async function renderGuestQrCanvas(options: GuestQrImageOptions): Promise<HTMLCanvasElement> {
    const { svg, guestName, appointmentAt, dealershipName } = options
    const qrSize = 512
    const padding = 40
    const lineHeight = 36
    const name = guestName.trim() || "Guest"
    const dealer = (dealershipName || "").trim()
    const apptLabel = formatAppointmentForFilename(appointmentAt)
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
    link.download = guestQrExportFilename(name, options.appointmentAt)
    link.click()
    URL.revokeObjectURL(link.href)
}
