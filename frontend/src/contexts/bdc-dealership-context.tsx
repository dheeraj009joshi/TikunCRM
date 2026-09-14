"use client"

import * as React from "react"
import { useAuthStore } from "@/stores/auth-store"
import { useRole } from "@/hooks/use-role"
import { useOrgDealershipId } from "@/hooks/use-org-dealership"
import { TeamService } from "@/services/team-service"

export type BdcDealershipOption = {
    id: string
    name: string
}

type BdcDealershipContextValue = {
    dealerships: BdcDealershipOption[]
    selectedDealershipId: string | null
    setSelectedDealershipId: (id: string | null) => void
    selectedDealershipName: string
    isLoading: boolean
}

const BdcDealershipContext = React.createContext<BdcDealershipContextValue | null>(null)

export function BdcDealershipProvider({ children }: { children: React.ReactNode }) {
    const user = useAuthStore((s) => s.user)
    const { isBdc } = useRole()
    const orgDealershipId = useOrgDealershipId()
    const [dealerships, setDealerships] = React.useState<BdcDealershipOption[]>([])
    const [selectedDealershipId, setSelectedDealershipId] = React.useState<string | null>(null)
    const [isLoading, setIsLoading] = React.useState(false)

    React.useEffect(() => {
        if (!isBdc || !user?.id) {
            setDealerships([])
            setSelectedDealershipId(null)
            setIsLoading(false)
            return
        }

        let cancelled = false
        setIsLoading(true)
        TeamService.getUserDealershipAccess(user.id)
            .then((res) => {
                if (cancelled) return
                const list = res.dealerships ?? []
                if (list.length > 0) {
                    setDealerships(list)
                    setSelectedDealershipId((prev) => prev ?? list[0].id)
                    return
                }
                if (orgDealershipId) {
                    setDealerships([{ id: orgDealershipId, name: "Organization" }])
                    setSelectedDealershipId((prev) => prev ?? orgDealershipId)
                }
            })
            .catch(() => {
                if (cancelled) return
                if (orgDealershipId) {
                    setDealerships([{ id: orgDealershipId, name: "Organization" }])
                    setSelectedDealershipId((prev) => prev ?? orgDealershipId)
                }
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [isBdc, user?.id, orgDealershipId])

    const selectedDealershipName = React.useMemo(() => {
        if (!selectedDealershipId) return "All dealerships"
        return dealerships.find((d) => d.id === selectedDealershipId)?.name ?? "Dealership"
    }, [dealerships, selectedDealershipId])

    const value = React.useMemo<BdcDealershipContextValue>(
        () => ({
            dealerships,
            selectedDealershipId,
            setSelectedDealershipId,
            selectedDealershipName,
            isLoading,
        }),
        [dealerships, selectedDealershipId, selectedDealershipName, isLoading]
    )

    return (
        <BdcDealershipContext.Provider value={value}>
            {children}
        </BdcDealershipContext.Provider>
    )
}

export function useBdcDealership(): BdcDealershipContextValue {
    const ctx = React.useContext(BdcDealershipContext)
    if (!ctx) {
        return {
            dealerships: [],
            selectedDealershipId: null,
            setSelectedDealershipId: () => {},
            selectedDealershipName: "All dealerships",
            isLoading: false,
        }
    }
    return ctx
}

export function useBdcDealershipOptional() {
    return React.useContext(BdcDealershipContext)
}
