"use client"

import { useAuthStore } from "@/stores/auth-store"

/**
 * Effective Carvaminos org dealership id for settings, team filters, and lead actions.
 * Falls back from org_dealership_id (from /me) to user.dealership_id.
 */
export function useOrgDealershipId(): string | null {
    const user = useAuthStore((s) => s.user)
    if (!user) return null
    return user.org_dealership_id ?? user.dealership_id ?? null
}
