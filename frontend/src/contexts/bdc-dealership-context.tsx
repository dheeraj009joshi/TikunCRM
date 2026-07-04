"use client"

import * as React from "react"
import { useAuthStore } from "@/stores/auth-store"
import { TeamService } from "@/services/team-service"

const STORAGE_KEY = "bdc_selected_dealership_id"

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
    const [dealerships, setDealerships] = React.useState<BdcDealershipOption[]>([])
    const [selectedDealershipId, setSelectedDealershipIdState] = React.useState<string | null>(null)
    const [isLoading, setIsLoading] = React.useState(true)

    React.useEffect(() => {
        if (user?.role !== "bdc" || !user.id) {
            setDealerships([])
            setIsLoading(false)
            return
        }

        let cancelled = false
        TeamService.getUserDealershipAccess(user.id)
            .then((access) => {
                if (cancelled) return
                const list = (access.dealerships || []).map((d) => ({
                    id: d.id,
                    name: d.name,
                }))
                setDealerships(list)

                const stored = localStorage.getItem(STORAGE_KEY)
                if (stored && list.some((d) => d.id === stored)) {
                    setSelectedDealershipIdState(stored)
                } else if (list.length === 1) {
                    setSelectedDealershipIdState(list[0].id)
                    localStorage.setItem(STORAGE_KEY, list[0].id)
                } else {
                    setSelectedDealershipIdState(null)
                    localStorage.removeItem(STORAGE_KEY)
                }
            })
            .catch(() => {
                if (!cancelled) setDealerships([])
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [user?.id, user?.role])

    const setSelectedDealershipId = React.useCallback((id: string | null) => {
        setSelectedDealershipIdState(id)
        if (id) {
            localStorage.setItem(STORAGE_KEY, id)
        } else {
            localStorage.removeItem(STORAGE_KEY)
        }
    }, [])

    const selectedDealershipName =
        selectedDealershipId != null
            ? dealerships.find((d) => d.id === selectedDealershipId)?.name ?? "Dealership"
            : "All dealerships"

    const value = React.useMemo(
        () => ({
            dealerships,
            selectedDealershipId,
            setSelectedDealershipId,
            selectedDealershipName,
            isLoading,
        }),
        [dealerships, selectedDealershipId, setSelectedDealershipId, selectedDealershipName, isLoading]
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
