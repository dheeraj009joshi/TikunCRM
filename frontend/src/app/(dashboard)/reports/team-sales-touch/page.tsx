"use client"

import * as React from "react"
import Link from "next/link"
import {
    format,
    subDays,
    startOfWeek,
    endOfWeek,
    startOfDay,
    endOfDay,
    startOfMonth,
    endOfMonth,
} from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
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
import {
    CalendarDays,
    Download,
    Loader2,
    Percent,
    RefreshCw,
    Target,
    Trophy,
    Users,
} from "lucide-react"
import { useRole } from "@/hooks/use-role"
import { useAuthStore } from "@/stores/auth-store"
import {
    ReportsService,
    type TeamTouchSalesMetricsResponse,
    type TeamTouchSalesMetricsFilters,
} from "@/services/reports-service"
import { DealershipService, type Dealership } from "@/services/dealership-service"
import { cn } from "@/lib/utils"

type DatePreset =
    | "today"
    | "yesterday"
    | "this_week"
    | "this_month"
    | "last_7_days"
    | "last_30_days"
    | "all_time"
    | "custom"

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "this_week", label: "This Week" },
    { value: "this_month", label: "This Month" },
    { value: "last_7_days", label: "Last 7 Days" },
    { value: "last_30_days", label: "Last 30 Days" },
    { value: "all_time", label: "All Time" },
    { value: "custom", label: "Custom Range" },
]

function SummaryCard({
    title,
    value,
    icon: Icon,
    description,
}: {
    title: string
    value: number | string
    icon: React.ComponentType<{ className?: string }>
    description?: string
}) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">
                    {typeof value === "number" ? value.toLocaleString() : value}
                </div>
                {description && <p className="text-xs text-muted-foreground">{description}</p>}
            </CardContent>
        </Card>
    )
}

function csvEscape(cell: string): string {
    return `"${String(cell).replace(/"/g, '""')}"`
}

