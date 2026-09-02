"use client"

import * as React from "react"

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

const noopValue: BdcDealershipContextValue = {
    dealerships: [],
    selectedDealershipId: null,
    setSelectedDealershipId: () => {},
    selectedDealershipName: "All",
    isLoading: false,
}

const BdcDealershipContext = React.createContext<BdcDealershipContextValue | null>(null)

export function BdcDealershipProvider({ children }: { children: React.ReactNode }) {
    return (
        <BdcDealershipContext.Provider value={noopValue}>
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
