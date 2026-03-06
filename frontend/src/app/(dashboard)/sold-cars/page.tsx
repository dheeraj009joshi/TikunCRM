"use client"

import * as React from "react"
import Link from "next/link"
import { format, subDays, startOfWeek, endOfWeek, startOfDay, endOfDay, startOfMonth, endOfMonth } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
    Car,
    Download,
    ExternalLink,
    Loader2,
    Phone,
    RefreshCw,
    Trophy,
    User,
} from "lucide-react"
import { useRole } from "@/hooks/use-role"
import { useAuthStore } from "@/stores/auth-store"
import {
    ReportsService,
    type SoldCarsResponse,
    type SoldCarItem,
    type SoldCarsFilters,
} from "@/services/reports-service"
import { TeamService, type UserBrief } from "@/services/team-service"
import { DealershipService, type Dealership } from "@/services/dealership-service"
import { cn } from "@/lib/utils"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

type DatePreset = "today" | "yesterday" | "this_week" | "this_month" | "last_7_days" | "last_30_days" | "all_time" | "custom"

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
                <div className="text-2xl font-bold">{typeof value === "number" ? value.toLocaleString() : value}</div>
                {description && <p className="text-xs text-muted-foreground">{description}</p>}
            </CardContent>
        </Card>
    )
}

