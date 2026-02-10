"use client"

import * as React from "react"

const SIDEBAR_COLLAPSED_KEY = "tikuncrm-sidebar-collapsed"

interface SidebarContextValue {
    collapsed: boolean
    setCollapsed: (value: boolean) => void
    toggle: () => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
    const [collapsed, setCollapsedState] = React.useState(() => {
        if (typeof window === "undefined") return false
        try {
            return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true"
        } catch {
            return false
        }
    })

    const setCollapsed = React.useCallback((value: boolean) => {
        setCollapsedState(value)
        try {
            localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? "true" : "false")
        } catch {}
    }, [])

    const toggle = React.useCallback(() => {
        setCollapsedState((prev) => {
            const next = !prev
            try {
                localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "true" : "false")
            } catch {}
            return next
        })
    }, [])

    const value = React.useMemo(
        () => ({ collapsed, setCollapsed, toggle }),
        [collapsed, setCollapsed, toggle]
    )

    return (
        <SidebarContext.Provider value={value}>
            {children}
        </SidebarContext.Provider>
    )
}

export function useSidebar() {
    const ctx = React.useContext(SidebarContext)
    if (!ctx) throw new Error("useSidebar must be used within SidebarProvider")
    return ctx
}

export function useSidebarOptional() {
    return React.useContext(SidebarContext)
}
