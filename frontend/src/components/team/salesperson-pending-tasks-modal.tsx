"use client"

import * as React from "react"
import { Calendar, Clock, AlertCircle, User } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { ReportsService, SalespersonPendingTasks } from "@/services/reports-service"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone } from "@/utils/timezone"
import Link from "next/link"

interface SalespersonPendingTasksModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    userId: string
    userName: string
    onNotifyClick?: () => void
}

export function SalespersonPendingTasksModal({
    open,
    onOpenChange,
    userId,
    userName,
    onNotifyClick
}: SalespersonPendingTasksModalProps) {
    const [tasks, setTasks] = React.useState<SalespersonPendingTasks | null>(null)
    const [isLoading, setIsLoading] = React.useState(false)
    const { timezone } = useBrowserTimezone()

    React.useEffect(() => {
        if (open && userId) {
            fetchPendingTasks()
        }
    }, [open, userId])

    const fetchPendingTasks = async () => {
        setIsLoading(true)
        try {
            const data = await ReportsService.getSalespersonPendingTasks(userId)
            setTasks(data)
        } catch (error) {
            console.error("Failed to fetch pending tasks:", error)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Pending Tasks for {userName}</DialogTitle>
                    <DialogDescription>
                        View overdue and upcoming follow-ups and appointments
                    </DialogDescription>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : tasks ? (
                    <div className="space-y-6">
                        {/* Summary */}
                        <div className="flex gap-4">
                            <div className="flex-1 p-4 border rounded-lg">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                                    <AlertCircle className="h-4 w-4" />
                                    Overdue
                                </div>
                                <div className="text-2xl font-bold text-destructive">{tasks.total_overdue}</div>
                            </div>
                            <div className="flex-1 p-4 border rounded-lg">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                                    <Clock className="h-4 w-4" />
                                    Upcoming
                                </div>
                                <div className="text-2xl font-bold">{tasks.total_upcoming}</div>
                            </div>
                        </div>

                        {/* Overdue Follow-ups */}
                        {tasks.overdue_followups.length > 0 && (
                            <div>
                                <h3 className="font-semibold text-destructive mb-3 flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4" />
                                    Overdue Follow-ups ({tasks.overdue_followups.length})
                                </h3>
                                <div className="space-y-2">
                                    {tasks.overdue_followups.map((followup) => (
                                        <Link key={followup.id} href={`/leads/${followup.lead_id}`}>
                                            <div className="p-3 border border-destructive/30 bg-destructive/5 rounded-lg hover:bg-destructive/10 transition-colors cursor-pointer">
                                                <div className="flex items-start justify-between">
                                                    <div>
                                                        <div className="font-medium">{followup.lead_name}</div>
                                                        <div className="text-sm text-muted-foreground">
                                                            {formatDateInTimezone(followup.scheduled_at, timezone)}
                                                        </div>
                                                        {followup.notes && (
                                                            <div className="text-sm text-muted-foreground mt-1">{followup.notes}</div>
                                                        )}
                                                    </div>
                                                    <Badge variant="destructive">Overdue</Badge>
                                                </div>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Overdue Appointments */}
                        {tasks.overdue_appointments.length > 0 && (
                            <div>
                                <h3 className="font-semibold text-destructive mb-3 flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4" />
                                    Overdue Appointments ({tasks.overdue_appointments.length})
                                </h3>
                                <div className="space-y-2">
                                    {tasks.overdue_appointments.map((appointment) => (
                                        <Link key={appointment.id} href={`/leads/${appointment.lead_id}`}>
                                            <div className="p-3 border border-destructive/30 bg-destructive/5 rounded-lg hover:bg-destructive/10 transition-colors cursor-pointer">
                                                <div className="flex items-start justify-between">
                                                    <div>
                                                        <div className="font-medium">
                                                            {appointment.title || "Appointment"} - {appointment.lead_name}
                                                        </div>
                                                        <div className="text-sm text-muted-foreground">
                                                            {formatDateInTimezone(appointment.scheduled_at, timezone)}
                                                        </div>
                                                        {appointment.location && (
                                                            <div className="text-sm text-muted-foreground mt-1">{appointment.location}</div>
                                                        )}
                                                    </div>
                                                    <Badge variant="destructive">Overdue</Badge>
                                                </div>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Upcoming Follow-ups */}
                        {tasks.upcoming_followups.length > 0 && (
                            <div>
                                <h3 className="font-semibold mb-3 flex items-center gap-2">
                                    <Calendar className="h-4 w-4" />
                                    Upcoming Follow-ups ({tasks.upcoming_followups.length})
                                </h3>
                                <div className="space-y-2">
                                    {tasks.upcoming_followups.slice(0, 5).map((followup) => (
                                        <Link key={followup.id} href={`/leads/${followup.lead_id}`}>
                                            <div className="p-3 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                                                <div className="flex items-start justify-between">
                                                    <div>
                                                        <div className="font-medium">{followup.lead_name}</div>
                                                        <div className="text-sm text-muted-foreground">
                                                            {formatDateInTimezone(followup.scheduled_at, timezone)}
                                                        </div>
                                                        {followup.notes && (
                                                            <div className="text-sm text-muted-foreground mt-1">{followup.notes}</div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Upcoming Appointments */}
                        {tasks.upcoming_appointments.length > 0 && (
                            <div>
                                <h3 className="font-semibold mb-3 flex items-center gap-2">
                                    <Calendar className="h-4 w-4" />
                                    Upcoming Appointments ({tasks.upcoming_appointments.length})
                                </h3>
                                <div className="space-y-2">
                                    {tasks.upcoming_appointments.slice(0, 5).map((appointment) => (
                                        <Link key={appointment.id} href={`/leads/${appointment.lead_id}`}>
                                            <div className="p-3 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                                                <div className="flex items-start justify-between">
                                                    <div>
                                                        <div className="font-medium">
                                                            {appointment.title || "Appointment"} - {appointment.lead_name}
                                                        </div>
                                                        <div className="text-sm text-muted-foreground">
                                                            {formatDateInTimezone(appointment.scheduled_at, timezone)}
                                                        </div>
                                                        {appointment.location && (
                                                            <div className="text-sm text-muted-foreground mt-1">{appointment.location}</div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* No tasks */}
                        {tasks.total_overdue === 0 && tasks.total_upcoming === 0 && (
                            <div className="text-center py-8 text-muted-foreground">
                                No pending tasks
                            </div>
                        )}

                        {/* Notify Button */}
                        {onNotifyClick && (tasks.total_overdue > 0 || tasks.total_upcoming > 0) && (
                            <div className="pt-4 border-t">
                                <Button onClick={onNotifyClick} className="w-full">
                                    <User className="mr-2 h-4 w-4" />
                                    Send Notification to {userName}
                                </Button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-center py-8 text-muted-foreground">
                        Failed to load pending tasks
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
