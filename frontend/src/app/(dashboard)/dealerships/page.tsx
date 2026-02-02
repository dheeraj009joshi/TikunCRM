"use client"

import * as React from "react"
import {
    Building2,
    Plus,
    Search,
    Filter,
    MoreVertical,
    MapPin,
    Phone,
    Mail,
    Users,
    ExternalLink,
    Loader2,
    Inbox
} from "lucide-react"
import { cn } from "@/lib/utils"
import { DealershipService } from "@/services/dealership-service"
import { CreateDealershipModal } from "@/components/dealerships/create-dealership-modal"

export default function DealershipsPage() {
    const [dealerships, setDealerships] = React.useState<any[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [search, setSearch] = React.useState("")
    const [createModalOpen, setCreateModalOpen] = React.useState(false)

    const fetchDealerships = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const data = await DealershipService.listDealerships()
            setDealerships(data)
        } catch (error) {
            console.error("Failed to fetch dealerships:", error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    React.useEffect(() => {
        fetchDealerships()
    }, [fetchDealerships])

    const filteredDealerships = dealerships.filter(dealer =>
        dealer.name.toLowerCase().includes(search.toLowerCase()) ||
        (dealer.city && dealer.city.toLowerCase().includes(search.toLowerCase())) ||
        (dealer.email && dealer.email.toLowerCase().includes(search.toLowerCase()))
    )

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Dealership Management</h1>
                    <p className="text-muted-foreground">Manage dealership accounts, permissions, and performance.</p>
                </div>
                <button 
                    onClick={() => setCreateModalOpen(true)}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                >
                    <Plus className="h-4 w-4" />
                    Register New Dealership
                </button>
            </div>

            {/* Stats Overview */}
            <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border bg-card p-4 flex items-center gap-4 border-transparent hover:border-primary/20 transition-all">
                    <div className="rounded-lg bg-primary/10 p-2 text-primary">
                        <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Total Dealerships</p>
                        <p className="text-2xl font-black">{isLoading ? "..." : dealerships.length}</p>
                    </div>
                </div>
                <div className="rounded-xl border bg-card p-4 flex items-center gap-4 border-transparent hover:border-emerald-500/20 transition-all">
                    <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-500">
                        <Users className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Managed Seats</p>
                        <p className="text-2xl font-black">{isLoading ? "..." : dealerships.reduce((acc, d) => acc + (d.users_count || 0), 0)}</p>
                    </div>
                </div>
                <div className="rounded-xl border bg-card p-4 flex items-center gap-4 border-transparent hover:border-blue-500/20 transition-all">
                    <div className="rounded-lg bg-blue-500/10 p-2 text-blue-500">
                        <Inbox className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Global Leads</p>
                        <p className="text-2xl font-black">{isLoading ? "..." : dealerships.reduce((acc, d) => acc + (d.leads_count || 0), 0)}</p>
                    </div>
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                        placeholder="Search dealerships by name, location..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full rounded-md border bg-background/50 pl-9 pr-4 py-2 text-sm outline-none focus:ring-1 focus:ring-primary transition-all"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <button className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent font-medium">
                        <Filter className="h-4 w-4" />
                        Filters
                    </button>
                </div>
            </div>

            {/* Dealership Grid */}
            <div className="grid gap-6 md:grid-cols-2">
                {isLoading ? (
                    [1, 2, 3, 4].map(i => (
                        <div key={i} className="h-64 rounded-xl border bg-card animate-pulse flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground opacity-20" />
                        </div>
                    ))
                ) : filteredDealerships.length === 0 ? (
                    <div className="col-span-full py-20 text-center rounded-xl border border-dashed flex flex-col items-center gap-4">
                        <Building2 className="h-12 w-12 text-muted-foreground opacity-20" />
                        <p className="text-muted-foreground font-bold">No dealerships found.</p>
                        <button 
                            onClick={() => setCreateModalOpen(true)}
                            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        >
                            <Plus className="h-4 w-4" />
                            Create First Dealership
                        </button>
                    </div>
                ) : (
                    filteredDealerships.map((dealer) => (
                        <div key={dealer.id} className="group relative rounded-xl border bg-card p-6 hover:shadow-xl transition-all hover:border-primary/20">
                            <div className="flex items-start justify-between">
                                <div className="flex gap-4">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary font-black text-white shadow-xl shadow-primary/20 text-lg">
                                        {dealer.name[0]}
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-black tracking-tight">{dealer.name}</h3>
                                        <div className="flex items-center gap-1 text-xs font-bold text-muted-foreground/60 mt-0.5">
                                            <MapPin className="h-3 w-3" />
                                            {dealer.city || "N/A"}, {dealer.state || "N/A"}
                                        </div>
                                    </div>
                                </div>
                                <button className="rounded-md p-1 hover:bg-accent text-muted-foreground transition-colors">
                                    <MoreVertical className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="mt-8 grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">Direct Contact</p>
                                    <div className="flex items-center gap-2 text-xs font-medium">
                                        <Mail className="h-3.5 w-3.5 text-primary" />
                                        <span className="truncate">{dealer.email || "N/A"}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs font-medium">
                                        <Phone className="h-3.5 w-3.5 text-primary" />
                                        <span>{dealer.phone || "N/A"}</span>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">Business Pulse</p>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-muted-foreground font-medium">Active Seats:</span>
                                        <span className="font-black">{dealer.users_count || 0}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-muted-foreground font-medium">Total Leads:</span>
                                        <span className="font-black">{dealer.leads_count || 0}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-8 flex items-center justify-between pt-6 border-t border-dashed">
                                <div className="flex items-center gap-2">
                                    <div className={cn(
                                        "h-2 w-2 rounded-full",
                                        dealer.is_active ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-red-500"
                                    )} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">{dealer.is_active ? 'Active Operation' : 'Suspended'}</span>
                                </div>
                                <button className="flex items-center gap-1 text-xs font-black uppercase tracking-widest text-primary hover:underline group-hover:gap-2 transition-all">
                                    Enter Dashboard
                                    <ExternalLink className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Create Dealership Modal */}
            <CreateDealershipModal
                isOpen={createModalOpen}
                onClose={() => setCreateModalOpen(false)}
                onSuccess={fetchDealerships}
            />
        </div>
    )
}
