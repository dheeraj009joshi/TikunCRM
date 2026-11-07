"use client"

import * as React from "react"
import { PartnerProgramService, type LeadDeliveryRow } from "@/services/partner-program-service"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export function LeadDeliveries({ leadId, canManage }: { leadId: string; canManage: boolean }) {
    const [rows, setRows] = React.useState<LeadDeliveryRow[]>([])
    const [loading, setLoading] = React.useState(true)
    const [busy, setBusy] = React.useState(false)

    const load = React.useCallback(async () => {
        setLoading(true)
        try {
            setRows(await PartnerProgramService.listDeliveries(leadId))
        } catch {
            setRows([])
        } finally {
            setLoading(false)
        }
    }, [leadId])

    React.useEffect(() => {
        load()
    }, [load])

    async function routeNow() {
        setBusy(true)
        try {
            setRows(await PartnerProgramService.routeLead(leadId))
        } finally {
            setBusy(false)
        }
    }

    async function sendBack(id: string) {
        setBusy(true)
        try {
            setRows(await PartnerProgramService.returnDelivery(leadId, id))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div>
            <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest">
                    Program deliveries
                </p>
                {canManage && (
                    <Button size="sm" variant="outline" onClick={routeNow} disabled={busy}>
                        Route now
                    </Button>
                )}
            </div>
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading deliveries…</p>
            ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No store has this lead yet.</p>
            ) : (
                <ul className="space-y-2">
                    {rows.map((row) => (
                        <li key={row.id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="min-w-0 truncate">
                                <span className="font-medium">{row.brand}</span>
                                {" · "}
                                {row.partner_store_name || "Store"}
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                                <Badge variant="outline">{row.program_type === "full_bdc" ? "BDC" : "Leads"}</Badge>
                                <Badge variant="secondary">{row.status.replace(/_/g, " ")}</Badge>
                                {canManage && row.status !== "dead" && row.status !== "returned" && (
                                    <Button size="sm" variant="ghost" onClick={() => sendBack(row.id)} disabled={busy}>
                                        Return
                                    </Button>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
