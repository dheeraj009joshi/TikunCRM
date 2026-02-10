"use client"

import * as React from "react"
import Link from "next/link"
import {
    Search,
    Users,
    Phone,
    Mail,
    Loader2,
    DollarSign,
    ArrowUpRight,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableEmpty,
    TableLoading,
} from "@/components/ui/table"
import { UserAvatar } from "@/components/ui/avatar"
import { CustomerService, Customer, getCustomerFullName } from "@/services/customer-service"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone } from "@/utils/timezone"

export default function CustomersPage() {
    const [customers, setCustomers] = React.useState<Customer[]>([])
    const [total, setTotal] = React.useState(0)
    const [page, setPage] = React.useState(1)
    const [pageSize] = React.useState(20)
    const [search, setSearch] = React.useState("")
    const [isLoading, setIsLoading] = React.useState(true)
    const { timezone } = useBrowserTimezone()

    const fetchCustomers = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const data = await CustomerService.list({ page, page_size: pageSize, search: search || undefined })
            setCustomers(data.items)
            setTotal(data.total)
        } catch (error) {
            console.error("Failed to fetch customers:", error)
        } finally {
            setIsLoading(false)
        }
    }, [page, pageSize, search])

    React.useEffect(() => {
        fetchCustomers()
    }, [fetchCustomers])

    const totalPages = Math.ceil(total / pageSize)

    return (
        <div className="space-y-6">
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
                    <p className="text-muted-foreground">Permanent customer directory. One person, many leads.</p>
                </div>
            </div>

            {/* Search */}
            <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name, phone, or email..."
                        className="pl-9"
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value)
                            setPage(1)
                        }}
                    />
                </div>
                <span className="text-sm text-muted-foreground">
                    {total} customer{total !== 1 ? "s" : ""}
                </span>
            </div>

            {/* Table */}
            <Card>
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead>Customer</TableHead>
                            <TableHead>Phone</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Company</TableHead>
                            <TableHead>Lifetime Value</TableHead>
                            <TableHead>Since</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableLoading columns={7} rows={10} />
                        ) : customers.length === 0 ? (
                            <TableEmpty
                                icon={<Users className="h-8 w-8" />}
                                title="No customers found"
                                description={search ? "Try a different search" : "Customers are created when leads are added"}
                            />
                        ) : (
                            customers.map((customer) => (
                                <TableRow
                                    key={customer.id}
                                    className="cursor-pointer hover:bg-muted/30"
                                    onClick={() => (window.location.href = `/customers/${customer.id}`)}
                                >
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <UserAvatar
                                                firstName={customer.first_name}
                                                lastName={customer.last_name ?? undefined}
                                                size="sm"
                                            />
                                            <div>
                                                <p className="font-medium text-sm">{getCustomerFullName(customer)}</p>
                                                {customer.city && (
                                                    <p className="text-xs text-muted-foreground">{customer.city}</p>
                                                )}
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {customer.phone ? (
                                            <span className="flex items-center gap-1 text-sm">
                                                <Phone className="h-3 w-3 text-muted-foreground" />
                                                {customer.phone}
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground">-</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {customer.email ? (
                                            <span className="flex items-center gap-1 text-sm">
                                                <Mail className="h-3 w-3 text-muted-foreground" />
                                                {customer.email}
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground">-</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-sm">{customer.company || "-"}</TableCell>
                                    <TableCell>
                                        <span className="flex items-center gap-1 text-sm font-medium text-emerald-600">
                                            <DollarSign className="h-3 w-3" />
                                            {Number(customer.lifetime_value || 0).toLocaleString()}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {formatDateInTimezone(customer.created_at, timezone, { dateStyle: "medium" })}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Link href={`/customers/${customer.id}`}>
                                            <Button variant="ghost" size="sm">
                                                View <ArrowUpRight className="ml-1 h-3 w-3" />
                                            </Button>
                                        </Link>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </Card>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex justify-center gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                        Previous
                    </Button>
                    <span className="text-sm text-muted-foreground flex items-center px-3">
                        Page {page} of {totalPages}
                    </span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                        Next
                    </Button>
                </div>
            )}
        </div>
    )
}
