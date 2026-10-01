"use client"

import * as React from "react"
import { Loader2, MessageSquare, StickyNote } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { ActivityService, type Activity } from "@/services/activity-service"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone } from "@/utils/timezone"

interface LeadNotesModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    leadId: string | null
    leadName: string
    leadNotes?: string | null
}

function noteBody(activity: Activity): string {
    const meta = activity.meta_data || {}
    const content = meta.content ?? meta.notes ?? activity.description
    return String(content || "").trim()
}

function authorName(activity: Activity): string {
    const user = activity.user
    if (!user) return "Team"
    return `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email || "Team"
}

export function LeadNotesModal({
    open,
    onOpenChange,
    leadId,
    leadName,
    leadNotes,
}: LeadNotesModalProps) {
    const { timezone } = useBrowserTimezone()
    const [notes, setNotes] = React.useState<Activity[]>([])
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    React.useEffect(() => {
        if (!open || !leadId) return
        let cancelled = false
        const load = async () => {
            setIsLoading(true)
            setError(null)
            try {
                const collected: Activity[] = []
                let page = 1
                let total = 0
                do {
                    const data = await ActivityService.listActivities({
                        lead_id: leadId,
                        type: "note_added",
                        page,
                        page_size: 100,
                    })
                    collected.push(...data.items)
                    total = data.total
                    page += 1
                } while (collected.length < total && page <= 10)
                if (!cancelled) setNotes(collected)
            } catch (err) {
                console.error("Failed to load lead notes:", err)
                if (!cancelled) setError("Could not load notes")
            } finally {
                if (!cancelled) setIsLoading(false)
            }
        }
        void load()
        return () => {
            cancelled = true
        }
    }, [open, leadId])

    const parentNotes = React.useMemo(
        () =>
            notes
                .filter((n) => !n.parent_id)
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
        [notes]
    )
    const repliesByParent = React.useMemo(() => {
        const map: Record<string, Activity[]> = {}
        for (const note of notes) {
            if (!note.parent_id) continue
            if (!map[note.parent_id]) map[note.parent_id] = []
            map[note.parent_id].push(note)
        }
        Object.values(map).forEach((list) =>
            list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        )
        return map
    }, [notes])

    const summaryNote = leadNotes?.trim() || ""

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[min(36rem,80vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
                <DialogHeader className="border-b px-5 py-4">
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        Notes
                    </DialogTitle>
                    <DialogDescription className="truncate">
                        {leadName}
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                            <Loader2 className="h-6 w-6 animate-spin" />
                            <p className="text-sm">Loading notes…</p>
                        </div>
                    ) : error ? (
                        <p className="py-10 text-center text-sm text-destructive">{error}</p>
                    ) : parentNotes.length === 0 && !summaryNote ? (
                        <div className="py-12 text-center text-muted-foreground">
                            <StickyNote className="mx-auto mb-2 h-8 w-8 opacity-30" />
                            <p className="text-sm font-medium">No notes yet</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {summaryNote && (
                                <div className="rounded-lg border bg-muted/40 p-3">
                                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Lead notes
                                    </p>
                                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{summaryNote}</p>
                                </div>
                            )}
                            {parentNotes.map((note) => {
                                const replies = repliesByParent[note.id] || []
                                return (
                                    <div key={note.id} className="rounded-lg border p-3">
                                        <div className="mb-1.5 flex items-baseline justify-between gap-2">
                                            <span className="text-sm font-medium">{authorName(note)}</span>
                                            <span className="shrink-0 text-[11px] text-muted-foreground">
                                                {formatDateInTimezone(note.created_at, timezone, {
                                                    month: "short",
                                                    day: "numeric",
                                                    year: "numeric",
                                                    hour: "2-digit",
                                                    minute: "2-digit",
                                                })}
                                            </span>
                                        </div>
                                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                                            {noteBody(note) || "—"}
                                        </p>
                                        {replies.length > 0 && (
                                            <div className="mt-3 space-y-2 border-l-2 border-muted pl-3">
                                                {replies.map((reply) => (
                                                    <div key={reply.id}>
                                                        <div className="mb-0.5 flex items-baseline justify-between gap-2">
                                                            <span className="text-xs font-medium">{authorName(reply)}</span>
                                                            <span className="text-[11px] text-muted-foreground">
                                                                {formatDateInTimezone(reply.created_at, timezone, {
                                                                    month: "short",
                                                                    day: "numeric",
                                                                    hour: "2-digit",
                                                                    minute: "2-digit",
                                                                })}
                                                            </span>
                                                        </div>
                                                        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                                                            {noteBody(reply) || "—"}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
