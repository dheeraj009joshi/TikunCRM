"use client"

import * as React from "react"
import Link from "next/link"
import {
    DndContext,
    DragOverlay,
    closestCorners,
    PointerSensor,
    useSensor,
    useSensors,
    type DragStartEvent,
    type DragEndEvent,
} from "@dnd-kit/core"
import { useDroppable } from "@dnd-kit/core"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Phone, Mail, Loader2, Target, DollarSign } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/ui/avatar"
import { Lead, getLeadFullName, getLeadPhone, getLeadEmail } from "@/services/lead-service"
import { LeadStage } from "@/services/lead-stage-service"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone } from "@/utils/timezone"
import { cn } from "@/lib/utils"

function PipelineLeadCard({ lead, isDragging }: { lead: Lead; isDragging?: boolean }) {
    const { timezone } = useBrowserTimezone()
    const name = getLeadFullName(lead)
    const phone = getLeadPhone(lead)
    const email = getLeadEmail(lead)
    const assignedUser = lead.assigned_to_user

    return (
        <Link href={`/leads/${lead.id}`}>
            <div
                className={cn(
                    "rounded-lg border bg-card p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer",
                    isDragging && "opacity-50 ring-2 ring-primary"
                )}
            >
                <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{name}</p>
                        {phone && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                                <Phone className="h-3 w-3 shrink-0" />
                                {phone}
                            </p>
                        )}
                        {email && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                                <Mail className="h-3 w-3 shrink-0" />
                                {email}
                            </p>
                        )}
                    </div>
                    {assignedUser && (
                        <UserAvatar
                            className="shrink-0"
                            firstName={assignedUser.first_name}
                            lastName={assignedUser.last_name}
                            size="sm"
                        />
                    )}
                </div>
                {assignedUser && (
                    <div className="flex items-center gap-1.5 mt-2 py-1.5 px-2 rounded-md bg-muted/50 w-full">
                        <span className="text-[10px] text-muted-foreground shrink-0">Assigned to</span>
                        <span className="text-xs font-medium text-foreground truncate" title={`${assignedUser.first_name} ${assignedUser.last_name}`}>
                            {assignedUser.first_name} {assignedUser.last_name}
                        </span>
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                    <Badge variant="outline" className="text-[10px]">
                        {lead.source.replace("_", " ")}
                    </Badge>
                    {lead.interest_score > 0 && (
                        <span className="text-[10px] text-amber-600 font-medium">
                            Score: {lead.interest_score}
                        </span>
                    )}
                </div>
                {(lead.interested_in || lead.budget_range) && (
                    <div className="mt-1.5 space-y-0.5">
                        {lead.interested_in && (
                            <p className="text-[10px] text-muted-foreground flex items-center gap-1 truncate">
                                <Target className="h-2.5 w-2.5 shrink-0" />
                                {lead.interested_in}
                            </p>
                        )}
                        {lead.budget_range && (
                            <p className="text-[10px] text-muted-foreground flex items-center gap-1 truncate">
                                <DollarSign className="h-2.5 w-2.5 shrink-0" />
                                {lead.budget_range}
                            </p>
                        )}
                    </div>
                )}
                <p className="text-[10px] text-muted-foreground mt-1.5">
                    {formatDateInTimezone(lead.created_at, timezone, { dateStyle: "medium" })}
                </p>
            </div>
        </Link>
    )
}

function DraggablePipelineCard({ lead }: { lead: Lead }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: lead.id,
        data: { lead },
    })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <PipelineLeadCard lead={lead} isDragging={isDragging} />
        </div>
    )
}

