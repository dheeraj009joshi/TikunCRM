import { ImageResponse } from "next/og"
import {
    fetchPublicGuest,
    formatGuestAppointmentLabel,
    guestSharePageUrl,
} from "@/lib/guest-public"
import { qrCodeDataUrl } from "@/lib/qr-data-url"

export const alt = "Guest QR profile"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const runtime = "nodejs"
export const revalidate = 60

type ImageProps = {
    params: Promise<{ token: string }>
}

export default async function Image({ params }: ImageProps) {
    const { token } = await params
    const profile = await fetchPublicGuest(token)
    const shareUrl = guestSharePageUrl(token)
    const name = profile?.full_name?.trim() || "Guest"
    const dealer = profile?.dealership_name?.trim() || ""
    const appointment =
        formatGuestAppointmentLabel(profile?.appointment_at) || "No appointment scheduled"

    let qrSrc = ""
    try {
        qrSrc = qrCodeDataUrl(shareUrl, 10, 2)
    } catch {
        qrSrc = ""
    }

    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
                    padding: 48,
                    fontFamily: "system-ui, -apple-system, sans-serif",
                }}
            >
                {/* QR card — large so WhatsApp preview can often scan it */}
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "#ffffff",
                        borderRadius: 28,
                        padding: 28,
                        boxShadow: "0 12px 40px rgba(15, 23, 42, 0.12)",
                        marginRight: 40,
                    }}
                >
                    {qrSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={qrSrc}
                            alt="QR code"
                            width={420}
                            height={420}
                            style={{ width: 420, height: 420 }}
                        />
                    ) : (
                        <div
                            style={{
                                width: 420,
                                height: 420,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "#f1f5f9",
                                color: "#64748b",
                                fontSize: 28,
                            }}
                        >
                            QR unavailable
                        </div>
                    )}
                </div>

                {/* Name + appointment */}
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        maxWidth: 560,
                        flex: 1,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            fontSize: 22,
                            fontWeight: 600,
                            color: "#64748b",
                            marginBottom: 16,
                            letterSpacing: 0.5,
                            textTransform: "uppercase",
                        }}
                    >
                        Guest Profile
                    </div>
                    {dealer ? (
                        <div
                            style={{
                                display: "flex",
                                fontSize: 26,
                                color: "#475569",
                                marginBottom: 10,
                            }}
                        >
                            {dealer}
                        </div>
                    ) : null}
                    <div
                        style={{
                            display: "flex",
                            fontSize: 52,
                            fontWeight: 800,
                            color: "#0f172a",
                            lineHeight: 1.15,
                            marginBottom: 20,
                        }}
                    >
                        {name}
                    </div>
                    <div
                        style={{
                            display: "flex",
                            fontSize: 28,
                            color: "#334155",
                            lineHeight: 1.35,
                            marginBottom: 28,
                        }}
                    >
                        {appointment}
                    </div>
                    <div
                        style={{
                            display: "flex",
                            fontSize: 20,
                            color: "#2563eb",
                            fontWeight: 600,
                        }}
                    >
                        TikunCRM · Scan QR to open
                    </div>
                </div>
            </div>
        ),
        { ...size }
    )
}
