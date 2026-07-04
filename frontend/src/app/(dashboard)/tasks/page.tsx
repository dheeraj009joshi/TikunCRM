"use client"

import * as React from "react"
import Link from "next/link"
import { format, isToday, isTomorrow, isPast } from "date-fns"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    AlertTriangle,
    CalendarClock,
    Check,
    CheckCircle2,
    ClipboardList,
    Loader2,
    Phone,
    Mail,
    MessageSquare,
    FileText,
    Plus,
    Sun,
    Trash2,
} from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
    Task,
    TaskPriority,
    TaskService,
    TaskType,
    TASK_PRIORITY_INFO,
    TASK_TYPE_INFO,
} from "@/services/task-service"

type Tab = "my_day" | "pending" | "completed"

const TYPE_ICONS: Record<TaskType, React.ComponentType<{ className?: string }>> = {
    call: Phone,
    email: Mail,
    sms: MessageSquare,
    whatsapp: MessageSquare,
    appointment_prep: CalendarClock,
    document: FileText,
    todo: ClipboardList,
}

function dueLabel(dueAt?: string): { text: string; overdue: boolean } | null {
    if (!dueAt) return null
    const d = new Date(dueAt)
    const overdue = isPast(d)
    if (isToday(d)) return { text: `Today ${format(d, "h:mm a")}`, overdue }
    if (isTomorrow(d)) return { text: `Tomorrow ${format(d, "h:mm a")}`, overdue: false }
    return { text: format(d, "MMM d, h:mm a"), overdue }
}

