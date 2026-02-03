"use client"

import * as React from "react"
import { useRole } from "@/hooks/use-role"
import { SuperAdminDashboard } from "./super-admin-dashboard"
import { DealershipAdminDashboard } from "./dealership-admin-dashboard"
import { SalespersonDashboard } from "./salesperson-dashboard"
import { Loader2 } from "lucide-react"

export default function DashboardPage() {
    const { role, isAuthenticated } = useRole()
    const [mounted, setMounted] = React.useState(false)

    React.useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    // Render role-specific dashboard
    switch (role) {
        case "super_admin":
            return <SuperAdminDashboard />
        case "dealership_admin":
        case "dealership_owner":
            return <DealershipAdminDashboard />
        case "salesperson":
            return <SalespersonDashboard />
        default:
            return (
                <div className="flex h-[50vh] items-center justify-center">
                    <div className="text-center">
                        <h2 className="text-lg font-semibold">Welcome to LeadsCRM</h2>
                        <p className="text-muted-foreground">Loading your dashboard...</p>
                    </div>
                </div>
            )
    }
}