function PipelineStageColumn({
    stage,
    leads,
    isTerminal,
    paginationMeta,
    isLoadingMore,
    onLoadMore,
}: {
    stage: LeadStage
    leads: Lead[]
    isTerminal: boolean
    paginationMeta?: { page: number; hasMore: boolean; total: number }
    isLoadingMore?: boolean
    onLoadMore?: () => void
}) {
    const { setNodeRef, isOver } = useDroppable({ id: stage.id })
    const sentinelRef = React.useRef<HTMLDivElement>(null)
    const scrollContainerRef = React.useRef<HTMLDivElement>(null)
    const onLoadMoreRef = React.useRef(onLoadMore)
    onLoadMoreRef.current = onLoadMore

    React.useEffect(() => {
        if (!onLoadMoreRef.current || !paginationMeta?.hasMore || isLoadingMore) return
        const el = sentinelRef.current
        if (!el) return
        const root = scrollContainerRef.current ?? null
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) onLoadMoreRef.current?.()
            },
            { root, rootMargin: "200px", threshold: 0 }
        )
        observer.observe(el)
        return () => observer.disconnect()
    }, [paginationMeta?.hasMore, isLoadingMore])

    // Show total leads in this stage for the dealership (from API), not how many are loaded
    const countLabel = paginationMeta != null && paginationMeta.total !== undefined
        ? String(paginationMeta.total)
        : String(leads.length)

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "flex flex-col rounded-xl border bg-muted/30 min-w-[280px] max-w-[320px] w-[300px]",
                isOver && "ring-2 ring-primary/50",
                isTerminal && "opacity-70"
            )}
        >
            <div className="flex items-center gap-2 px-3 py-2 border-b">
                <div
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: stage.color || "#6B7280" }}
                />
                <h3 className="font-semibold text-sm truncate">{stage.display_name}</h3>
                <Badge variant="secondary" className="ml-auto text-[10px]">
                    {countLabel}
                </Badge>
            </div>
            <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[calc(100vh-260px)]"
            >
                {leads.map((lead) => (
                    <DraggablePipelineCard key={lead.id} lead={lead} />
                ))}
                {paginationMeta?.hasMore && (
                    <div ref={sentinelRef} className="min-h-[1px] flex items-center justify-center py-2">
                        {isLoadingMore ? (
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        ) : null}
                    </div>
                )}
                {leads.length === 0 && !paginationMeta?.hasMore && (
                    <div className="text-center text-xs text-muted-foreground py-8">
                        No leads
                    </div>
                )}
            </div>
        </div>
    )
}

export interface StagePaginationMeta {
    page: number
    hasMore: boolean
    total: number
}

export interface LeadsPipelineViewProps {
    stages: LeadStage[]
    leadsByStage: Record<string, Lead[]>
    stagePagination?: Record<string, StagePaginationMeta>
    loadingMoreStageId?: string | null
    isLoading: boolean
    onDragEnd: (event: DragEndEvent) => void | Promise<void>
    onLoadMore?: (stageId: string) => void | Promise<void>
    onRefresh?: () => void
}

export function LeadsPipelineView({
    stages,
    leadsByStage,
    stagePagination = {},
    loadingMoreStageId = null,
    isLoading,
    onDragEnd,
    onLoadMore,
}: LeadsPipelineViewProps) {
    const [activeId, setActiveId] = React.useState<string | null>(null)

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    )

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string)
    }

    const handleDragEnd = async (event: DragEndEvent) => {
        setActiveId(null)
        await onDragEnd(event)
    }

    const activeLead = React.useMemo(() => {
        if (!activeId) return null
        for (const leads of Object.values(leadsByStage)) {
            const found = leads.find((l) => l.id === activeId)
            if (found) return found
        }
        return null
    }, [activeId, leadsByStage])

    if (isLoading) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="w-full min-w-0 overflow-x-auto">
            <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
            >
                <div className="flex gap-4 pb-4 min-w-max">
                    {stages.map((stage) => (
                        <PipelineStageColumn
                            key={stage.id}
                            stage={stage}
                            leads={leadsByStage[stage.id] || []}
                            isTerminal={stage.is_terminal}
                            paginationMeta={stagePagination[stage.id]}
                            isLoadingMore={loadingMoreStageId === stage.id}
                            onLoadMore={onLoadMore ? () => onLoadMore(stage.id) : undefined}
                        />
                    ))}
                </div>
                <DragOverlay>
                    {activeLead ? <PipelineLeadCard lead={activeLead} isDragging /> : null}
                </DragOverlay>
            </DndContext>
        </div>
    )
}
