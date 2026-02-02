"use client"

import * as React from "react"
import { Command } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { NotificationBell } from "@/components/layout/notification-bell"

export function Header() {
    return (
        <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b bg-background/95 px-6 backdrop-blur">
            <div className="flex items-center gap-4 text-sm font-medium text-muted-foreground">
                <span>Dashboard</span>
                <span className="text-muted-foreground/40">/</span>
                <span className="text-foreground">Overview</span>
            </div>

            <div className="flex items-center gap-4">
                {/* Shortcut hint */}
                <div className="hidden items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium opacity-100 sm:flex">
                    <Command className="h-3 w-3" />
                    <span>K</span>
                </div>

                <NotificationBell />

                <div className="h-6 w-px bg-border mx-2" />

                <ThemeToggle />
            </div>
        </header>
    )
}
