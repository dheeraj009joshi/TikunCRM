"use client"

import * as React from "react"
import {
    addDays,
    addMonths,
    addWeeks,
    eachDayOfInterval,
    endOfMonth,
    endOfWeek,
    format,
    isSameDay,
    isSameMonth,
    isToday,
    startOfMonth,
    startOfWeek,
} from "date-fns"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
    Appointment,
    getAppointmentStatusColor,
    isAppointmentStatusTerminal,
} from "@/services/appointment-service"

export type CalendarViewMode = "month" | "week" | "day"

interface AppointmentCalendarProps {
    appointments: Appointment[]
    /** Called when the visible date range changes so the parent can refetch */
    onRangeChange?: (from: Date, to: Date) => void
    /** Called when an appointment is dropped on a new slot. Return a promise; calendar shows nothing while pending. */
    onReschedule: (appointment: Appointment, newStart: Date) => Promise<void> | void
    onSelectAppointment?: (appointment: Appointment) => void
    canReschedule?: boolean
}

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7) // 7am–8pm

function getLeadName(apt: Appointment): string {
    const c = apt.lead?.customer
    if (!c) return apt.title
    return c.full_name || `${c.first_name} ${c.last_name || ""}`.trim() || apt.title
}

function visibleRange(view: CalendarViewMode, anchor: Date): { from: Date; to: Date } {
    if (view === "month") {
        return {
            from: startOfWeek(startOfMonth(anchor), { weekStartsOn: 0 }),
            to: endOfWeek(endOfMonth(anchor), { weekStartsOn: 0 }),
        }
    }
    if (view === "week") {
        return { from: startOfWeek(anchor, { weekStartsOn: 0 }), to: endOfWeek(anchor, { weekStartsOn: 0 }) }
    }
    const from = new Date(anchor)
    from.setHours(0, 0, 0, 0)
    const to = new Date(anchor)
    to.setHours(23, 59, 59, 999)
    return { from, to }
}

