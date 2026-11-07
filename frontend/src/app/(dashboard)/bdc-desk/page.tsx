"use client"

import * as React from "react"
import Link from "next/link"
import { BdcDeskService, type DeskItem } from "@/services/bdc-desk-service"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

const ACTIONS = [
    "attempting",
    "contacted",
    "confirmed",
    "showed",
    "sold",
    "no_show",
    "dead",
]

export default function BdcDeskPage() {
    const [items, setItems] = React.useState<DeskItem[]>([])
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [when, setWhen] = React.useState<Record<string, string>>({})
    const [busyId, setBusyId] = React.useState<string | null>(null)

    const load = React.useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            setItems(await BdcDeskService.queue())
        } catch {
            setError("Could not load the BDC desk.")
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => {
        load()
    }, [load])

    async function setStatus(id: string, status: string) {
        setBusyId(id)
        try {
            const updated = await BdcDeskService.setStatus(id, status)
            setItems((prev) => prev.map((item) => (item.id === id ? updated : item)).filter((item) => item.status !== "sold" && item.status !== "dead"))
        } finally {
            setBusyId(null)
        }
    }

    async function book(id: string) {
        const value = when[id]
        if (!value) return
        setBusyId(id)
        try {
            const updated = await BdcDeskService.book(id, new Date(value).toISOString(), 60)
            setItems((prev) => prev.map((item) => (item.id === id ? updated : item)))
        } finally {
            setBusyId(null)
        }
    }

    return (
        <div className="space-y-4 p-4 md:p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">BDC desk</h1>
                    <p className="text-sm text-muted-foreground">Full-BDC leads waiting on your stores.</p>
                </div>
                <Button variant="outline" onClick={load}>Refresh</Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No leads on the desk.</p>
            ) : (
                <div className="grid gap-3">
                    {items.map((item) => (
                        <Card key={item.id}>
                            <CardHeader className="pb-2">
                                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                                    <Link href={`/leads/${item.lead_id}`} className="hover:underline">{item.customer_name}</Link>
                                    <Badge variant="outline">{item.brand}</Badge>
                                    <Badge variant="secondary">{item.status.replace(/_/g, " ")}</Badge>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <p className="text-sm text-muted-foreground">
                                    {item.partner_store_name || "Store"}
                                    {item.phone ? ` · ${item.phone}` : ""}
                                    {item.email ? ` · ${item.email}` : ""}
                                    {!item.bdc_agent_id ? " · Unassigned" : ""}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {ACTIONS.map((status) => (
                                        <Button
                                            key={status}
                                            size="sm"
                                            variant="outline"
                                            disabled={busyId === item.id || item.status === status}
                                            onClick={() => setStatus(item.id, status)}
                                        >
                                            {status.replace(/_/g, " ")}
                                        </Button>
                                    ))}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Input
                                        type="datetime-local"
                                        className="max-w-xs"
                                        value={when[item.id] || ""}
                                        onChange={(event) => setWhen((prev) => ({ ...prev, [item.id]: event.target.value }))}
                                    />
                                    <Button size="sm" disabled={busyId === item.id || !when[item.id]} onClick={() => book(item.id)}>
                                        Book appointment
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
