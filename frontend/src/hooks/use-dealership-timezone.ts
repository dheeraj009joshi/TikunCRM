"use client"

import * as React from "react"
import { useAuthStore } from "@/stores/auth-store"
import { DealershipService } from "@/services/dealership-service"

/** Fallback only when a dealership has no timezone string at all */
const DEFAULT_TIMEZONE = "America/New_York"

/** Cache for dealership timezones to avoid repeated API calls */
const timezoneCache = new Map<string, string>()

/**
 * Fetch (and cache) a dealership's configured IANA timezone.
 * Source of truth: dealership.timezone from the API — never remapped.
 */
export async function fetchDealershipTimezone(dealershipId: string): Promise<string> {
    const cached = timezoneCache.get(dealershipId)
    if (cached) return cached

    const dealership = await DealershipService.getDealership(dealershipId)
    const tz = (dealership.timezone || "").trim() || DEFAULT_TIMEZONE
    timezoneCache.set(dealershipId, tz)
    return tz
}

/**
 * Hook to get a dealership's configured timezone for appointment/follow-up display.
 *
 * @param dealershipId - Prefer the appointment/lead's dealership. Falls back to the
 *   signed-in user's dealership_id. Super admins must pass the entity dealership id.
 *
 * For other timestamps (lead activity, notifications, etc.), use browser local time.
 */
export function useDealershipTimezone(dealershipId?: string | null) {
    const { user } = useAuthStore()
    const resolvedId = dealershipId || user?.dealership_id || null
    const [dealershipTimezone, setDealershipTimezone] = React.useState<string>(DEFAULT_TIMEZONE)
    const [isLoading, setIsLoading] = React.useState(true)

    React.useEffect(() => {
        let cancelled = false

        async function load() {
            if (!resolvedId) {
                // No dealership context (e.g. super admin on a global page without an entity)
                setDealershipTimezone(DEFAULT_TIMEZONE)
                setIsLoading(false)
                return
            }

            const cached = timezoneCache.get(resolvedId)
            if (cached) {
                setDealershipTimezone(cached)
                setIsLoading(false)
                return
            }

            setIsLoading(true)
            try {
                const tz = await fetchDealershipTimezone(resolvedId)
                if (!cancelled) setDealershipTimezone(tz)
            } catch (error) {
                console.warn("[useDealershipTimezone] Failed to fetch dealership timezone:", error)
                if (!cancelled) setDealershipTimezone(DEFAULT_TIMEZONE)
            } finally {
                if (!cancelled) setIsLoading(false)
            }
        }

        void load()
        return () => {
            cancelled = true
        }
    }, [resolvedId])

    return { dealershipTimezone, isLoading, dealershipId: resolvedId }
}

/**
 * Load timezones for many dealerships (super admin appointment lists, etc.).
 */
export function useDealershipTimezoneMap(dealershipIds: Array<string | null | undefined>) {
    const key = React.useMemo(() => {
        const unique = [...new Set(dealershipIds.filter((id): id is string => Boolean(id)))]
        unique.sort()
        return unique.join(",")
    }, [dealershipIds])

    const [tzMap, setTzMap] = React.useState<Record<string, string>>({})

    React.useEffect(() => {
        const ids = key ? key.split(",") : []
        if (!ids.length) {
            setTzMap({})
            return
        }

        let cancelled = false
        void (async () => {
            const entries = await Promise.all(
                ids.map(async (id) => {
                    try {
                        return [id, await fetchDealershipTimezone(id)] as const
                    } catch {
                        return [id, DEFAULT_TIMEZONE] as const
                    }
                })
            )
            if (!cancelled) {
                setTzMap(Object.fromEntries(entries))
            }
        })()

        return () => {
            cancelled = true
        }
    }, [key])

    const getTimezone = React.useCallback(
        (dealershipId?: string | null) => {
            if (dealershipId && tzMap[dealershipId]) return tzMap[dealershipId]
            return DEFAULT_TIMEZONE
        },
        [tzMap]
    )

    return { tzMap, getTimezone }
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