function NewTaskDialog({
    open,
    onOpenChange,
    onCreated,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onCreated: () => void
}) {
    const [title, setTitle] = React.useState("")
    const [description, setDescription] = React.useState("")
    const [taskType, setTaskType] = React.useState<TaskType>("todo")
    const [priority, setPriority] = React.useState<TaskPriority>("medium")
    const [dueDate, setDueDate] = React.useState("")
    const [dueTime, setDueTime] = React.useState("")
    const [saving, setSaving] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    const reset = () => {
        setTitle("")
        setDescription("")
        setTaskType("todo")
        setPriority("medium")
        setDueDate("")
        setDueTime("")
        setError(null)
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!title.trim()) return
        setSaving(true)
        setError(null)
        try {
            let due_at: string | undefined
            if (dueDate) {
                const d = new Date(`${dueDate}T${dueTime || "09:00"}`)
                due_at = d.toISOString()
            }
            await TaskService.create({
                title: title.trim(),
                description: description.trim() || undefined,
                task_type: taskType,
                priority,
                due_at,
            })
            reset()
            onOpenChange(false)
            onCreated()
        } catch {
            setError("Failed to create task")
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>New task</DialogTitle>
                </DialogHeader>
                <form onSubmit={submit} className="space-y-4">
                    {error && (
                        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
                    )}
                    <div className="space-y-2">
                        <Label htmlFor="task-title">Title *</Label>
                        <Input
                            id="task-title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="e.g. Call John about trade-in"
                            autoFocus
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label>Type</Label>
                            <Select value={taskType} onValueChange={(v) => setTaskType(v as TaskType)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(TASK_TYPE_INFO).map(([value, info]) => (
                                        <SelectItem key={value} value={value}>
                                            {info.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Priority</Label>
                            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {(["urgent", "high", "medium", "low"] as const).map((p) => (
                                        <SelectItem key={p} value={p}>
                                            {TASK_PRIORITY_INFO[p].label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label htmlFor="task-due-date">Due date</Label>
                            <Input
                                id="task-due-date"
                                type="date"
                                value={dueDate}
                                onChange={(e) => setDueDate(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="task-due-time">Time</Label>
                            <Input
                                id="task-due-time"
                                type="time"
                                value={dueTime}
                                onChange={(e) => setDueTime(e.target.value)}
                                disabled={!dueDate}
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="task-desc">Notes</Label>
                        <Textarea
                            id="task-desc"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                            placeholder="Optional details"
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={saving || !title.trim()}>
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Create task
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

export default function TasksPage() {
    const queryClient = useQueryClient()
    const [tab, setTab] = React.useState<Tab>("my_day")
    const [typeFilter, setTypeFilter] = React.useState<TaskType | "all">("all")
    const [priorityFilter, setPriorityFilter] = React.useState<TaskPriority | "all">("all")
    const [page, setPage] = React.useState(1)
    const [showNewTask, setShowNewTask] = React.useState(false)

    const params = React.useMemo(() => {
        const p: Parameters<typeof TaskService.list>[0] = { page, page_size: 25 }
        if (tab === "my_day") p.due_today = true
        else if (tab === "pending") p.status = "pending"
        else p.status = "completed"
        if (typeFilter !== "all") p.task_type = typeFilter
        if (priorityFilter !== "all") p.priority = priorityFilter
        return p
    }, [tab, typeFilter, priorityFilter, page])

    const { data, isLoading } = useQuery({
        queryKey: ["tasks", params],
        queryFn: () => TaskService.list(params),
    })

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tasks"] })

    const completeMutation = useMutation({
        mutationFn: (task: Task) =>
            task.status === "completed"
                ? TaskService.update(task.id, { status: "pending" })
                : TaskService.complete(task.id),
        onSuccess: invalidate,
    })

    const deleteMutation = useMutation({
        mutationFn: (id: string) => TaskService.delete(id),
        onSuccess: invalidate,
    })

    const stats = data?.stats
    const tasks = data?.items ?? []

    const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }>; count?: number }[] = [
        { key: "my_day", label: "My Day", icon: Sun, count: stats ? stats.due_today + stats.overdue : undefined },
        { key: "pending", label: "All pending", icon: ClipboardList, count: stats?.pending },
        { key: "completed", label: "Completed", icon: CheckCircle2 },
    ]

    return (
        <div className="space-y-6">
            <PageHeader
                title="Tasks"
                description="Your work queue — calls, messages, and to-dos in one place"
                actions={
                    <Button onClick={() => setShowNewTask(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        New Task
                    </Button>
                }
            />

            {/* Stats strip */}
            {stats && (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    {[
                        { label: "Due today", value: stats.due_today, icon: Sun, tone: "text-blue-600" },
                        { label: "Overdue", value: stats.overdue, icon: AlertTriangle, tone: "text-red-600" },
                        { label: "Pending", value: stats.pending, icon: ClipboardList, tone: "text-amber-600" },
                        { label: "Completed", value: stats.completed, icon: CheckCircle2, tone: "text-emerald-600" },
                    ].map((s) => (
                        <div key={s.label} className="rounded-lg border bg-card p-4">
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-muted-foreground">{s.label}</p>
                                <s.icon className={cn("h-4 w-4", s.tone)} />
                            </div>
                            <p className="mt-1 text-2xl font-bold">{s.value}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Tabs + filters */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center rounded-md border p-0.5">
                    {TABS.map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => {
                                setTab(t.key)
                                setPage(1)
                            }}
                            className={cn(
                                "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
                                tab === t.key
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <t.icon className="h-4 w-4" />
                            {t.label}
                            {t.count != null && t.count > 0 && (
                                <span
                                    className={cn(
                                        "ml-0.5 rounded-full px-1.5 text-[10px] font-bold",
                                        tab === t.key ? "bg-primary-foreground/20" : "bg-muted"
                                    )}
                                >
                                    {t.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <Select
                        value={typeFilter}
                        onValueChange={(v) => {
                            setTypeFilter(v as TaskType | "all")
                            setPage(1)
                        }}
                    >
                        <SelectTrigger className="h-9 w-[150px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All types</SelectItem>
                            {Object.entries(TASK_TYPE_INFO).map(([value, info]) => (
                                <SelectItem key={value} value={value}>
                                    {info.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select
                        value={priorityFilter}
                        onValueChange={(v) => {
                            setPriorityFilter(v as TaskPriority | "all")
                            setPage(1)
                        }}
                    >
                        <SelectTrigger className="h-9 w-[140px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All priorities</SelectItem>
                            {(["urgent", "high", "medium", "low"] as const).map((p) => (
                                <SelectItem key={p} value={p}>
                                    {TASK_PRIORITY_INFO[p].label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Task list */}
            <div className="overflow-hidden rounded-lg border bg-card">
                {isLoading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : tasks.length === 0 ? (
                    <EmptyState
                        icon={tab === "my_day" ? <Sun /> : <ClipboardList />}
                        title={
                            tab === "my_day"
                                ? "Your day is clear"
                                : tab === "pending"
                                  ? "No pending tasks"
                                  : "No completed tasks yet"
                        }
                        description={
                            tab === "completed"
                                ? "Tasks you complete will show up here."
                                : "Create a task to keep your follow-through on track."
                        }
                        action={
                            tab !== "completed"
                                ? { label: "New Task", onClick: () => setShowNewTask(true) }
                                : undefined
                        }
                    />
                ) : (
                    <div className="divide-y">
                        {tasks.map((task) => {
                            const Icon = TYPE_ICONS[task.task_type] ?? ClipboardList
                            const due = dueLabel(task.due_at)
                            const done = task.status === "completed"
                            return (
                                <div key={task.id} className="flex items-start gap-3 p-4">
                                    <button
                                        type="button"
                                        onClick={() => completeMutation.mutate(task)}
                                        disabled={completeMutation.isPending}
                                        title={done ? "Reopen task" : "Mark complete"}
                                        className={cn(
                                            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                                            done
                                                ? "border-emerald-500 bg-emerald-500 text-white"
                                                : "border-muted-foreground/40 hover:border-primary"
                                        )}
                                    >
                                        {done && <Check className="h-3 w-3" />}
                                    </button>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span
                                                className={cn(
                                                    "text-sm font-medium",
                                                    done && "text-muted-foreground line-through"
                                                )}
                                            >
                                                {task.title}
                                            </span>
                                            <Badge
                                                variant="outline"
                                                className={cn("text-[10px]", TASK_PRIORITY_INFO[task.priority].className)}
                                            >
                                                {TASK_PRIORITY_INFO[task.priority].label}
                                            </Badge>
                                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <Icon className="h-3 w-3" />
                                                {TASK_TYPE_INFO[task.task_type].label}
                                            </span>
                                        </div>
                                        {task.description && (
                                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                                {task.description}
                                            </p>
                                        )}
                                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                            {due && (
                                                <span
                                                    className={cn(
                                                        "flex items-center gap-1",
                                                        due.overdue && !done && "font-medium text-red-600"
                                                    )}
                                                >
                                                    <CalendarClock className="h-3 w-3" />
                                                    {due.text}
                                                    {due.overdue && !done && " · overdue"}
                                                </span>
                                            )}
                                            {task.lead && (
                                                <Link
                                                    href={`/leads/${task.lead.id}`}
                                                    className="text-primary hover:underline"
                                                >
                                                    {[task.lead.first_name, task.lead.last_name].filter(Boolean).join(" ") ||
                                                        "View lead"}
                                                </Link>
                                            )}
                                            {task.assigned_to_user && (
                                                <span>
                                                    {task.assigned_to_user.first_name} {task.assigned_to_user.last_name}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                        onClick={() => {
                                            if (confirm("Delete this task?")) deleteMutation.mutate(task.id)
                                        }}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Pagination */}
            {data && data.total_pages > 1 && (
                <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                        Page {data.page} of {data.total_pages}
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => p - 1)}
                        >
                            Previous
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page >= data.total_pages}
                            onClick={() => setPage((p) => p + 1)}
                        >
                            Next
                        </Button>
                    </div>
                </div>
            )}

            <NewTaskDialog open={showNewTask} onOpenChange={setShowNewTask} onCreated={invalidate} />
        </div>
    )
}
