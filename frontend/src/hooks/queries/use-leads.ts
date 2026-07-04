"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { LeadService, type LeadListParams } from "@/services/lead-service"

export const leadKeys = {
    all: ["leads"] as const,
    lists: () => [...leadKeys.all, "list"] as const,
    list: (params: LeadListParams) => [...leadKeys.lists(), params] as const,
    details: () => [...leadKeys.all, "detail"] as const,
    detail: (id: string) => [...leadKeys.details(), id] as const,
}

export function useLeadsList(params: LeadListParams = {}, enabled = true) {
    return useQuery({
        queryKey: leadKeys.list(params),
        queryFn: () => LeadService.listLeads(params),
        enabled,
        placeholderData: (prev) => prev,
    })
}

export function useLead(id: string | undefined) {
    return useQuery({
        queryKey: leadKeys.detail(id ?? ""),
        queryFn: () => LeadService.getLead(id!),
        enabled: Boolean(id),
    })
}

/** Invalidate all lead queries — call after mutations or WebSocket lead events */
export function useInvalidateLeads() {
    const queryClient = useQueryClient()
    return (id?: string) => {
        if (id) {
            queryClient.invalidateQueries({ queryKey: leadKeys.detail(id) })
        }
        queryClient.invalidateQueries({ queryKey: leadKeys.lists() })
    }
}
