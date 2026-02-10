"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
    Search,
    User,
    Phone,
    Mail,
    Building2,
    Loader2,
    XCircle,
    ArrowRight,
    Command
} from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from "@/components/ui/dialog"
import { Badge, getSourceVariant } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { LeadService, Lead, getLeadFullName, getLeadPhone, getLeadEmail } from "@/services/lead-service"
import { getStageLabel, getStageColor } from "@/services/lead-stage-service"
import { useDebounce } from "@/hooks/use-debounce"

interface GlobalSearchModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function GlobalSearchModal({ open, onOpenChange }: GlobalSearchModalProps) {
    const router = useRouter()
    const [query, setQuery] = React.useState("")
    const [results, setResults] = React.useState<Lead[]>([])
    const [isSearching, setIsSearching] = React.useState(false)
    const [selectedIndex, setSelectedIndex] = React.useState(0)
    const inputRef = React.useRef<HTMLInputElement>(null)
    
    const debouncedQuery = useDebounce(query, 300)
    
    // Focus input when modal opens
    React.useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 100)
        } else {
            setQuery("")
            setResults([])
            setSelectedIndex(0)
        }
    }, [open])
    
    // Search when query changes
    React.useEffect(() => {
        async function search() {
            if (!debouncedQuery.trim()) {
                setResults([])
                return
            }
            
            setIsSearching(true)
            try {
                const data = await LeadService.listLeads({
                    search: debouncedQuery,
                    page: 1,
                    page_size: 10
                })
                setResults(data.items)
                setSelectedIndex(0)
            } catch (error) {
                console.error("Search failed:", error)
                setResults([])
            } finally {
                setIsSearching(false)
            }
        }
        
        search()
    }, [debouncedQuery])
    
    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault()
            setSelectedIndex(i => Math.min(i + 1, results.length - 1))
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setSelectedIndex(i => Math.max(i - 1, 0))
        } else if (e.key === "Enter" && results.length > 0) {
            e.preventDefault()
            const selected = results[selectedIndex]
            if (selected) {
                navigateToLead(selected.id)
            }
        } else if (e.key === "Escape") {
            onOpenChange(false)
        }
    }
    
    const navigateToLead = (leadId: string) => {
        onOpenChange(false)
        router.push(`/leads/${leadId}`)
    }
    
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden">
                <DialogTitle className="sr-only">Search Leads</DialogTitle>
                
                {/* Search Input */}
                <div className="flex items-center border-b px-4">
                    <Search className="h-5 w-5 text-muted-foreground shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        className="flex-1 bg-transparent px-3 py-4 text-base outline-none placeholder:text-muted-foreground"
                        placeholder="Search leads by name, phone, or email..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                    {isSearching && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {query && !isSearching && (
                        <button
                            onClick={() => setQuery("")}
                            className="p-1 hover:bg-accent rounded"
                        >
                            <XCircle className="h-4 w-4 text-muted-foreground" />
                        </button>
                    )}
                </div>
                
                {/* Results */}
                <div className="max-h-[400px] overflow-y-auto">
                    {!query && (
                        <div className="p-8 text-center text-muted-foreground">
                            <Search className="h-12 w-12 mx-auto mb-4 opacity-20" />
                            <p className="text-sm">Start typing to search leads</p>
                            <p className="text-xs mt-2">
                                Search by name, phone number, or email address
                            </p>
                        </div>
                    )}
                    
                    {query && !isSearching && results.length === 0 && (
                        <div className="p-8 text-center text-muted-foreground">
                            <XCircle className="h-12 w-12 mx-auto mb-4 opacity-20" />
                            <p className="text-sm">No leads found for "{query}"</p>
                            <p className="text-xs mt-2">
                                Try a different search term
                            </p>
                        </div>
                    )}
                    
                    {results.length > 0 && (
                        <div className="py-2">
                            <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Leads ({results.length})
                            </div>
                            {results.map((lead, index) => (
                                <button
                                    key={lead.id}
                                    className={cn(
                                        "w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-accent transition-colors",
                                        index === selectedIndex && "bg-accent"
                                    )}
                                    onClick={() => navigateToLead(lead.id)}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                >
                                    {/* Avatar */}
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-medium">
                                        {lead.customer?.first_name?.[0]?.toUpperCase() || "?"}
                                        {lead.customer?.last_name?.[0]?.toUpperCase() || ""}
                                    </div>
                                    
                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium truncate">
                                                {getLeadFullName(lead)}
                                            </span>
                                            <Badge size="sm" style={{ backgroundColor: getStageColor(lead.stage), color: "#fff" }}>
                                                {getStageLabel(lead.stage)}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                                            {getLeadPhone(lead) && (
                                                <span className="flex items-center gap-1 truncate">
                                                    <Phone className="h-3 w-3" />
                                                    {getLeadPhone(lead)}
                                                </span>
                                            )}
                                            {getLeadEmail(lead) && (
                                                <span className="flex items-center gap-1 truncate">
                                                    <Mail className="h-3 w-3" />
                                                    {getLeadEmail(lead)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {/* Source & Arrow */}
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Badge variant={getSourceVariant(lead.source)} size="sm">
                                            {lead.source.replace("_", " ")}
                                        </Badge>
                                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                
                {/* Footer */}
                <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px]">↑</kbd>
                            <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px]">↓</kbd>
                            <span>Navigate</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px]">Enter</kbd>
                            <span>Open</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px]">Esc</kbd>
                            <span>Close</span>
                        </span>
                    </div>
                    <span className="flex items-center gap-1">
                        <Command className="h-3 w-3" />
                        <span>K to open</span>
                    </span>
                </div>
            </DialogContent>
        </Dialog>
    )
}
