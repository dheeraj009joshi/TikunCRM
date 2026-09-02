"use client"

import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

interface CampaignTargetingInfoProps {
    message?: string | null
    className?: string
}

/** Info icon with native tooltip for campaign targeting / audience notes. */
export function CampaignTargetingInfo({ message, className }: CampaignTargetingInfoProps) {
    const text = message?.trim()
    if (!text) return null

    return (
        <span
            className={cn(
                "inline-flex shrink-0 text-muted-foreground hover:text-foreground cursor-help",
                className
            )}
            title={text}
            aria-label="Targeting details"
            role="img"
        >
            <Info className="h-3.5 w-3.5" />
        </span>
    )
}

interface CampaignDisplayWithTargetingProps {
    displayName: string
    targetingMessage?: string | null
    nameClassName?: string
}

/** Display name with optional targeting info icon beside it. */
export function CampaignDisplayWithTargeting({
    displayName,
    targetingMessage,
    nameClassName,
}: CampaignDisplayWithTargetingProps) {
    return (
        <span className="inline-flex items-center gap-1.5 min-w-0">
            <span className={cn("font-medium truncate", nameClassName)} title={displayName}>
                {displayName}
            </span>
            <CampaignTargetingInfo message={targetingMessage} />
        </span>
    )
}