export default function SoldCarsPage() {
    const { isSuperAdmin, isDealershipAdmin, isDealershipOwner } = useRole()
    const canView = isDealershipAdmin || isDealershipOwner || isSuperAdmin
    const user = useAuthStore((state) => state.user)
    
    const [isLoading, setIsLoading] = React.useState(true)
    const [data, setData] = React.useState<SoldCarsResponse | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    
    // Filters
    const [datePreset, setDatePreset] = React.useState<DatePreset>("this_month")
    const [customDateFrom, setCustomDateFrom] = React.useState<Date | undefined>(undefined)
    const [customDateTo, setCustomDateTo] = React.useState<Date | undefined>(undefined)
    const [selectedSalesperson, setSelectedSalesperson] = React.useState<string>("all")
    const [selectedDealershipId, setSelectedDealershipId] = React.useState<string>("")
    
    // Dropdown data
    const [dealerships, setDealerships] = React.useState<Dealership[]>([])
    const [salespersons, setSalespersons] = React.useState<UserBrief[]>([])
    const [loadingDropdowns, setLoadingDropdowns] = React.useState(true)
    
    // Calculate date range from preset
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
    
    // Load dropdowns
    React.useEffect(() => {
        async function loadDropdowns() {
            setLoadingDropdowns(true)
            try {
                if (isSuperAdmin) {
                    const ds = await DealershipService.listDealerships({ is_active: true })
                    setDealerships(ds)
                    if (ds.length > 0 && !selectedDealershipId) {
                        setSelectedDealershipId(ds[0].id)
                    }
                }
                
                const dealershipId = isSuperAdmin ? selectedDealershipId : user?.dealership_id
                if (dealershipId) {
                    const sp = await TeamService.getSalespersons(dealershipId)
                    setSalespersons(sp)
                }
            } catch (err) {
                console.error("Failed to load dropdowns:", err)
            } finally {
                setLoadingDropdowns(false)
            }
        }
        loadDropdowns()
    }, [isSuperAdmin, user?.dealership_id, selectedDealershipId])
    
    // Fetch data
    const fetchData = React.useCallback(async () => {
        const dealershipId = isSuperAdmin ? selectedDealershipId : user?.dealership_id
        if (isSuperAdmin && !dealershipId) return
        
        setIsLoading(true)
        setError(null)
        
        try {
            const { from, to } = getDateRange()
            
            const filters: SoldCarsFilters = {}
            
            if (from && to) {
                filters.date_from = startOfDay(from).toISOString()
                filters.date_to = endOfDay(to).toISOString()
            }
            
            if (isSuperAdmin && selectedDealershipId) {
                filters.dealership_id = selectedDealershipId
            }
            if (selectedSalesperson && selectedSalesperson !== "all") {
                filters.assigned_to = selectedSalesperson
            }
            
            const response = await ReportsService.getSoldCars(filters)
            setData(response)
        } catch (err: any) {
            console.error("Failed to fetch sold cars:", err)
            setError(err.response?.data?.detail || "Failed to load sold cars report")
        } finally {
            setIsLoading(false)
        }
    }, [isSuperAdmin, selectedDealershipId, user?.dealership_id, getDateRange, selectedSalesperson])
    
    React.useEffect(() => {
        if (canView) {
            fetchData()
        }
    }, [fetchData, canView])
    
    // Export to PDF
    const downloadPdf = () => {
        if (!data || data.items.length === 0) return
        
        const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
        const pageW = doc.internal.pageSize.getWidth()
        const margin = 14
        let y = margin
        
        // Title
        doc.setFontSize(18)
        doc.setFont("helvetica", "bold")
        doc.text("Sold Cars Report", margin, y)
        y += 8
        
        // Date range - use locally calculated dates for accuracy
        const { from, to } = getDateRange()
        let dateRangeText: string
        if (datePreset === "all_time") {
            dateRangeText = "All Time"
        } else if (from && to) {
            dateRangeText = `${format(from, "MMM d, yyyy")} - ${format(to, "MMM d, yyyy")}`
        } else {
            dateRangeText = "Custom Range"
        }
        doc.setFontSize(10)
        doc.setFont("helvetica", "normal")
        doc.text(`Period: ${dateRangeText}`, margin, y)
        y += 10
        
        // Summary section
        doc.setFontSize(12)
        doc.setFont("helvetica", "bold")
        doc.text("Summary", margin, y)
        y += 6
        doc.setFontSize(10)
        doc.setFont("helvetica", "normal")
        const totalActivities = data.items.reduce((sum, i) => sum + i.total_activities, 0)
        const avgActivities = data.items.length > 0 ? (totalActivities / data.items.length).toFixed(1) : "0"
        const uniqueSalespeople = new Set(data.items.map((i) => i.salesperson_id).filter(Boolean)).size
        doc.text(`Total Sold: ${data.total_sold}`, margin, y)
        doc.text(`Salespeople: ${uniqueSalespeople}`, margin + 50, y)
        doc.text(`Total Activities: ${totalActivities}`, margin + 100, y)
        doc.text(`Avg Activities/Lead: ${avgActivities}`, margin + 160, y)
        y += 10
        
        // Main table
        autoTable(doc, {
            startY: y,
            head: [["Lead Name", "Phone", "Sold Date", "Salesperson", "Notes", "Follow-ups", "Appts", "Total"]],
            body: data.items.map((item) => [
                item.lead_name,
                item.phone || "-",
                item.sold_date ? format(new Date(item.sold_date), "MMM d, yyyy") : "-",
                item.salesperson_name || "Unassigned",
                item.notes_count,
                item.follow_ups_count,
                item.appointments_count,
                item.total_activities,
            ]),
            theme: "striped",
            headStyles: { fillColor: [59, 130, 246] },
            margin: { left: margin, right: margin },
            styles: { fontSize: 9 },
        })
        
        // Get final Y position after table
        const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY || y + 50
        
        // Sales by salesperson summary (if space permits, otherwise new page)
        let summaryY = finalY + 10
        if (summaryY > doc.internal.pageSize.getHeight() - 50) {
            doc.addPage()
            summaryY = margin
        }
        
        // Build salesperson summary
        const salesBySalesperson: Record<string, { name: string; count: number; activities: number }> = {}
        data.items.forEach((item) => {
            const spName = item.salesperson_name || "Unassigned"
            if (!salesBySalesperson[spName]) {
                salesBySalesperson[spName] = { name: spName, count: 0, activities: 0 }
            }
            salesBySalesperson[spName].count++
            salesBySalesperson[spName].activities += item.total_activities
        })
        const spSummaryRows = Object.values(salesBySalesperson)
            .sort((a, b) => b.count - a.count)
        
        if (spSummaryRows.length > 0) {
            doc.setFontSize(12)
            doc.setFont("helvetica", "bold")
            doc.text("Sales by Salesperson", margin, summaryY)
            summaryY += 4
            
            autoTable(doc, {
                startY: summaryY,
                head: [["Salesperson", "Cars Sold", "Total Activities", "Avg Activities/Lead"]],
                body: spSummaryRows.map((sp) => [
                    sp.name,
                    sp.count,
                    sp.activities,
                    sp.count > 0 ? (sp.activities / sp.count).toFixed(1) : "0",
                ]),
                theme: "striped",
                headStyles: { fillColor: [59, 130, 246] },
                margin: { left: margin, right: margin },
                styles: { fontSize: 9 },
            })
        }
        
        const dateStr = datePreset === "all_time" 
            ? "all-time" 
            : `${from ? format(from, "yyyy-MM-dd") : "start"}-to-${to ? format(to, "yyyy-MM-dd") : "end"}`
        doc.save(`sold-cars-report-${dateStr}.pdf`)
    }
    
    // Get date range label for display
    const getDateRangeLabel = (): string => {
        if (datePreset === "all_time") return "All Time"
        const { from, to } = getDateRange()
        if (!from || !to) return ""
        if (format(from, "yyyy-MM-dd") === format(to, "yyyy-MM-dd")) {
            return format(from, "MMM d, yyyy")
        }
        return `${format(from, "MMM d")} - ${format(to, "MMM d, yyyy")}`
    }
    
    if (!canView) {
        return (
            <div className="space-y-6">
                <h1 className="text-3xl font-bold tracking-tight">Sold Cars Report</h1>
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <p className="text-muted-foreground text-center">
                            You don&apos;t have permission to view this page.
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }
    
    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight">Sold Cars Report</h1>
                <p className="text-muted-foreground">
                    Track converted leads and sales performance by salesperson.
                </p>
            </div>
            
            {/* Filters */}
            <Card>
                <CardContent className="pt-6">
                    <div className="flex flex-wrap items-end gap-4">
                        {/* Date Preset */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Date Range</label>
                            <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {DATE_PRESETS.map((preset) => (
                                        <SelectItem key={preset.value} value={preset.value}>
                                            {preset.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        
                        {/* Custom Date Pickers */}
                        {datePreset === "custom" && (
                            <>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">From</label>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" className="w-[150px] justify-start text-left font-normal">
                                                <CalendarDays className="mr-2 h-4 w-4" />
                                                {customDateFrom ? format(customDateFrom, "MMM d, yyyy") : "Pick date"}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                                mode="single"
                                                selected={customDateFrom}
                                                onSelect={setCustomDateFrom}
                                                initialFocus
                                            />
                                        </PopoverContent>
                                    </Popover>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">To</label>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" className="w-[150px] justify-start text-left font-normal">
                                                <CalendarDays className="mr-2 h-4 w-4" />
                                                {customDateTo ? format(customDateTo, "MMM d, yyyy") : "Pick date"}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                                mode="single"
                                                selected={customDateTo}
                                                onSelect={setCustomDateTo}
                                                initialFocus
                                            />
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            </>
                        )}
                        
                        {/* Dealership Filter (super admin only) */}
                        {isSuperAdmin && dealerships.length > 0 && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Dealership</label>
                                <Select value={selectedDealershipId} onValueChange={setSelectedDealershipId}>
                                    <SelectTrigger className="w-[200px]">
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
                        
                        {/* Salesperson Filter */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Salesperson</label>
                            <Select value={selectedSalesperson} onValueChange={setSelectedSalesperson}>
                                <SelectTrigger className="w-[200px]">
                                    <SelectValue placeholder="All salespeople" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Salespeople</SelectItem>
                                    {salespersons.map((sp) => (
                                        <SelectItem key={sp.id} value={sp.id}>
                                            {sp.first_name} {sp.last_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        
                        {/* Actions */}
                        <div className="flex items-center gap-2 ml-auto">
                            <Button onClick={fetchData} disabled={isLoading}>
                                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                <span className="ml-2">Refresh</span>
                            </Button>
                            <Button 
                                variant="outline" 
                                onClick={downloadPdf}
                                disabled={isLoading || !data || data.items.length === 0}
                            >
                                <Download className="h-4 w-4 mr-2" />
                                PDF
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
            
            {/* Summary Cards */}
            {data && (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <SummaryCard
                        title="Total Sold"
                        value={data.total_sold}
                        icon={Trophy}
                        description={getDateRangeLabel()}
                    />
                    <SummaryCard
                        title="Unique Salespeople"
                        value={new Set(data.items.map((i) => i.salesperson_id).filter(Boolean)).size}
                        icon={User}
                        description="With sales in period"
                    />
                    <SummaryCard
                        title="Avg Activities/Lead"
                        value={data.items.length > 0 
                            ? (data.items.reduce((sum, i) => sum + i.total_activities, 0) / data.items.length).toFixed(1) 
                            : "0"}
                        icon={Car}
                        description="Notes + Follow-ups + Appointments"
                    />
                    <SummaryCard
                        title="Total Activities"
                        value={data.items.reduce((sum, i) => sum + i.total_activities, 0)}
                        icon={CalendarDays}
                        description="On sold leads"
                    />
                </div>
            )}
            
            {/* Error State */}
            {error && (
                <Card className="border-destructive">
                    <CardContent className="py-4 text-destructive">
                        {error}
                    </CardContent>
                </Card>
            )}
            
            {/* Data Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Car className="h-5 w-5" />
                        Sold Cars ({data?.total_sold || 0})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-auto max-h-[600px]">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead>Lead Name</TableHead>
                                    <TableHead>Phone</TableHead>
                                    <TableHead>Sold Date</TableHead>
                                    <TableHead>Salesperson</TableHead>
                                    <TableHead className="text-center">Notes</TableHead>
                                    <TableHead className="text-center">Follow-ups</TableHead>
                                    <TableHead className="text-center">Appointments</TableHead>
                                    <TableHead className="text-center">Total Activities</TableHead>
                                    <TableHead className="w-[80px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={9}>
                                            <TableLoading />
                                        </TableCell>
                                    </TableRow>
                                ) : !data || data.items.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9}>
                                            <TableEmpty
                                                icon={<Car className="h-10 w-10" />}
                                                title="No sold cars found"
                                                description="No leads have been marked as sold in the selected date range."
                                            />
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    data.items.map((item) => (
                                        <TableRow key={item.lead_id}>
                                            <TableCell className="font-medium">
                                                <Link 
                                                    href={`/leads/${item.lead_id}`}
                                                    className="hover:underline text-primary"
                                                >
                                                    {item.lead_name}
                                                </Link>
                                            </TableCell>
                                            <TableCell>
                                                {item.phone ? (
                                                    <a 
                                                        href={`tel:${item.phone}`}
                                                        className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                                                    >
                                                        <Phone className="h-3 w-3" />
                                                        {item.phone}
                                                    </a>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {item.sold_date ? format(new Date(item.sold_date), "MMM d, yyyy") : "—"}
                                            </TableCell>
                                            <TableCell>
                                                {item.salesperson_name || (
                                                    <span className="text-muted-foreground">Unassigned</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge variant={item.notes_count > 0 ? "secondary" : "outline"}>
                                                    {item.notes_count}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge variant={item.follow_ups_count > 0 ? "secondary" : "outline"}>
                                                    {item.follow_ups_count}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge variant={item.appointments_count > 0 ? "secondary" : "outline"}>
                                                    {item.appointments_count}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge variant={item.total_activities > 0 ? "default" : "outline"}>
                                                    {item.total_activities}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Button variant="ghost" size="sm" asChild>
                                                    <Link href={`/leads/${item.lead_id}`}>
                                                        <ExternalLink className="h-4 w-4" />
                                                    </Link>
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