export default function TeamSalesTouchReportPage() {
    const { isSuperAdmin, isDealershipAdmin, isDealershipOwner } = useRole()
    const canView = isDealershipAdmin || isDealershipOwner || isSuperAdmin
    const user = useAuthStore((state) => state.user)

    const [isLoading, setIsLoading] = React.useState(true)
    const [data, setData] = React.useState<TeamTouchSalesMetricsResponse | null>(null)
    const [error, setError] = React.useState<string | null>(null)

    const [datePreset, setDatePreset] = React.useState<DatePreset>("this_month")
    const [customDateFrom, setCustomDateFrom] = React.useState<Date | undefined>(undefined)
    const [customDateTo, setCustomDateTo] = React.useState<Date | undefined>(undefined)
    const [selectedDealershipId, setSelectedDealershipId] = React.useState<string>("")

    const [dealerships, setDealerships] = React.useState<Dealership[]>([])
    const [loadingDropdowns, setLoadingDropdowns] = React.useState(true)

    const getDateRange = React.useCallback((): { from: Date | null; to: Date | null } => {
        if (datePreset === "all_time") {
            return { from: null, to: null }
        }

        const today = new Date()
        let from: Date
        let to: Date

        switch (datePreset) {
            case "today":
                from = today
                to = today
                break
            case "yesterday":
                from = subDays(today, 1)
                to = subDays(today, 1)
                break
            case "this_week":
                from = startOfWeek(today, { weekStartsOn: 1 })
                to = endOfWeek(today, { weekStartsOn: 1 })
                break
            case "this_month":
                from = startOfMonth(today)
                to = endOfMonth(today)
                break
            case "last_7_days":
                from = subDays(today, 6)
                to = today
                break
            case "last_30_days":
                from = subDays(today, 29)
                to = today
                break
            case "custom":
                from = customDateFrom || today
                to = customDateTo || today
                break
            default:
                from = today
                to = today
        }

        return { from, to }
    }, [datePreset, customDateFrom, customDateTo])

    React.useEffect(() => {
        async function loadDealerships() {
            setLoadingDropdowns(true)
            try {
                if (isSuperAdmin) {
                    const ds = await DealershipService.listDealerships({ is_active: true })
                    setDealerships(ds)
                    setSelectedDealershipId((prev) => (prev || (ds[0]?.id ?? "")))
                }
            } catch (err) {
                console.error("Failed to load dealerships:", err)
            } finally {
                setLoadingDropdowns(false)
            }
        }
        if (canView) loadDealerships()
    }, [isSuperAdmin, canView])

    const fetchData = React.useCallback(async () => {
        const dealershipId = isSuperAdmin ? selectedDealershipId : user?.dealership_id
        if (isSuperAdmin && !dealershipId) return

        setIsLoading(true)
        setError(null)

        try {
            const { from, to } = getDateRange()
            const filters: TeamTouchSalesMetricsFilters = {}
            if (isSuperAdmin && dealershipId) {
                filters.dealership_id = dealershipId
            }
            if (from && to) {
                filters.date_from = startOfDay(from).toISOString()
                filters.date_to = endOfDay(to).toISOString()
            }

            const response = await ReportsService.getTeamTouchSalesMetrics(filters)
            setData(response)
        } catch (err: unknown) {
            console.error("Failed to fetch team touch metrics:", err)
            const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            setError(typeof detail === "string" ? detail : "Failed to load report")
        } finally {
            setIsLoading(false)
        }
    }, [isSuperAdmin, selectedDealershipId, user?.dealership_id, getDateRange])

    React.useEffect(() => {
        if (canView) {
            fetchData()
        }
    }, [fetchData, canView])

    const downloadCsv = () => {
        if (!data) return

        const { from, to } = getDateRange()
        const periodLabel =
            datePreset === "all_time"
                ? "all_time"
                : from && to
                  ? `${format(from, "yyyy-MM-dd")}_to_${format(to, "yyyy-MM-dd")}`
                  : "period"

        const rows: string[][] = [
            ["Team touch & close report"],
            ["Period", periodLabel],
            [
                "Salespeople (excl. yourself)",
                String(data.salespeople_count),
            ],
            [
                "Unique leads touched (team)",
                String(data.unique_leads_touched),
            ],
            [
                "Avg leads touched per salesperson",
                String(data.avg_leads_touched_per_salesperson),
            ],
            ["Sold (among touched)", String(data.sold_among_touched)],
            ["Closing % (team)", `${data.closing_percentage}%`],
            [],
            ["Salesperson", "Leads touched", "Sold", "Closing %"],
            ...data.salespeople.map((sp) => [
                sp.user_name,
                String(sp.leads_touched),
                String(sp.sold_count),
                `${sp.closing_percentage}%`,
            ]),
        ]

        const csv = rows.map((row) => row.map((c) => csvEscape(c)).join(",")).join("\n")
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `team-touch-close-${periodLabel}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    const dateRangeLabel = React.useMemo(() => {
        const { from, to } = getDateRange()
        if (datePreset === "all_time") return "All time"
        if (!from || !to) return ""
        const fromStr = format(from, "yyyy-MM-dd")
        const toStr = format(to, "yyyy-MM-dd")
        if (fromStr === toStr) return format(from, "EEEE, MMMM d, yyyy")
        return `${format(from, "MMM d, yyyy")} — ${format(to, "MMM d, yyyy")}`
    }, [getDateRange, datePreset])

    if (!canView) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Card className="max-w-md">
                    <CardContent className="p-6 text-center">
                        <p className="text-muted-foreground">You do not have access to this report.</p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Team touch & close</h1>
                    <p className="text-muted-foreground">
                        Leads your sales team worked (activity on the lead), sales closed in the same
                        period, and closing rate. Counts use{" "}
                        <strong className="font-medium text-foreground">salespeople only</strong> and
                        exclude <strong className="font-medium text-foreground">your own</strong>{" "}
                        activity.
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Sold dates match the{" "}
                        <Link href="/sold-cars" className="underline underline-offset-2 hover:text-foreground">
                            Sold Cars
                        </Link>{" "}
                        report.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => fetchData()} disabled={isLoading}>
                        <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
                        Refresh
                    </Button>
                    <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!data || isLoading}>
                        <Download className="mr-2 h-4 w-4" />
                        Export CSV
                    </Button>
                </div>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Filters</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-end gap-3">
                    {isSuperAdmin && (
                        <div className="min-w-[200px] flex-1">
                            <label className="mb-1.5 block text-sm font-medium">Dealership</label>
                            <Select
                                value={selectedDealershipId}
                                onValueChange={setSelectedDealershipId}
                                disabled={loadingDropdowns}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select dealership" />
                                </SelectTrigger>
                                <SelectContent>
                                    {dealerships.map((d) => (
                                        <SelectItem key={d.id} value={d.id}>
                                            {d.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <div className="min-w-[160px]">
                        <label className="mb-1.5 block text-sm font-medium">Date range</label>
                        <Select
                            value={datePreset}
                            onValueChange={(v) => setDatePreset(v as DatePreset)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {DATE_PRESETS.map((p) => (
                                    <SelectItem key={p.value} value={p.value}>
                                        {p.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {datePreset === "custom" && (
                        <>
                            <div>
                                <label className="mb-1.5 block text-sm font-medium">From</label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className="w-[160px] justify-start">
                                            <CalendarDays className="mr-2 h-4 w-4" />
                                            {customDateFrom
                                                ? format(customDateFrom, "MMM d, yyyy")
                                                : "Pick date"}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                        <Calendar
                                            mode="single"
                                            selected={customDateFrom}
                                            onSelect={setCustomDateFrom}
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <div>
                                <label className="mb-1.5 block text-sm font-medium">To</label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className="w-[160px] justify-start">
                                            <CalendarDays className="mr-2 h-4 w-4" />
                                            {customDateTo
                                                ? format(customDateTo, "MMM d, yyyy")
                                                : "Pick date"}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                        <Calendar
                                            mode="single"
                                            selected={customDateTo}
                                            onSelect={setCustomDateTo}
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {error && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                </div>
            )}

            {isLoading && !data && (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                </div>
            )}

            {data && (
                <>
                    <p className="text-sm text-muted-foreground">{dateRangeLabel}</p>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <SummaryCard
                            title="Leads touched (unique)"
                            value={data.unique_leads_touched}
                            icon={Target}
                            description="Distinct leads with CRM activity by your salespeople"
                        />
                        <SummaryCard
                            title="Avg touched per rep"
                            value={data.avg_leads_touched_per_salesperson}
                            icon={Users}
                            description={`Across ${data.salespeople_count} salesperson${data.salespeople_count === 1 ? "" : "s"}`}
                        />
                        <SummaryCard
                            title="Sold (among touched)"
                            value={data.sold_among_touched}
                            icon={Trophy}
                            description="Converted in this period, within the touched set"
                        />
                        <SummaryCard
                            title="Closing rate"
                            value={`${data.closing_percentage}%`}
                            icon={Percent}
                            description="Sold ÷ unique leads touched"
                        />
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">By salesperson</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead>Salesperson</TableHead>
                                        <TableHead className="text-right">Leads touched</TableHead>
                                        <TableHead className="text-right">Sold</TableHead>
                                        <TableHead className="text-right">Closing %</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        <TableLoading columns={4} rows={4} />
                                    ) : data.salespeople.length === 0 ? (
                                        <TableEmpty
                                            icon={<Users className="h-10 w-10" />}
                                            title="No salespeople in scope"
                                            description="Add active salesperson accounts or pick another dealership."
                                        />
                                    ) : (
                                        data.salespeople.map((sp) => (
                                            <TableRow key={sp.user_id}>
                                                <TableCell className="font-medium">{sp.user_name}</TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {sp.leads_touched}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums text-emerald-600">
                                                    {sp.sold_count}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {sp.closing_percentage}%
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    )
}
