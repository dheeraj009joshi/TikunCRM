"use client"

import * as React from "react"
import { BellRing, Check, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { useDealershipTimezone } from "@/hooks/use-dealership-timezone"
import { cn } from "@/lib/utils"
import { FollowUpService } from "@/services/follow-up-service"
import { NoteReminderService, type NoteReminder, type NoteRemindersResponse } from "@/services/note-reminder-service"
import { isSkateWarningResponse, useSkateConfirmStore, type SkateWarningInfo } from "@/stores/skate-confirm-store"

interface NoteRemindersProps {
    leadId: string
    dealershipId?: string | null
    /** Changes whenever the lead's notes change (e.g. the newest note id), so the notes are re-read */
    notesKey?: string
    /** Called after a reminder is added to follow-ups */
    onFollowUpCreated?: () => void
}

function formatDue(iso: string, timeZone: string, timeGiven: boolean): string {
    const d = new Date(iso)
    const day = new Intl.DateTimeFormat(undefined, { timeZone, weekday: "short", month: "short", day: "numeric" }).format(d)
    const time = new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit" }).format(d)
    return timeGiven ? `${day} · ${time}` : `${day} · ${time} (no time in note)`
}

function formatWritten(iso: string | null, timeZone: string): string {
    if (!iso) return ""
    return new Intl.DateTimeFormat(undefined, { timeZone, month: "short", day: "numeric" }).format(new Date(iso))
}

/**
 * "From the notes": callbacks and deadlines the AI found in this lead's notes.
 * Nothing is scheduled until someone clicks "Add reminder".
 */
export function NoteReminders({ leadId, dealershipId, notesKey, onFollowUpCreated }: NoteRemindersProps) {
    const { toast } = useToast()
    const { dealershipTimezone } = useDealershipTimezone(dealershipId)
    const [data, setData] = React.useState<NoteRemindersResponse | null>(null)
    const [reading, setReading] = React.useState(false)
    const [busyId, setBusyId] = React.useState<string | null>(null)

    React.useEffect(() => {
        let cancelled = false
        async function load() {
            try {
                const current = await NoteReminderService.list(leadId)
                if (cancelled) return
                setData(current)
                if (current.available && current.stale) {
                    setReading(true)
                    const fresh = await NoteReminderService.scan(leadId)
                    if (!cancelled) setData(fresh)
                }
            } catch {
                // Reminders are a helper; the lead page works without them.
            } finally {
                if (!cancelled) setReading(false)
            }
        }
        load()
        return () => {
            cancelled = true
        }
    }, [leadId, notesKey])

    const remove = (id: string) =>
        setData((d) => (d ? { ...d, reminders: d.reminders.filter((r) => r.id !== id) } : d))

    async function addReminder(r: NoteReminder, confirmSkate = false) {
        setBusyId(r.id)
        try {
            // A missed reminder goes on the list for now rather than in the past.
            const when = r.overdue ? new Date().toISOString() : r.due_at
            const result = await FollowUpService.scheduleFollowUp(leadId, {
                lead_id: leadId,
                scheduled_at: when,
                notes: `${r.action} (from note: "${r.quote}")`,
                assigned_to: r.assignee_user_id ?? undefined,
                confirmSkate,
            })
            if (isSkateWarningResponse(result)) {
                useSkateConfirmStore.getState().show(result as unknown as SkateWarningInfo, () => {
                    setTimeout(() => addReminder(r, true), 0)
                })
                return
            }
            // One follow-up covers every reminder on the card
            for (const id of [r.id, ...r.also.map((a) => a.id)]) {
                await NoteReminderService.accept(id, result.id)
            }
            remove(r.id)
            onFollowUpCreated?.()
            toast({ title: "Reminder added", description: r.action })
        } catch {
            toast({ title: "Couldn't add the reminder", description: "Please try again.", variant: "destructive" })
        } finally {
            setBusyId(null)
        }
    }

    async function dismiss(r: NoteReminder) {
        setBusyId(r.id)
        try {
            for (const id of [r.id, ...r.also.map((a) => a.id)]) {
                await NoteReminderService.dismiss(id)
            }
            remove(r.id)
        } catch {
            toast({ title: "Couldn't update the reminder", description: "Please try again.", variant: "destructive" })
        } finally {
            setBusyId(null)
        }
    }

    const shown = (data?.reminders ?? []).filter((r) => !r.already_scheduled)

    if (!shown.length) {
        if (!reading) return null
        return (
            <Card className="border-dashed">
                <CardContent className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Checking the notes for callbacks…
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="border-amber-500/30 bg-amber-500/[0.04]">
            <CardContent className="p-4">
                <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                        <BellRing className="h-3.5 w-3.5" />
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
                        From the notes
                    </p>
                    {reading && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>

                <ul className="mt-3 space-y-3">
                    {shown.map((r) => (
                        <li key={r.id} className="rounded-lg border bg-background p-3">
                            <div className="flex items-start justify-between gap-2">
                                <p className="text-sm font-semibold leading-snug">{r.action}</p>
                                {r.overdue && (
                                    <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
                                        Missed
                                    </span>
                                )}
                            </div>
                            <p className={cn("mt-0.5 text-xs font-medium", r.overdue ? "text-red-600 dark:text-red-400" : "text-foreground/80")}>
                                {formatDue(r.due_at, dealershipTimezone, r.time_given)}
                                {r.assignee_name && <span className="font-normal text-muted-foreground"> · for {r.assignee_name}</span>}
                            </p>
                            {[r, ...r.also].map((q) => (
                                <p key={q.id} className="mt-2 border-l-2 border-amber-500/40 pl-2 text-xs italic text-muted-foreground">
                                    “{q.quote}”
                                    {q.note_author && (
                                        <span className="not-italic">
                                            {" "}
                                            — {q.note_author}, {formatWritten(q.note_written_at, dealershipTimezone)}
                                        </span>
                                    )}
                                </p>
                            ))}
                            <div className="mt-2.5 flex gap-2">
                                <Button size="sm" className="h-7 text-xs" disabled={busyId === r.id} onClick={() => addReminder(r)}>
                                    {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                    <span className="ml-1">{r.overdue ? "Add for now" : "Add reminder"}</span>
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs text-muted-foreground"
                                    disabled={busyId === r.id}
                                    onClick={() => dismiss(r)}
                                >
                                    <X className="h-3 w-3" />
                                    <span className="ml-1">Not needed</span>
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
                <p className="mt-3 text-[11px] text-muted-foreground">
                    Found by AI in this lead&apos;s notes. Nothing is scheduled until you add it.
                </p>
            </CardContent>
        </Card>
    )
}
