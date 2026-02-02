"use client"

import * as React from "react"
import {
    History,
    MessageSquare,
    UserPlus,
    CheckCircle2,
    RefreshCcw,
    PhoneCall,
    Mail,
    Calendar,
    AlertCircle
} from "lucide-react"
import { cn } from "@/lib/utils"

const activityTypes = {
    LEAD_CREATED: { icon: UserPlus, color: "text-blue-500", bg: "bg-blue-500/10" },
    STATUS_CHANGED: { icon: RefreshCcw, color: "text-purple-500", bg: "bg-purple-500/10" },
    LEAD_ASSIGNED: { icon: Users, color: "text-orange-500", bg: "bg-orange-500/10" },
    NOTE_ADDED: { icon: MessageSquare, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    FOLLOW_UP_SCHEDULED: { icon: Calendar, color: "text-pink-500", bg: "bg-pink-500/10" },
    FOLLOW_UP_COMPLETED: { icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    CALL_LOGGED: { icon: PhoneCall, color: "text-indigo-500", bg: "bg-indigo-500/10" },
    EMAIL_SENT: { icon: Mail, color: "text-sky-500", bg: "bg-sky-500/10" },
}

import { Users } from "lucide-react"

export interface ActivityItem {
    id: string
    type: keyof typeof activityTypes
    description: string
    user_name: string
    created_at: string
    metadata?: any
}

interface TimelineProps {
    activities: ActivityItem[]
    isLoading?: boolean
}

export function ActivityTimeline({ activities, isLoading }: TimelineProps) {
    if (isLoading) {
        return (
            <div className="flex flex-col gap-8 animate-pulse p-4">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="flex gap-4">
                        <div className="h-10 w-10 rounded-full bg-muted" />
                        <div className="flex-1 space-y-2">
                            <div className="h-4 w-1/4 bg-muted rounded" />
                            <div className="h-4 w-3/4 bg-muted rounded" />
                        </div>
                    </div>
                ))}
            </div>
        )
    }

    if (activities.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center">
                <History className="h-12 w-12 text-muted-foreground/20 mb-4" />
                <h3 className="text-lg font-medium">No activity yet</h3>
                <p className="text-sm text-muted-foreground max-w-xs">All actions taken on this lead will appear here in chronological order.</p>
            </div>
        )
    }

    return (
        <div className="relative space-y-8 before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-primary/20 before:via-border/50 before:to-transparent">
            {activities.map((activity, idx) => {
                const config = activityTypes[activity.type] || { icon: AlertCircle, color: "text-muted-foreground", bg: "bg-muted" }
                return (
                    <div key={activity.id} className="relative flex items-start gap-4 group">
                        <div className={cn(
                            "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-4 border-background transition-transform group-hover:scale-110",
                            config.bg,
                            config.color
                        )}>
                            <config.icon className="h-4 w-4" />
                        </div>
                        <div className="flex flex-col gap-1 pt-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-bold">{activity.description}</span>
                                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 rounded py-0.5 font-medium uppercase">{activity.created_at}</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                By <span className="font-medium text-foreground">{activity.user_name}</span>
                            </p>

                            {activity.metadata?.notes && (
                                <div className="mt-2 rounded-lg border bg-muted/30 p-3 text-sm italic border-l-4 border-l-primary">
                                    &ldquo;{activity.metadata.notes}&rdquo;
                                </div>
                            )}

                            {activity.type === 'STATUS_CHANGED' && (
                                <div className="mt-1 flex items-center gap-2 text-xs font-medium">
                                    <span className="text-muted-foreground line-through">{activity.metadata.old_status}</span>
                                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                    <span className="text-primary">{activity.metadata.new_status}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

import { ArrowRight } from "lucide-react"
