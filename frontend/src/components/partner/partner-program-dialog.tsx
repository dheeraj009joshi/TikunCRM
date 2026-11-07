"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import apiClient from "@/lib/api-client"
import {
    PartnerProgramService,
    type BdcAgentAssignment,
    type PartnerProgram,
    type PortalUser,
} from "@/services/partner-program-service"
import type { PartnerStore } from "@/services/partner-store-service"

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

interface BdcUser {
    id: string
    first_name: string
    last_name: string
    email: string
}

export function PartnerProgramDialog({
    store,
    onClose,
}: {
    store: PartnerStore | null
    onClose: () => void
}) {
    const [programType, setProgramType] = React.useState<"leads_only" | "full_bdc">("leads_only")
    const [status, setStatus] = React.useState<PartnerProgram["status"]>("pending")
    const [states, setStates] = React.useState("")
    const [zips, setZips] = React.useState("")
    const [minCredit, setMinCredit] = React.useState("")
    const [maxCredit, setMaxCredit] = React.useState("")
    const [minDown, setMinDown] = React.useState("")
    const [dailyCap, setDailyCap] = React.useState("")
    const [monthlyCap, setMonthlyCap] = React.useState("")
    const [timezone, setTimezone] = React.useState("America/New_York")
    const [priority, setPriority] = React.useState("0")
    const [start, setStart] = React.useState("")
    const [end, setEnd] = React.useState("")
    const [openDays, setOpenDays] = React.useState<string[]>(DAYS.slice(0, 6))
    const [agents, setAgents] = React.useState<BdcUser[]>([])
    const [selectedAgents, setSelectedAgents] = React.useState<string[]>([])
    const [maxOpen, setMaxOpen] = React.useState("15")
    const [portalUsers, setPortalUsers] = React.useState<PortalUser[]>([])
    const [portalEmail, setPortalEmail] = React.useState("")
    const [portalPassword, setPortalPassword] = React.useState("")
    const [portalName, setPortalName] = React.useState("")
    const [saving, setSaving] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    React.useEffect(() => {
        if (!store) return
        let cancelled = false
        ;(async () => {
            setError(null)
            const [program, users, assigned, bdcUsers] = await Promise.all([
                PartnerProgramService.get(store.id).catch(() => null),
                PartnerProgramService.listPortalUsers(store.id).catch(() => []),
                PartnerProgramService.listBdcAgents(store.id).catch(() => [] as BdcAgentAssignment[]),
                apiClient.get<BdcUser[]>("/users/", { params: { role: "bdc", is_active: true } }).then((res) => res.data).catch(() => []),
            ])
            if (cancelled) return
            setAgents(bdcUsers)
            setPortalUsers(users)
            setSelectedAgents(assigned.map((row) => row.user_id))
            if (assigned[0]) setMaxOpen(String(assigned[0].max_open_leads))
            if (program) {
                setProgramType(program.program_type)
                setStatus(program.status)
                setStates((program.states || []).join(", "))
                setZips((program.postal_codes || []).join(", "))
                setMinCredit(program.min_credit_score?.toString() || "")
                setMaxCredit(program.max_credit_score?.toString() || "")
                setMinDown(program.min_down_payment?.toString() || "")
                setDailyCap(program.daily_cap?.toString() || "")
                setMonthlyCap(program.monthly_cap?.toString() || "")
                setTimezone(program.timezone || "America/New_York")
                setPriority(String(program.priority_weight ?? 0))
                const firstDay = DAYS.map((day) => program.hours?.[day]).find((day) => day?.start && day?.end)
                setStart(firstDay?.start || "")
                setEnd(firstDay?.end || "")
                const days = DAYS.filter((day) => program.hours?.[day]?.is_open !== false && program.hours?.[day])
                if (days.length) setOpenDays(days)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [store])

    function splitList(value: string) {
        return value.split(",").map((item) => item.trim()).filter(Boolean)
    }

    function numberOrNull(value: string) {
        const trimmed = value.trim()
        if (!trimmed) return null
        const parsed = Number(trimmed)
        return Number.isFinite(parsed) ? parsed : null
    }

    async function save() {
        if (!store) return
        setSaving(true)
        setError(null)
        try {
            const hours: PartnerProgram["hours"] = {}
            if (start && end) {
                for (const day of DAYS) {
                    hours[day] = {
                        start,
                        end,
                        is_open: openDays.includes(day),
                    }
                }
            }
            await PartnerProgramService.save(store.id, {
                program_type: programType,
                status,
                states: splitList(states),
                postal_codes: splitList(zips),
                min_credit_score: numberOrNull(minCredit),
                max_credit_score: numberOrNull(maxCredit),
                min_down_payment: numberOrNull(minDown),
                daily_cap: numberOrNull(dailyCap),
                monthly_cap: numberOrNull(monthlyCap),
                hours,
                timezone: timezone.trim() || "America/New_York",
                priority_weight: numberOrNull(priority) ?? 0,
            })
            if (programType === "full_bdc") {
                await PartnerProgramService.saveBdcAgents(
                    store.id,
                    selectedAgents.map((userId) => ({
                        user_id: userId,
                        max_open_leads: numberOrNull(maxOpen) || 15,
                    }))
                )
            }
            if (portalEmail.trim() && portalPassword.trim()) {
                const [first, ...rest] = portalName.trim().split(" ")
                const created = await PartnerProgramService.createPortalUser(store.id, {
                    email: portalEmail.trim(),
                    password: portalPassword,
                    first_name: first || undefined,
                    last_name: rest.join(" ") || undefined,
                })
                setPortalUsers((prev) => [...prev, created])
                setPortalEmail("")
                setPortalPassword("")
                setPortalName("")
            }
            onClose()
        } catch {
            setError("Could not save the program. Check the fields and try again.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={!!store} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Program · {store?.name}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                    <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1 text-sm">
                            <span>Type</span>
                            <select className="flex h-10 w-full rounded-md border bg-transparent px-3" value={programType} onChange={(event) => setProgramType(event.target.value as "leads_only" | "full_bdc")}>
                                <option value="leads_only">Leads only</option>
                                <option value="full_bdc">Full BDC</option>
                            </select>
                        </label>
                        <label className="space-y-1 text-sm">
                            <span>Status</span>
                            <select className="flex h-10 w-full rounded-md border bg-transparent px-3" value={status} onChange={(event) => setStatus(event.target.value as PartnerProgram["status"])}>
                                <option value="pending">Pending</option>
                                <option value="active">Active</option>
                                <option value="paused">Paused</option>
                                <option value="cancelled">Cancelled</option>
                            </select>
                        </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Brand on the store ({store?.brand || "not set"}) is the bucket. Leads-only sends one store per brand. Full BDC takes the whole lead.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label>States</Label>
                            <Input value={states} placeholder="GA, FL" onChange={(event) => setStates(event.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label>Zip codes</Label>
                            <Input value={zips} placeholder="30301, 30302" onChange={(event) => setZips(event.target.value)} />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1">
                            <Label>Min credit</Label>
                            <Input value={minCredit} onChange={(event) => setMinCredit(event.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label>Max credit</Label>
                            <Input value={maxCredit} onChange={(event) => setMaxCredit(event.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label>Min down</Label>
                            <Input value={minDown} onChange={(event) => setMinDown(event.target.value)} />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1">
                            <Label>Daily cap</Label>
                            <Input value={dailyCap} onChange={(event) => setDailyCap(event.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label>Monthly cap</Label>
                            <Input value={monthlyCap} onChange={(event) => setMonthlyCap(event.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label>Priority</Label>
                            <Input value={priority} onChange={(event) => setPriority(event.target.value)} />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1">
                            <Label>Opens</Label>
                            <Input type="time" value={start} onChange={(event) => setStart(event.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label>Closes</Label>
                            <Input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label>Timezone</Label>
                            <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-sm">
                        {DAYS.map((day) => (
                            <label key={day} className="flex items-center gap-1">
                                <input
                                    type="checkbox"
                                    checked={openDays.includes(day)}
                                    onChange={(event) => {
                                        setOpenDays((prev) => event.target.checked ? [...prev, day] : prev.filter((item) => item !== day))
                                    }}
                                />
                                {day.slice(0, 3)}
                            </label>
                        ))}
                    </div>
                    {programType === "full_bdc" && (
                        <div className="space-y-2">
                            <Label>BDC agents · max open {maxOpen}</Label>
                            <Input value={maxOpen} onChange={(event) => setMaxOpen(event.target.value)} className="max-w-[120px]" />
                            <div className="max-h-32 space-y-1 overflow-y-auto text-sm">
                                {agents.length === 0 && <p className="text-muted-foreground">No BDC users found.</p>}
                                {agents.map((agent) => (
                                    <label key={agent.id} className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={selectedAgents.includes(agent.id)}
                                            onChange={(event) => {
                                                setSelectedAgents((prev) => event.target.checked ? [...prev, agent.id] : prev.filter((id) => id !== agent.id))
                                            }}
                                        />
                                        {agent.first_name} {agent.last_name}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="space-y-2 border-t pt-3">
                        <Label>Portal login</Label>
                        {portalUsers.map((user) => (
                            <p key={user.id} className="text-sm text-muted-foreground">{user.email}</p>
                        ))}
                        <div className="grid grid-cols-3 gap-2">
                            <Input placeholder="Name" value={portalName} onChange={(event) => setPortalName(event.target.value)} />
                            <Input placeholder="Email" value={portalEmail} onChange={(event) => setPortalEmail(event.target.value)} />
                            <Input placeholder="Password" type="password" value={portalPassword} onChange={(event) => setPortalPassword(event.target.value)} />
                        </div>
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save program"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
