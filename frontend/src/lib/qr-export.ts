/** Shared helpers for guest QR PNG export (matches BDC report naming). */

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

export async function exportGuestQrPng(options: {
    svg: SVGElement
    guestName: string
    appointmentAt?: string | null
}): Promise<void> {
    const { svg, guestName, appointmentAt } = options
    const qrSize = 512
    const padding = 40
    const lineHeight = 36
    const name = guestName.trim() || "Guest"
    const apptLabel = formatAppointmentForFilename(appointmentAt)

    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const textBlockHeight = lineHeight * 2 + 24
    canvas.width = qrSize + padding * 2
    canvas.height = qrSize + padding * 2 + textBlockHeight

    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const svgData = new XMLSerializer().serializeToString(svg)
    const img = new Image()

    await new Promise<void>((resolve, reject) => {
        img.onload = () => {
            ctx.drawImage(img, padding, padding, qrSize, qrSize)

            ctx.fillStyle = "#111827"
            ctx.textAlign = "center"
            ctx.font = "bold 28px system-ui, -apple-system, sans-serif"
            ctx.fillText(name, canvas.width / 2, qrSize + padding + 32, canvas.width - padding * 2)

            ctx.font = "22px system-ui, -apple-system, sans-serif"
            ctx.fillStyle = "#4b5563"
            ctx.fillText(apptLabel, canvas.width / 2, qrSize + padding + 32 + lineHeight, canvas.width - padding * 2)

            resolve()
        }
        img.onerror = () => reject(new Error("Failed to render QR code"))
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`
    })

    await new Promise<void>((resolve) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                resolve()
                return
            }
            const link = document.createElement("a")
            link.href = URL.createObjectURL(blob)
            link.download = guestQrExportFilename(name, appointmentAt)
            link.click()
            URL.revokeObjectURL(link.href)
            resolve()
        }, "image/png")
    })
}
