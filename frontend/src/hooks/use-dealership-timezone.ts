"use client"

import * as React from "react"
import { useAuthStore } from "@/stores/auth-store"
import { DealershipService } from "@/services/dealership-service"

/**
 * Format a date in a specific timezone
 */
export function formatDateInTimezone(
    date: Date | string | null | undefined,
    timezone: string,
    options?: Intl.DateTimeFormatOptions
): string {
    if (!date) return "-"
    
    try {
        const dateObj = typeof date === "string" ? new Date(date) : date
        
        const defaultOptions: Intl.DateTimeFormatOptions = {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: timezone,
            ...options
        }
        
        return new Intl.DateTimeFormat("en-US", defaultOptions).format(dateObj)
    } catch (error) {
        console.error("Error formatting date:", error)
        return String(date)
    }
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTimeInTimezone(
    date: Date | string | null | undefined,
    timezone: string
): string {
    if (!date) return "-"
    
    try {
        const dateObj = typeof date === "string" ? new Date(date) : date
        const now = new Date()
        const diffMs = now.getTime() - dateObj.getTime()
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMs / 3600000)
        const diffDays = Math.floor(diffMs / 86400000)
        
        if (diffMins < 1) return "Just now"
        if (diffMins < 60) return `${diffMins}m ago`
        if (diffHours < 24) return `${diffHours}h ago`
        if (diffDays < 7) return `${diffDays}d ago`
        
        return formatDateInTimezone(date, timezone, {
            year: "numeric",
            month: "short",
            day: "numeric"
        })
    } catch (error) {
        return String(date)
    }
}

/**
 * Hook to get the current user's dealership timezone
 * Returns "UTC" as fallback if user has no dealership or timezone not set
 */
export function useDealershipTimezone() {
    const { user } = useAuthStore()
    const [timezone, setTimezone] = React.useState<string>("UTC")
    const [isLoading, setIsLoading] = React.useState(true)

    React.useEffect(() => {
        const fetchTimezone = async () => {
            if (!user?.dealership_id) {
                setTimezone("UTC")
                setIsLoading(false)
                return
            }

            try {
                const dealership = await DealershipService.getDealership(user.dealership_id)
                setTimezone(dealership.timezone || "UTC")
            } catch (error) {
                console.error("Failed to fetch dealership timezone:", error)
                setTimezone("UTC")
            } finally {
                setIsLoading(false)
            }
        }

        fetchTimezone()
    }, [user?.dealership_id])

    return { timezone, isLoading }
}
