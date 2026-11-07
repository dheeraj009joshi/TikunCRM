"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
    PartnerPortalService,
    type PartnerMe,
    type PortalAppointment,
    type PortalDelivery,
} from "@/services/partner-portal-service"

export default function PartnerHomePage() {
    const router = useRouter()
    const [me, setMe] = React.useState<PartnerMe | null>(null)
    const [deliveries, setDeliveries] = React.useState<PortalDelivery[]>([])
    const [appointments, setAppointments] = React.useState<PortalAppointment[]>([])
    const [error, setError] = React.useState<string | null>(null)

    React.useEffect(() => {
        if (!PartnerPortalService.token()) {
            router.replace("/partner/login")
            return
        }
        let cancelled = false
        ;(async () => {
            try {
                const profile = await PartnerPortalService.me()
                if (cancelled) return
                setMe(profile)
                if (profile.program_type === "full_bdc") {
                    setAppointments(await PartnerPortalService.appointments())
                } else {
                    setDeliveries(await PartnerPortalService.deliveries())
                }
            } catch {
                if (!cancelled) setError("Could not load your store.")
            }
        })()
        return () => {
            cancelled = true
        }
    }, [router])

    async function setDeliveryStatus(id: string, status: string) {
        const updated = await PartnerPortalService.updateDelivery(id, status)
        setDeliveries((prev) => prev.map((row) => (row.id === id ? updated : row)))
    }

    async function setOutcome(id: string, outcome: string) {
        const updated = await PartnerPortalService.updateAppointment(id, outcome)
        setAppointments((prev) => prev.map((row) => (row.id === id ? updated : row)))
    }

    function logout() {
        PartnerPortalService.logout()
        router.replace("/partner/login")
    }

    return (
        <div className="min-h-screen bg-background p-4 md:p-8">
            <div className="mx-auto max-w-3xl space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-semibold">{me?.store_name || "Partner"}</h1>
                        <p className="text-sm text-muted-foreground">
                            {me?.program_type === "full_bdc" ? "Appointments" : "Delivered leads"}
                            {me?.brand ? ` · ${me.brand}` : ""}
                        </p>
                    </div>
                    <button type="button" onClick={logout} className="text-sm text-primary hover:underline">
                        Sign out
                    </button>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                {me?.program_type === "full_bdc" ? (
                    <ul className="space-y-3">
                        {appointments.length === 0 && <li className="text-sm text-muted-foreground">No appointments yet.</li>}
                        {appointments.map((row) => (
                            <li key={row.id} className="rounded-lg border p-4 space-y-2">
                                <p className="font-medium">{row.customer_name}</p>
                                <p className="text-sm text-muted-foreground">
                                    {new Date(row.scheduled_at).toLocaleString()} · {row.status}
                                    {row.phone ? ` · ${row.phone}` : ""}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {["showed", "no_show", "sold"].map((outcome) => (
                                        <button
                                            key={outcome}
                                            type="button"
                                            onClick={() => setOutcome(row.id, outcome)}
                                            className="rounded-md border px-3 py-1 text-sm"
                                        >
                                            {outcome.replace("_", " ")}
                                        </button>
                                    ))}
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <ul className="space-y-3">
                        {deliveries.length === 0 && <li className="text-sm text-muted-foreground">No leads yet.</li>}
                        {deliveries.map((row) => (
                            <li key={row.id} className="rounded-lg border p-4 space-y-2">
                                <p className="font-medium">{row.customer_name} · {row.brand}</p>
                                <p className="text-sm text-muted-foreground">
                                    {row.status.replace(/_/g, " ")}
                                    {row.phone ? ` · ${row.phone}` : ""}
                                    {row.email ? ` · ${row.email}` : ""}
                                    {row.interested_in ? ` · ${row.interested_in}` : ""}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {["working", "showed", "sold", "dead"].map((status) => (
                                        <button
                                            key={status}
                                            type="button"
                                            onClick={() => setDeliveryStatus(row.id, status)}
                                            className="rounded-md border px-3 py-1 text-sm"
                                        >
                                            {status}
                                        </button>
                                    ))}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    )
}
