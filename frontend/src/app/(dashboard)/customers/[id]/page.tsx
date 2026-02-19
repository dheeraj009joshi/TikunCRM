"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
    Phone,
    Mail,
    MapPin,
    Briefcase,
    Calendar,
    ChevronLeft,
    DollarSign,
    Loader2,
    ArrowUpRight,
    User,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/ui/avatar"
import { CustomerService, Customer360, getCustomerFullName } from "@/services/customer-service"
import { Lead, getLeadFullName } from "@/services/lead-service"
import { getStageLabel, getStageColor } from "@/services/lead-stage-service"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone } from "@/utils/timezone"

export default function Customer360Page() {
    const params = useParams()
    const customerId = params.id as string
    const [customer, setCustomer] = React.useState<Customer360 | null>(null)
    const [isLoading, setIsLoading] = React.useState(true)
    const { timezone } = useBrowserTimezone()

    React.useEffect(() => {
        const fetchCustomer = async () => {
            try {
                const data = await CustomerService.get(customerId)
                setCustomer(data)
            } catch (error) {
                console.error("Failed to fetch customer:", error)
            } finally {
                setIsLoading(false)
            }
        }
        fetchCustomer()
    }, [customerId])

    if (isLoading) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!customer) {
        return (
            <div className="flex h-[60vh] flex-col items-center justify-center text-center">
                <User className="h-12 w-12 text-muted-foreground/20 mb-4" />
                <h2 className="text-lg font-semibold">Customer not found</h2>
            </div>
        )
    }

    const leads = (customer.leads || []) as Lead[]

    return (
        <div className="space-y-6">
            {/* Back */}
            <Link href="/customers">
                <Button variant="ghost" size="sm" className="gap-1">
                    <ChevronLeft className="h-4 w-4" />
                    Back to Customers
                </Button>
            </Link>

            {/* Customer Profile Card */}
            <Card>
                <CardContent className="p-6">
                    <div className="flex items-start gap-6">
                        <UserAvatar
                            firstName={customer.first_name}
                            lastName={customer.last_name ?? undefined}
                            size="lg"
                        />
                        <div className="flex-1 min-w-0">
                            <h1 className="text-2xl font-bold">{getCustomerFullName(customer)}</h1>
                            <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
                                {customer.phone && (
                                    <span className="flex items-center gap-1">
                                        <Phone className="h-4 w-4" />
                                        {customer.phone}
                                    </span>
                                )}
                                {customer.email && (
                                    <span className="flex items-center gap-1">
                                        <Mail className="h-4 w-4" />
                                        {customer.email}
                                    </span>
                                )}
                                {customer.city && (
                                    <span className="flex items-center gap-1">
                                        <MapPin className="h-4 w-4" />
                                        {[customer.city, customer.state].filter(Boolean).join(", ")}
                                    </span>
                                )}
                                {customer.company && (
                                    <span className="flex items-center gap-1">
                                        <Briefcase className="h-4 w-4" />
                                        {customer.company}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="text-right shrink-0">
                            <p className="text-sm text-muted-foreground">Lifetime Value</p>
                            <p className="text-2xl font-bold text-emerald-600 flex items-center gap-1">
                                <DollarSign className="h-5 w-5" />
                                {Number(customer.lifetime_value || 0).toLocaleString()}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                Customer since {formatDateInTimezone(customer.created_at, timezone, { dateStyle: "medium" })}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="p-4 text-center">
                        <p className="text-3xl font-bold">{customer.total_leads}</p>
                        <p className="text-sm text-muted-foreground">Total Leads</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 text-center">
                        <p className="text-3xl font-bold text-blue-600">{customer.active_leads}</p>
                        <p className="text-sm text-muted-foreground">Active Leads</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 text-center">
                        <p className="text-3xl font-bold text-emerald-600">
                            {leads.filter((l) => l.outcome === "converted").length}
                        </p>
                        <p className="text-sm text-muted-foreground">Converted</p>
                    </CardContent>
                </Card>
            </div>

            {/* Leads History */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Lead History</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {leads.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            No leads for this customer yet
                        </div>
                    ) : (
                        <div className="divide-y">
                            {leads.map((lead) => {
                                const stage = lead.stage
                                return (
                                    <div
                                        key={lead.id}
                                        className="flex items-center justify-between p-4 hover:bg-muted/30 cursor-pointer"
                                        onClick={() => (window.location.href = `/leads/${lead.id}`)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="h-3 w-3 rounded-full shrink-0"
                                                style={{ backgroundColor: getStageColor(stage) }}
                                            />
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className="font-medium text-sm">
                                                        {lead.interested_in || "Lead"}
                                                    </p>
                                                    <Badge
                                                        variant={lead.is_active ? "default" : "secondary"}
                                                        className="text-[10px]"
                                                    >
                                                        {lead.is_active ? getStageLabel(stage) : (lead.outcome || "Closed")}
                                                    </Badge>
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    Source: {(lead.source_display ?? lead.source)?.replace(/_/g, ' ')} | Created{" "}
                                                    {formatDateInTimezone(lead.created_at, timezone, {
                                                        dateStyle: "medium",
                                                    })}
                                                    {lead.assigned_to_user && (
                                                        <>
                                                            {" "}| Assigned to {lead.assigned_to_user.first_name}{" "}
                                                            {lead.assigned_to_user.last_name}
                                                        </>
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                        <Button variant="ghost" size="sm">
                                            <ArrowUpRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