export function AppointmentCalendar({
    appointments,
    onRangeChange,
    onReschedule,
    onSelectAppointment,
    canReschedule = true,
}: AppointmentCalendarProps) {
    const [view, setView] = React.useState<CalendarViewMode>("month")
    const [anchor, setAnchor] = React.useState<Date>(new Date())
    const [dragId, setDragId] = React.useState<string | null>(null)
    const [dropTarget, setDropTarget] = React.useState<string | null>(null)

    const range = React.useMemo(() => visibleRange(view, anchor), [view, anchor])

    React.useEffect(() => {
        onRangeChange?.(range.from, range.to)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range.from.getTime(), range.to.getTime()])

    const navigate = (dir: -1 | 1) => {
        setAnchor((prev) =>
            view === "month" ? addMonths(prev, dir) : view === "week" ? addWeeks(prev, dir) : addDays(prev, dir)
        )
    }

    const heading =
        view === "month"
            ? format(anchor, "MMMM yyyy")
            : view === "week"
              ? `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`
              : format(anchor, "EEEE, MMMM d, yyyy")

    const draggable = (apt: Appointment) => canReschedule && !isAppointmentStatusTerminal(apt.status)

    const handleDrop = async (e: React.DragEvent, day: Date, hour?: number) => {
        e.preventDefault()
        setDropTarget(null)
        const id = e.dataTransfer.getData("text/appointment-id") || dragId
        setDragId(null)
        if (!id) return
        const apt = appointments.find((a) => a.id === id)
        if (!apt || !draggable(apt)) return
        const prev = new Date(apt.scheduled_at)
        const next = new Date(day)
        if (hour != null) {
            next.setHours(hour, prev.getMinutes(), 0, 0)
        } else {
            next.setHours(prev.getHours(), prev.getMinutes(), 0, 0)
        }
        if (next.getTime() === prev.getTime()) return
        await onReschedule(apt, next)
    }

    const AptChip = ({ apt, compact }: { apt: Appointment; compact?: boolean }) => (
        <div
            draggable={draggable(apt)}
            onDragStart={(e) => {
                e.dataTransfer.setData("text/appointment-id", apt.id)
                e.dataTransfer.effectAllowed = "move"
                setDragId(apt.id)
            }}
            onDragEnd={() => {
                setDragId(null)
                setDropTarget(null)
            }}
            onClick={(e) => {
                e.stopPropagation()
                onSelectAppointment?.(apt)
            }}
            title={`${format(new Date(apt.scheduled_at), "p")} · ${getLeadName(apt)}`}
            className={cn(
                "truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-4",
                getAppointmentStatusColor(apt.status),
                draggable(apt) ? "cursor-grab active:cursor-grabbing" : "cursor-pointer opacity-80",
                dragId === apt.id && "opacity-40"
            )}
        >
            {!compact && <span className="mr-1 tabular-nums">{format(new Date(apt.scheduled_at), "h:mm a")}</span>}
            {getLeadName(apt)}
        </div>
    )

    return (
        <div className="rounded-lg border bg-card">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(1)}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 ml-1" onClick={() => setAnchor(new Date())}>
                        Today
                    </Button>
                    <h3 className="ml-3 text-sm font-semibold">{heading}</h3>
                </div>
                <div className="flex items-center rounded-md border p-0.5">
                    {(["month", "week", "day"] as const).map((v) => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => setView(v)}
                            className={cn(
                                "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                                view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            {v}
                        </button>
                    ))}
                </div>
            </div>

            {view === "month" ? (
                <div>
                    <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                            <div key={d} className="py-2">
                                {d}
                            </div>
                        ))}
                    </div>
                    <div className="grid grid-cols-7">
                        {eachDayOfInterval({ start: range.from, end: range.to }).map((day) => {
                            const dayApts = appointments
                                .filter((a) => isSameDay(new Date(a.scheduled_at), day))
                                .sort(
                                    (a, b) =>
                                        new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
                                )
                            const key = format(day, "yyyy-MM-dd")
                            return (
                                <div
                                    key={key}
                                    onDragOver={(e) => {
                                        if (!dragId) return
                                        e.preventDefault()
                                        setDropTarget(key)
                                    }}
                                    onDragLeave={() => setDropTarget((t) => (t === key ? null : t))}
                                    onDrop={(e) => handleDrop(e, day)}
                                    onClick={() => {
                                        setAnchor(day)
                                        setView("day")
                                    }}
                                    className={cn(
                                        "min-h-[96px] cursor-pointer border-b border-r p-1 transition-colors last:border-r-0",
                                        !isSameMonth(day, anchor) && "bg-muted/30 text-muted-foreground",
                                        dropTarget === key && "bg-primary/10 ring-1 ring-inset ring-primary"
                                    )}
                                >
                                    <div
                                        className={cn(
                                            "mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                                            isToday(day) && "bg-primary text-primary-foreground"
                                        )}
                                    >
                                        {format(day, "d")}
                                    </div>
                                    <div className="space-y-0.5">
                                        {dayApts.slice(0, 3).map((apt) => (
                                            <AptChip key={apt.id} apt={apt} />
                                        ))}
                                        {dayApts.length > 3 && (
                                            <div className="px-1.5 text-[10px] font-medium text-muted-foreground">
                                                +{dayApts.length - 3} more
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <div className="min-w-[640px]">
                        {/* Day headers (week view) */}
                        {view === "week" && (
                            <div className="grid border-b" style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}>
                                <div />
                                {eachDayOfInterval({ start: range.from, end: range.to }).map((day) => (
                                    <div
                                        key={day.toISOString()}
                                        className="border-l py-2 text-center text-xs font-medium"
                                    >
                                        <div className="text-muted-foreground">{format(day, "EEE")}</div>
                                        <div
                                            className={cn(
                                                "mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full",
                                                isToday(day) && "bg-primary text-primary-foreground"
                                            )}
                                        >
                                            {format(day, "d")}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* Hour grid */}
                        <div>
                            {HOURS.map((hour) => {
                                const days =
                                    view === "week"
                                        ? eachDayOfInterval({ start: range.from, end: range.to })
                                        : [anchor]
                                return (
                                    <div
                                        key={hour}
                                        className="grid border-b last:border-b-0"
                                        style={{
                                            gridTemplateColumns: `56px repeat(${days.length}, 1fr)`,
                                        }}
                                    >
                                        <div className="py-2 pr-2 text-right text-[11px] text-muted-foreground">
                                            {format(new Date(2000, 0, 1, hour), "h a")}
                                        </div>
                                        {days.map((day) => {
                                            const slotApts = appointments.filter((a) => {
                                                const d = new Date(a.scheduled_at)
                                                return isSameDay(d, day) && d.getHours() === hour
                                            })
                                            const key = `${format(day, "yyyy-MM-dd")}-${hour}`
                                            return (
                                                <div
                                                    key={key}
                                                    onDragOver={(e) => {
                                                        if (!dragId) return
                                                        e.preventDefault()
                                                        setDropTarget(key)
                                                    }}
                                                    onDragLeave={() =>
                                                        setDropTarget((t) => (t === key ? null : t))
                                                    }
                                                    onDrop={(e) => handleDrop(e, day, hour)}
                                                    className={cn(
                                                        "min-h-[44px] space-y-0.5 border-l p-0.5 transition-colors",
                                                        dropTarget === key &&
                                                            "bg-primary/10 ring-1 ring-inset ring-primary"
                                                    )}
                                                >
                                                    {slotApts.map((apt) => (
                                                        <AptChip key={apt.id} apt={apt} />
                                                    ))}
                                                </div>
                                            )
                                        })}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
