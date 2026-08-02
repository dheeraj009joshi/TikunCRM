/**
 * Generate a PNG data URL for a QR code (server-safe via qrcode-generator).
 */
import qrcode from "qrcode-generator"

export function qrCodeDataUrl(text: string, cellSize = 8, margin = 2): string {
    const qr = qrcode(0, "M")
    qr.addData(text)
    qr.make()
    return qr.createDataURL(cellSize, margin)
}
