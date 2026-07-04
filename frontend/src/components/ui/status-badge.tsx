"use client"

import * as React from "react"
import { Badge, getStatusVariant, normalizeStatusKey } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface StatusBadgeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "color"> {
    /** Stage/status name or display name, e.g. "In Showroom" or "in_showroom" */
    status: string
    /** Optional display label; falls back to a title-cased version of status */
    label?: string
    /** Optional hex color from the configurable lead_stages table; overrides the variant palette */
    color?: string | null
    size?: "sm" | "default" | "lg"
    dot?: boolean
}

function titleCase(value: string): string {
    return normalizeStatusKey(value)
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
}

/**
 * Canonical status badge for lead stages, appointment statuses, and outcomes.
 * Uses the shared variant palette; supports per-dealership custom stage colors.
 */
export function StatusBadge({
    status,
    label,
    color,
    size = "default",
    dot = true,
    className,
    style,
    ...props
}: StatusBadgeProps) {
    const customStyle = color
        ? {
              backgroundColor: `${color}1a`,
              color: color,
              ...style,
          }
        : style

    return (
        <Badge
            variant={color ? "outline" : getStatusVariant(status)}
            size={size}
            dot={dot}
            className={cn(color && "border-transparent", className)}
            style={customStyle}
            {...props}
        >
            {label ?? titleCase(status)}
        </Badge>
    )
}
