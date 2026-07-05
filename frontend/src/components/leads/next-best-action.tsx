"use client"

import * as React from "react"
import { CalendarClock, ClipboardCheck, Phone, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { Lead } from "@/services/lead-service"

interface FollowUpLike {
    id: string
    scheduled_at: string
    status: string
}

interface AppointmentLike {
    id: string
    scheduled_at: string
    status: string
}

interface NextBestActionProps {
    lead: Lead
    followUps: FollowUpLike[]
    appointments: AppointmentLike[]
    /** True when timeline shows outreach even if first_contacted_at is unset (e.g. Twilio calls). */
    hasBeenContacted?: boolean
    onCall?: () => void
    onScheduleFollowUp?: () => void
    onBookAppointment?: () => void
    onViewFollowUps?: () => void
    onViewAppointments?: () => void
}

interface Suggestion {
    title: string
    reason: string
    actionLabel: string
    onAction?: () => void
    icon: React.ReactNode
}

function computeSuggestion(props: NextBestActionProps): Suggestion | null {
    const { lead, followUps, appointments } = props
    const now = Date.now()

    if (!lead.is_active) return null

    // 1. Overdue follow-up
    const overdue = followUps
        .filter((f) => f.status === "pending" && new Date(f.scheduled_at).getTime() < now)
        .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0]
    if (overdue) {
        return {
            title: "Complete the overdue follow-up",
            reason: `A follow-up was due ${new Date(overdue.scheduled_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}. Leads contacted late convert far less often.`,
            actionLabel: "Open follow-ups",
            onAction: props.onViewFollowUps,
            icon: <ClipboardCheck className="h-4 w-4" />,
        }
    }

    // 2. Appointment today — prep
    const todayAppt = appointments.find((a) => {
        if (!["scheduled", "confirmed"].includes(a.status)) return false
        const d = new Date(a.scheduled_at)
        const t = new Date()
        return (
            d.getFullYear() === t.getFullYear() &&
            d.getMonth() === t.getMonth() &&
            d.getDate() === t.getDate()
        )
    })
    if (todayAppt) {
        return {
            title: "Appointment today — confirm and prep",
            reason: `Showroom visit at ${new Date(todayAppt.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. A confirmation call cuts no-shows roughly in half.`,
            actionLabel: "View appointment",
            onAction: props.onViewAppointments,
            icon: <CalendarClock className="h-4 w-4" />,
        }
    }

    // 3. Never contacted
    const contacted = Boolean(
        lead.first_contacted_at || lead.last_contacted_at || props.hasBeenContacted
    )
    if (!contacted) {
        return {
            title: "Make first contact",
            reason: "This lead hasn't been contacted yet. Response within the first hour dramatically raises connect rates.",
            actionLabel: "Call now",
            onAction: props.onCall,
            icon: <Phone className="h-4 w-4" />,
        }
    }

    // 4. Gone quiet (no activity in 3+ days), nothing scheduled
    const lastTouch = lead.last_activity_at ?? lead.last_contacted_at
    const hasUpcomingWork =
        followUps.some((f) => f.status === "pending") ||
        appointments.some((a) => ["scheduled", "confirmed"].includes(a.status))
    if (!hasUpcomingWork && lastTouch && now - new Date(lastTouch).getTime() > 3 * 86400000) {
        return {
            title: "Re-engage — this lead is going cold",
            reason: "No activity in over 3 days and nothing scheduled. Book a follow-up before the lead goes stale.",
            actionLabel: "Schedule follow-up",
            onAction: props.onScheduleFollowUp,
            icon: <ClipboardCheck className="h-4 w-4" />,
        }
    }

    // 5. Engaged but no appointment yet
    if (!appointments.some((a) => ["scheduled", "confirmed", "completed", "sold"].includes(a.status))) {
        return {
            title: "Push for a showroom appointment",
            reason: "Contact is established but no appointment exists yet. Appointments are the strongest conversion lever.",
            actionLabel: "Book appointment",
            onAction: props.onBookAppointment,
            icon: <CalendarClock className="h-4 w-4" />,
        }
    }

    return null
}

/**
 * Heuristic "next best action" card for the lead workspace.
 */
export function NextBestAction(props: NextBestActionProps) {
    const suggestion = computeSuggestion(props)
    if (!suggestion) return null

    return (
        <Card className="border-primary/25 bg-primary/[0.04]">
            <CardContent className="flex items-start gap-3 p-4">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Next best action</p>
                    <p className="mt-0.5 text-sm font-semibold">{suggestion.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{suggestion.reason}</p>
                    {suggestion.onAction && (
                        <Button size="sm" className="mt-3 h-8" onClick={suggestion.onAction}>
                            {suggestion.icon}
                            <span className="ml-1.5">{suggestion.actionLabel}</span>
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
