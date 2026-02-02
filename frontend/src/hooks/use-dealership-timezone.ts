"use client"

import * as React from "react"
import { useAuthStore } from "@/stores/auth-store"
import { DealershipService } from "@/services/dealership-service"

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
