"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
    icon?: React.ReactNode
    title: string
    description?: string
    action?: {
        label: string
        onClick: () => void
    }
    /** Compact variant for embedding inside cards/panels */
    compact?: boolean
}

/**
 * Standard empty state used across tables, lists, and panels.
 * Replaces the ad-hoc icon+text patterns scattered across pages.
 */
export function EmptyState({
    icon,
    title,
    description,
    action,
    compact = false,
    className,
    ...props
}: EmptyStateProps) {
    return (
        <div
            className={cn(
                "flex flex-col items-center justify-center text-center",
                compact ? "gap-2 py-8 px-4" : "gap-3 py-16 px-6",
                className
            )}
            {...props}
        >
            {icon && (
                <div
                    className={cn(
                        "flex items-center justify-center rounded-full bg-muted text-muted-foreground",
                        compact ? "h-10 w-10 [&>svg]:h-5 [&>svg]:w-5" : "h-14 w-14 [&>svg]:h-7 [&>svg]:w-7"
                    )}
                >
                    {icon}
                </div>
            )}
            <div className="space-y-1">
                <p className={cn("font-semibold", compact ? "text-sm" : "text-base")}>{title}</p>
                {description && (
                    <p className={cn("text-muted-foreground max-w-sm mx-auto", compact ? "text-xs" : "text-sm")}>
                        {description}
                    </p>
                )}
            </div>
            {action && (
                <Button size={compact ? "sm" : "default"} onClick={action.onClick} className="mt-1">
                    {action.label}
                </Button>
            )}
        </div>
    )
}
