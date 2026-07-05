"use client"

import { Gauge } from "lucide-react"
import { cn } from "@/lib/utils"

function scoreStyles(score: number | null | undefined): string {
    if (score == null) {
        return "text-muted-foreground bg-muted/40 border-border"
    }
    if (score >= 70) {
        return "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-800"
    }
    if (score >= 40) {
        return "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800"
    }
    return "text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-950/40 dark:border-rose-800"
}

interface TrustScoreBadgeProps {
    score?: number | null
    label?: string
    title?: string
    className?: string
}

export function TrustScoreBadge({
    score,
    label = "Trust",
    title,
    className,
}: TrustScoreBadgeProps) {
    const display = score != null ? Math.round(score) : "—"
    const defaultTitle =
        score != null
            ? `${label}: ${Math.round(score)} (guest profile; uses linked customer data)`
            : `${label} score not calculated yet (open guest profile to score)`

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none shrink-0",
                scoreStyles(score),
                className
            )}
            title={title ?? defaultTitle}
        >
            <Gauge className="h-3 w-3 shrink-0" aria-hidden />
            {label} {display}
        </span>
    )
}
