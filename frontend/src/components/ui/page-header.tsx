"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
    title: string
    description?: string
    /** Right-aligned actions (buttons, filters) */
    actions?: React.ReactNode
}

/**
 * Standard page header: title + optional description on the left,
 * actions on the right. Use at the top of every dashboard page for
 * consistent hierarchy and spacing.
 */
export function PageHeader({ title, description, actions, className, children, ...props }: PageHeaderProps) {
    return (
        <div
            className={cn(
                "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
                className
            )}
            {...props}
        >
            <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
                {description && <p className="text-sm text-muted-foreground">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            {children}
        </div>
    )
}
