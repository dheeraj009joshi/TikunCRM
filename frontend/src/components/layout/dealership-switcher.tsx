"use client"

import * as React from "react"
import { Building2, Check, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import { AuthService, DealershipOption } from "@/services/auth-service"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type DealershipSwitcherProps = {
    collapsed?: boolean
}

export function DealershipSwitcher({ collapsed = false }: DealershipSwitcherProps) {
    const { user } = useAuthStore()
    const [options, setOptions] = React.useState<DealershipOption[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [isSwitching, setIsSwitching] = React.useState(false)

    React.useEffect(() => {
        let cancelled = false
        AuthService.getMyDealerships()
            .then((dealerships) => {
                if (!cancelled) setOptions(dealerships)
            })
            .catch(() => {
                if (!cancelled) setOptions([])
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [user?.id])

    if (isLoading || options.length <= 1) {
        return null
    }

    const currentOption =
        options.find((o) =>
            o.is_super_admin
                ? user?.dealership_id == null
                : o.id === user?.dealership_id
        ) ?? options[0]

    const handleSwitch = async (option: DealershipOption) => {
        const isCurrent =
            option.is_super_admin
                ? user?.dealership_id == null
                : option.id === user?.dealership_id
        if (isCurrent || isSwitching) return

        setIsSwitching(true)
        try {
            await AuthService.switchDealership(option.is_super_admin ? null : option.id)
            window.location.href = "/dashboard"
        } catch (error) {
            console.error("Failed to switch dealership:", error)
            setIsSwitching(false)
        }
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    disabled={isSwitching}
                    className={cn(
                        "flex w-full items-center rounded-md border border-input bg-muted/40 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                        collapsed ? "justify-center p-2" : "gap-2 px-3 py-2",
                        isSwitching && "opacity-70"
                    )}
                    title="Switch dealership"
                >
                    {isSwitching ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    ) : (
                        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    {!collapsed && (
                        <span className="min-w-0 flex-1 truncate font-medium">
                            {currentOption.name}
                        </span>
                    )}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Switch dealership</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {options.map((option) => {
                    const isCurrent =
                        option.is_super_admin
                            ? user?.dealership_id == null
                            : option.id === user?.dealership_id
                    return (
                        <DropdownMenuItem
                            key={option.is_super_admin ? "super_admin" : option.id!}
                            onClick={() => handleSwitch(option)}
                            className="flex items-center gap-2"
                        >
                            <span className="flex-1 truncate">{option.name}</span>
                            {isCurrent && <Check className="h-4 w-4 shrink-0 text-primary" />}
                        </DropdownMenuItem>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
