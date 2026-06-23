"use client"

import * as React from "react"
import { useAuthStore } from "@/stores/auth-store"
import { DealershipService } from "@/services/dealership-service"

/** Default timezone when dealership timezone is not set or during loading */
const DEFAULT_TIMEZONE = "America/New_York"

/** Cache for dealership timezones to avoid repeated API calls */
const timezoneCache = new Map<string, string>()

/**
 * Hook to get the dealership's configured timezone.
 * Used specifically for appointment times which should display in dealership business hours.
 * 
 * For other timestamps (lead activity, notifications, etc.), use the browser's local timezone
 * via `useBrowserTimezone` or `formatDateInLocal()`.
 */
export function useDealershipTimezone() {
    const { user } = useAuthStore()
    const [dealershipTimezone, setDealershipTimezone] = React.useState<string>(DEFAULT_TIMEZONE)
    const [isLoading, setIsLoading] = React.useState(true)

    React.useEffect(() => {
        async function fetchDealershipTimezone() {
            const dealershipId = user?.dealership_id
            
            if (!dealershipId) {
                setDealershipTimezone(DEFAULT_TIMEZONE)
                setIsLoading(false)
                return
            }

            // Check cache first
            const cached = timezoneCache.get(dealershipId)
            if (cached) {
                setDealershipTimezone(cached)
                setIsLoading(false)
                return
            }

            try {
                const dealership = await DealershipService.getDealership(dealershipId)
                const tz = dealership.timezone || DEFAULT_TIMEZONE
                timezoneCache.set(dealershipId, tz)
                setDealershipTimezone(tz)
            } catch (error) {
                console.warn("[useDealershipTimezone] Failed to fetch dealership timezone:", error)
                setDealershipTimezone(DEFAULT_TIMEZONE)
            } finally {
                setIsLoading(false)
            }
        }

        fetchDealershipTimezone()
    }, [user?.dealership_id])

    return { dealershipTimezone, isLoading }
}

/**
 * Clear the timezone cache (useful when dealership settings are updated)
 */
export function clearDealershipTimezoneCache(dealershipId?: string) {
    if (dealershipId) {
        timezoneCache.delete(dealershipId)
    } else {
        timezoneCache.clear()
    }
}
