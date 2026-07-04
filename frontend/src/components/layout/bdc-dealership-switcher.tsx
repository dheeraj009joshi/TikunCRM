"use client"

import * as React from "react"
import { Building2, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useBdcDealershipOptional } from "@/contexts/bdc-dealership-context"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type BdcDealershipSwitcherProps = {
    collapsed?: boolean
    className?: string
}

export function BdcDealershipSwitcher({ collapsed = false, className }: BdcDealershipSwitcherProps) {
    const ctx = useBdcDealershipOptional()

    if (!ctx || ctx.isLoading || ctx.dealerships.length <= 1) {
        return null
    }

    const { dealerships, selectedDealershipId, setSelectedDealershipId, selectedDealershipName } = ctx

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        "flex w-full items-center rounded-md border border-input bg-background text-left text-sm shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                        collapsed ? "justify-center p-2" : "gap-2 px-3 py-2",
                        className
                    )}
                    title="Switch dealership"
                >
                    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {!collapsed && (
                        <span className="min-w-0 flex-1 truncate font-medium">
                            {selectedDealershipName}
                        </span>
                    )}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Switch dealership</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={() => setSelectedDealershipId(null)}
                    className="flex items-center gap-2"
                >
                    <span className="flex-1 truncate">All dealerships</span>
                    {selectedDealershipId === null && (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                    )}
                </DropdownMenuItem>
                {dealerships.map((d) => {
                    const isCurrent = selectedDealershipId === d.id
                    return (
                        <DropdownMenuItem
                            key={d.id}
                            onClick={() => setSelectedDealershipId(d.id)}
                            className="flex items-center gap-2"
                        >
                            <span className="flex-1 truncate">{d.name}</span>
                            {isCurrent && <Check className="h-4 w-4 shrink-0 text-primary" />}
                        </DropdownMenuItem>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
