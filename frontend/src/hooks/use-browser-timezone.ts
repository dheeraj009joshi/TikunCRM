"use client"

import * as React from "react"

/** Default timezone when detection fails or during SSR */
const DEFAULT_TIMEZONE = "America/New_York"

/**
 * Hook to get the user's browser timezone.
 * Detects timezone only on the client after mount — during SSR we use default
 * so we don't get "UTC" from the server, then update to real browser TZ so
 * activity/note times render in local time, not UTC.
 */
export function useBrowserTimezone() {
    const [timezone, setTimezone] = React.useState<string>(DEFAULT_TIMEZONE)
    const [isLoading, setIsLoading] = React.useState(true)

    React.useEffect(() => {
        try {
            const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
            if (detected && typeof detected === "string" && detected.length > 0) {
                setTimezone(detected)
            }
        } catch (error) {
            console.warn("[Timezone] Failed to detect browser timezone:", error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    return { timezone, isLoading }
}
