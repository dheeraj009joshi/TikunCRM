"use client"

import * as React from "react"
import { Loader2, Gauge } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    EligibilityService,
    type EligibilityAssessment,
    type AssessmentItemState,
    type EligibilityEntityType,
} from "@/services/eligibility-service"

interface EligibilityPanelProps {
    entityType: EligibilityEntityType
    entityId: string
    readOnly?: boolean
    title?: string
    /** When provided, called with the latest total score after every change. */
    onScoreChange?: (score: number) => void
    className?: string
}

function scoreColor(score: number): string {
    if (score >= 70) return "text-emerald-600 dark:text-emerald-400"
    if (score >= 40) return "text-amber-600 dark:text-amber-400"
    return "text-rose-600 dark:text-rose-400"
}

function scoreBand(score: number): string {
    if (score >= 70) return "High"
    if (score >= 40) return "Medium"
    return "Low"
}

function ScoreGauge({ score }: { score: number }) {
    const pct = Math.max(0, Math.min(100, score))
    const radius = 42
    const circumference = 2 * Math.PI * radius
    const offset = circumference - (pct / 100) * circumference
    return (
        <div className="relative h-28 w-28">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="8" className="stroke-muted" />
                <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    strokeWidth="8"
                    strokeLinecap="round"
                    className={`${scoreColor(score)} transition-all duration-500`}
                    stroke="currentColor"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-2xl font-bold ${scoreColor(score)}`}>{Math.round(score)}</span>
                <span className="text-[10px] uppercase text-muted-foreground">{scoreBand(score)}</span>
            </div>
        </div>
    )
}

function NumberCriterionInput({
    item,
    readOnly,
    isSaving,
    onCommit,
}: {
    item: AssessmentItemState
    readOnly: boolean
    isSaving: boolean
    onCommit: (value: number) => void
}) {
    const initial =
        (item.value?.number as number | undefined) ??
        (typeof item.auto_value === "number" ? item.auto_value : undefined)
    const [localValue, setLocalValue] = React.useState(initial?.toString() ?? "")
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

    React.useEffect(() => {
        const next =
            (item.value?.number as number | undefined) ??
            (typeof item.auto_value === "number" ? item.auto_value : undefined)
        setLocalValue(next?.toString() ?? "")
    }, [item.criterion_id, item.value?.number, item.auto_value])

    React.useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current)
    }, [])

    const scheduleCommit = (raw: string) => {
        if (timerRef.current) clearTimeout(timerRef.current)
        if (raw.trim() === "") return
        const parsed = Number(raw)
        if (Number.isNaN(parsed)) return
        timerRef.current = setTimeout(() => onCommit(parsed), 500)
    }

    return (
        <Input
            type="number"
            disabled={readOnly || isSaving}
            value={localValue}
            className="mt-2 h-8 w-40"
            placeholder="Enter value"
            onChange={(e) => {
                setLocalValue(e.target.value)
                scheduleCommit(e.target.value)
            }}
            onBlur={(e) => {
                if (timerRef.current) clearTimeout(timerRef.current)
                const raw = e.target.value
                if (raw.trim() === "") return
                const parsed = Number(raw)
                if (!Number.isNaN(parsed)) onCommit(parsed)
            }}
        />
    )
}

export function EligibilityPanel({
    entityType,
    entityId,
    readOnly = false,
    title = "Trust Score",
    onScoreChange,
    className,
}: EligibilityPanelProps) {
    const [assessment, setAssessment] = React.useState<EligibilityAssessment | null>(null)
    const [isLoading, setIsLoading] = React.useState(true)
    const [savingId, setSavingId] = React.useState<string | null>(null)
    const onScoreChangeRef = React.useRef(onScoreChange)
    onScoreChangeRef.current = onScoreChange

    const load = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const data = await EligibilityService.getAssessment(entityType, entityId)
            setAssessment(data)
            onScoreChangeRef.current?.(data.total_score)
        } catch (e) {
            console.error("Failed to load eligibility assessment", e)
        } finally {
            setIsLoading(false)
        }
    }, [entityType, entityId])

    React.useEffect(() => {
        void load()
    }, [load])

    const commit = async (criterionId: string, payload: { is_met?: boolean; value?: Record<string, unknown> | null }) => {
        if (readOnly) return
        setSavingId(criterionId)
        try {
            const updated = await EligibilityService.setItem(entityType, entityId, criterionId, {
                ...payload,
                is_override: true,
            })
            setAssessment(updated)
            onScoreChangeRef.current?.(updated.total_score)
        } catch (e) {
            console.error("Failed to update criterion", e)
        } finally {
            setSavingId(null)
        }
    }

    const grouped = React.useMemo(() => {
        const map = new Map<string, AssessmentItemState[]>()
        for (const item of assessment?.items ?? []) {
            const arr = map.get(item.category) ?? []
            arr.push(item)
            map.set(item.category, arr)
        }
        return Array.from(map.entries())
    }, [assessment])

    return (
        <Card className={className}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                    <Gauge className="h-4 w-4" />
                    {title}
                </CardTitle>
                {assessment && (
                    <Badge variant="outline" className="text-xs">
                        {Number(assessment.raw_points).toFixed(0)} / {Number(assessment.max_points).toFixed(0)} pts
                    </Badge>
                )}
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="flex h-32 items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : !assessment || assessment.items.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        No eligibility criteria configured. An admin or BDC agent can add them in Settings → Eligibility Criteria.
                    </p>
                ) : (
                    <div className="space-y-4">
                        <div className="flex items-center gap-4">
                            <ScoreGauge score={assessment.total_score} />
                            <div className="text-sm text-muted-foreground">
                                Score reflects the weighted criteria below. Update them as you learn more about the customer.
                            </div>
                        </div>

                        <div className="space-y-4">
                            {grouped.map(([category, items]) => (
                                <div key={category} className="space-y-2">
                                    <p className="text-xs font-semibold uppercase text-muted-foreground">{category}</p>
                                    <div className="space-y-2">
                                        {items.map((item) => (
                                            <div key={item.criterion_id} className="flex items-start gap-3 rounded-md border p-2.5">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-sm font-medium">{item.label}</span>
                                                        <Badge variant="outline" className="text-[10px]">wt {Number(item.weight)}</Badge>
                                                        {item.value_source === "auto" && item.auto_value != null && (
                                                            <span className="text-[10px] text-muted-foreground">from data: {String(item.auto_value)}</span>
                                                        )}
                                                    </div>
                                                    {item.description && (
                                                        <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                                                    )}

                                                    {/* Number input */}
                                                    {item.input_type === "number" && (
                                                        <NumberCriterionInput
                                                            item={item}
                                                            readOnly={readOnly}
                                                            isSaving={savingId === item.criterion_id}
                                                            onCommit={(n) =>
                                                                commit(item.criterion_id, { value: { number: n } })
                                                            }
                                                        />
                                                    )}

                                                    {/* Select dropdown */}
                                                    {item.input_type === "select" && (
                                                        <Select
                                                            disabled={readOnly || savingId === item.criterion_id}
                                                            value={(item.value?.option as string | undefined) ?? ""}
                                                            onValueChange={(v) => commit(item.criterion_id, { value: { option: v } })}
                                                        >
                                                            <SelectTrigger className="mt-2 h-8 w-48">
                                                                <SelectValue placeholder="Select" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {(item.config.options ?? []).map((o) => (
                                                                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text-xs tabular-nums text-muted-foreground">
                                                        +{Number(item.points).toFixed(0)}
                                                    </span>
                                                    {item.input_type === "boolean" ? (
                                                        savingId === item.criterion_id ? (
                                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                        ) : (
                                                            <Checkbox
                                                                checked={item.is_met}
                                                                disabled={readOnly}
                                                                onCheckedChange={(checked) =>
                                                                    commit(item.criterion_id, { is_met: checked === true })
                                                                }
                                                            />
                                                        )
                                                    ) : (
                                                        item.is_met && <Badge variant="secondary" className="text-[10px]">met</Badge>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
