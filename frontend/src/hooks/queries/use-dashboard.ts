"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
    DashboardService,
    type SuperAdminStats,
    type DealershipAdminStats,
    type SalespersonStats,
    type BdcStats,
    type DealershipPerformance,
    type LeadsBySource,
} from "@/services/dashboard-service"

export const dashboardKeys = {
    all: ["dashboard"] as const,
    superAdmin: () => [...dashboardKeys.all, "super-admin"] as const,
    dealershipAdmin: () => [...dashboardKeys.all, "dealership-admin"] as const,
    salesperson: () => [...dashboardKeys.all, "salesperson"] as const,
    bdc: () => [...dashboardKeys.all, "bdc"] as const,
    performance: (limit: number) => [...dashboardKeys.all, "performance", limit] as const,
    leadsBySource: () => [...dashboardKeys.all, "leads-by-source"] as const,
}

export function useSuperAdminStats(enabled = true) {
    return useQuery<SuperAdminStats>({
        queryKey: dashboardKeys.superAdmin(),
        queryFn: () => DashboardService.getSuperAdminStats(),
        enabled,
    })
}

export function useDealershipAdminStats(enabled = true) {
    return useQuery<DealershipAdminStats>({
        queryKey: dashboardKeys.dealershipAdmin(),
        queryFn: () => DashboardService.getDealershipAdminStats(),
        enabled,
    })
}

export function useSalespersonStats(enabled = true) {
    return useQuery<SalespersonStats>({
        queryKey: dashboardKeys.salesperson(),
        queryFn: () => DashboardService.getSalespersonStats(),
        enabled,
    })
}

export function useBdcStats(enabled = true) {
    return useQuery<BdcStats>({
        queryKey: dashboardKeys.bdc(),
        queryFn: () => DashboardService.getBdcStats(),
        enabled,
    })
}

export function useDealershipPerformance(limit = 10, enabled = true) {
    return useQuery<DealershipPerformance[]>({
        queryKey: dashboardKeys.performance(limit),
        queryFn: () => DashboardService.getDealershipPerformance(limit),
        enabled,
    })
}

export function useLeadsBySource(enabled = true) {
    return useQuery<LeadsBySource[]>({
        queryKey: dashboardKeys.leadsBySource(),
        queryFn: () => DashboardService.getLeadsBySource(),
        enabled,
    })
}

/** Invalidate all dashboard stats — call on WebSocket stats:refresh */
export function useInvalidateDashboard() {
    const queryClient = useQueryClient()
    return () => queryClient.invalidateQueries({ queryKey: dashboardKeys.all })
}
