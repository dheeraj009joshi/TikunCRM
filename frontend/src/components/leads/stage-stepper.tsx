"use client"

import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import type { LeadStage } from "@/services/lead-stage-service"

interface StageStepperProps {
    stages: LeadStage[]
    /** Current stage name */
    currentStageName: string | undefined
    /** Called with the stage name when a step is clicked */
    onSelect?: (stageName: string) => void
    disabled?: boolean
    /** Stage names to hide from the stepper (workflow-only stages) */
    hiddenStages?: string[]
    className?: string
}

/**
 * Horizontal pipeline progression for the lead detail header.
 * Non-terminal stages render as connected steps; when the lead is in a
 * terminal stage the stepper shows the outcome badge at the end.
 */
export function StageStepper({
    stages,
    currentStageName,
    onSelect,
    disabled = false,
    hiddenStages = [],
    className,
}: StageStepperProps) {
    const ordered = React.useMemo(
        () => [...stages].sort((a, b) => a.order - b.order),
        [stages]
    )
    const current = ordered.find((s) => s.name === currentStageName)
    const steps = React.useMemo(
        () =>
            ordered.filter(
                (s) =>
                    !s.is_terminal &&
                    (!hiddenStages.includes(s.name) || s.name === currentStageName)
            ),
        [ordered, hiddenStages, currentStageName]
    )

    if (steps.length === 0) return null

    const currentIndex = current && !current.is_terminal ? steps.findIndex((s) => s.id === current.id) : -1
    const isTerminal = Boolean(current?.is_terminal)

    return (
        <div className={cn("w-full overflow-x-auto no-scrollbar", className)}>
            <div className="flex min-w-max items-center gap-0.5 py-1">
                {steps.map((stage, i) => {
                    const isCurrent = currentIndex === i
                    const isPast = currentIndex > i || (isTerminal && current?.name !== "lost")
                    const clickable = Boolean(onSelect) && !disabled && !isCurrent
                    return (
                        <React.Fragment key={stage.id}>
                            {i > 0 && (
                                <div
                                    className={cn(
                                        "h-px w-4 shrink-0",
                                        isPast || isCurrent ? "bg-primary/50" : "bg-border"
                                    )}
                                />
                            )}
                            <button
                                type="button"
                                onClick={() => clickable && onSelect?.(stage.name)}
                                disabled={!clickable}
                                title={stage.display_name}
                                className={cn(
                                    "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                                    isCurrent
                                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                        : isPast
                                          ? "border-primary/30 bg-primary/10 text-primary"
                                          : "border-border text-muted-foreground",
                                    clickable && "cursor-pointer hover:border-primary/60 hover:text-foreground"
                                )}
                            >
                                {isPast && !isCurrent && <Check className="h-3 w-3" />}
                                {stage.display_name}
                            </button>
                        </React.Fragment>
                    )
                })}
                {isTerminal && current && (
                    <>
                        <div className="h-px w-4 shrink-0 bg-border" />
                        <span
                            className="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold"
                            style={{
                                borderColor: current.color ?? undefined,
                                color: current.color ?? undefined,
                                backgroundColor: current.color ? `${current.color}14` : undefined,
                            }}
                        >
                            {current.display_name}
                        </span>
                    </>
                )}
            </div>
        </div>
    )
}
