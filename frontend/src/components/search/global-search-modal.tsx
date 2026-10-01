"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
    Sparkles,
    Phone,
    Mail,
    Loader2,
    XCircle,
    ArrowRight,
    Command,
    CornerDownLeft,
    MessageSquare,
    PhoneCall,
} from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from "@/components/ui/dialog"
import { Badge, getSourceVariant, getStatusVariant } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { AiSearchService, type AiSearchLead, type AiSearchResponse } from "@/services/ai-search-service"
import { useDebounce } from "@/hooks/use-debounce"

const EXAMPLES = [
    { label: "Called 3× in 7 days", query: "leads I called 3 times in the last 7 days" },
    { label: "No contact this week", query: "leads not contacted in the last 7 days" },
    { label: "Mentioned financing", query: "notes or calls that mention financing" },
    { label: "WhatsApp this week", query: "leads with WhatsApp messages in the last 7 days" },
]

interface GlobalSearchModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function GlobalSearchModal({ open, onOpenChange }: GlobalSearchModalProps) {
    const router = useRouter()
    const [query, setQuery] = React.useState("")
    const [result, setResult] = React.useState<AiSearchResponse | null>(null)
    const [isSearching, setIsSearching] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [selectedIndex, setSelectedIndex] = React.useState(0)
    const [lastSearched, setLastSearched] = React.useState("")
    const inputRef = React.useRef<HTMLInputElement>(null)
    const abortRef = React.useRef<AbortController | null>(null)

    const leads = result?.leads ?? []
    const debouncedQuery = useDebounce(query, 180)

    React.useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 80)
        } else {
            abortRef.current?.abort()
            setQuery("")
            setResult(null)
            setError(null)
            setSelectedIndex(0)
            setLastSearched("")
            setIsSearching(false)
        }
    }, [open])

    const runSearch = React.useCallback(async (raw: string) => {
        const q = raw.trim()
        if (q.length < 3) return
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller
        setIsSearching(true)
        setError(null)
        try {
            const data = await AiSearchService.search(q, controller.signal)
            setResult(data)
            setLastSearched(q)
            setSelectedIndex(0)
        } catch (err) {
            if ((err as { name?: string })?.name === "AbortError") return
            console.error("AI search failed:", err)
            setResult(null)
            setError(err instanceof Error ? err.message : "Search failed")
        } finally {
            if (!controller.signal.aborted) setIsSearching(false)
        }
    }, [])

    React.useEffect(() => {
        const q = debouncedQuery.trim()
        if (!open) return
        if (q.length < 3) {
            setResult(null)
            setError(null)
            setLastSearched("")
            return
        }
        if (q === lastSearched) return
        void runSearch(q)
    }, [debouncedQuery, open, lastSearched, runSearch])

    const navigateToLead = (leadId: string) => {
        onOpenChange(false)
        router.push(`/leads/${leadId}`)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault()
            setSelectedIndex((i) => Math.min(i + 1, Math.max(leads.length - 1, 0)))
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setSelectedIndex((i) => Math.max(i - 1, 0))
        } else if (e.key === "Enter") {
            e.preventDefault()
            const q = query.trim()
            if (!isSearching && leads.length > 0 && q === lastSearched) {
                const selected = leads[selectedIndex]
                if (selected) navigateToLead(selected.id)
                return
            }
            void runSearch(query)
        } else if (e.key === "Escape") {
            onOpenChange(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                hideCloseButton
                className="gap-0 overflow-hidden p-0 sm:max-w-2xl border-border/70 shadow-2xl"
            >
                <DialogTitle className="sr-only">AI search</DialogTitle>

                <div className="relative border-b bg-gradient-to-r from-violet-500/10 via-background to-sky-500/10">
                    <div className="flex items-center gap-3 px-4">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-300">
                            {isSearching ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Sparkles className="h-4 w-4" />
                            )}
                        </div>
                        <input
                            ref={inputRef}
                            type="text"
                            className="min-w-0 flex-1 bg-transparent py-4 text-[15px] outline-none placeholder:text-muted-foreground/80"
                            placeholder="Type 3+ letters or digits — name, phone, notes…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={handleKeyDown}
                            aria-label="AI search query"
                        />
                        {query && !isSearching && (
                            <button
                                type="button"
                                onClick={() => {
                                    setQuery("")
                                    setResult(null)
                                    setError(null)
                                    setLastSearched("")
                                    inputRef.current?.focus()
                                }}
                                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                aria-label="Clear search"
                            >
                                <XCircle className="h-4 w-4" />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => void runSearch(query)}
                            disabled={isSearching || query.trim().length < 3}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-2.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40"
                        >
                            <CornerDownLeft className="h-3.5 w-3.5" />
                            Search
                        </button>
                    </div>
                </div>

                <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
                    {!result && !isSearching && !error && query.trim().length > 0 && query.trim().length < 3 && (
                        <div className="px-5 py-8 text-center">
                            <p className="text-sm font-medium">Keep typing</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Suggestions appear after 3 characters. Phone works with or without +91.
                            </p>
                        </div>
                    )}

                    {!result && !isSearching && !error && query.trim().length === 0 && (
                        <div className="px-5 py-6">
                            <p className="text-sm font-medium text-foreground">Try asking</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Suggestions appear after 3 characters. Phone matches with or without +91.
                            </p>
                            <div className="mt-4 flex flex-wrap gap-2">
                                {EXAMPLES.map((ex) => (
                                    <button
                                        key={ex.query}
                                        type="button"
                                        onClick={() => {
                                            setQuery(ex.query)
                                            void runSearch(ex.query)
                                        }}
                                        className="rounded-full border border-violet-500/20 bg-violet-500/5 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-violet-500/10"
                                    >
                                        {ex.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {isSearching && !result && (
                        <div className="flex flex-col items-center justify-center gap-2 px-5 py-12 text-center">
                            <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
                            <p className="text-sm font-medium">Finding matches…</p>
                            <p className="text-xs text-muted-foreground">
                                Names, phones, and notes — country code optional
                            </p>
                        </div>
                    )}

                    {error && !isSearching && (
                        <div className="px-5 py-10 text-center">
                            <XCircle className="mx-auto mb-3 h-8 w-8 text-destructive/70" />
                            <p className="text-sm font-medium">Search didn’t complete</p>
                            <p className="mt-1 text-xs text-muted-foreground">{error}</p>
                        </div>
                    )}

                    {result && (
                        <div className={cn("py-2", isSearching && "opacity-70")}>
                            <div className="flex items-start justify-between gap-3 px-5 py-2">
                                <div>
                                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                        {result.total} {result.total === 1 ? "lead" : "leads"}
                                        {isSearching ? " · updating" : ""}
                                    </p>
                                    {result.interpretation && (
                                        <p className="mt-0.5 text-sm text-foreground/90">
                                            {result.interpretation}
                                        </p>
                                    )}
                                </div>
                                <Badge variant="outline" size="sm" className="shrink-0 capitalize">
                                    {result.backend === "azure"
                                        ? "Azure AI"
                                        : /phone|contact|matching “/i.test(result.interpretation || "")
                                          ? "Live match"
                                          : result.backend === "structured"
                                            ? "Filtered"
                                            : "Meaning match"}
                                </Badge>
                            </div>

                            {leads.length === 0 ? (
                                <div className="px-5 py-10 text-center text-muted-foreground">
                                    <p className="text-sm">No matching leads</p>
                                    <p className="mt-1 text-xs">Try a name, or a question like “called twice this week”.</p>
                                </div>
                            ) : (
                                leads.map((lead, index) => (
                                    <ResultRow
                                        key={lead.id}
                                        lead={lead}
                                        query={query}
                                        selected={index === selectedIndex}
                                        onSelect={() => navigateToLead(lead.id)}
                                        onHover={() => setSelectedIndex(index)}
                                    />
                                ))
                            )}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                            <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono">↑</kbd>
                            <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono">↓</kbd>
                            Move
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono">Enter</kbd>
                            Search / open
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono">Esc</kbd>
                            Close
                        </span>
                    </div>
                    <span className="hidden items-center gap-1 sm:flex">
                        <Command className="h-3 w-3" />
                        K
                    </span>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
    const q = query.trim()
    if (!text || q.length < 2) return <>{text}</>
    const digits = q.replace(/\D/g, "")
    const hayDigits = text.replace(/\D/g, "")
    const digitNeedles = [digits]
    if (digits.startsWith("91") && digits.length >= 5) digitNeedles.push(digits.slice(2))
    if (digits.startsWith("1") && digits.length >= 4) digitNeedles.push(digits.slice(1))
    const needle = digitNeedles.find((d) => d.length >= 3 && hayDigits.includes(d))
    if (needle) {
        const start = hayDigits.indexOf(needle)
        let seen = 0
        let from = -1
        let to = -1
        for (let i = 0; i < text.length; i++) {
            if (/\d/.test(text[i])) {
                if (seen === start) from = i
                if (seen === start + needle.length - 1) {
                    to = i + 1
                    break
                }
                seen++
            }
        }
        if (from >= 0 && to > from) {
            return (
                <>
                    {text.slice(0, from)}
                    <mark className="rounded-sm bg-violet-500/20 px-0.5 text-inherit">{text.slice(from, to)}</mark>
                    {text.slice(to)}
                </>
            )
        }
    }
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const match = text.match(new RegExp(escaped, "i"))
    if (!match || match.index == null) return <>{text}</>
    const i = match.index
    return (
        <>
            {text.slice(0, i)}
            <mark className="rounded-sm bg-violet-500/20 px-0.5 text-inherit">{text.slice(i, i + q.length)}</mark>
            {text.slice(i + q.length)}
        </>
    )
}

function ResultRow({
    lead,
    query,
    selected,
    onSelect,
    onHover,
}: {
    lead: AiSearchLead
    query: string
    selected: boolean
    onSelect: () => void
    onHover: () => void
}) {
    const initials = lead.name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase())
        .join("") || "?"
    const snippet = lead.snippets?.[0]

    return (
        <button
            type="button"
            className={cn(
                "flex w-full items-start gap-3 px-5 py-3 text-left transition-colors",
                selected ? "bg-violet-500/8" : "hover:bg-accent/70"
            )}
            onClick={onSelect}
            onMouseEnter={onHover}
        >
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-xs font-semibold text-violet-700 dark:text-violet-300">
                {initials}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">
                        <HighlightMatch text={lead.name} query={query} />
                    </span>
                    {lead.stage && (
                        <Badge size="sm" variant={getStatusVariant(lead.stage)}>
                            {lead.stage}
                        </Badge>
                    )}
                    {lead.source && (
                        <Badge size="sm" variant={getSourceVariant(String(lead.source))}>
                            {String(lead.source).replace(/_/g, " ")}
                        </Badge>
                    )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {lead.phone && (
                        <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            <HighlightMatch text={lead.phone} query={query} />
                        </span>
                    )}
                    {lead.email && (
                        <span className="inline-flex items-center gap-1 truncate">
                            <Mail className="h-3 w-3" />
                            {lead.email}
                        </span>
                    )}
                </div>
                {lead.reasons?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {lead.reasons.map((reason) => (
                            <span
                                key={reason}
                                className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                            >
                                {reason.toLowerCase().includes("call") ? (
                                    <PhoneCall className="h-3 w-3 text-violet-500" />
                                ) : reason.toLowerCase().includes("note") || reason.toLowerCase().includes("mention") ? (
                                    <MessageSquare className="h-3 w-3 text-violet-500" />
                                ) : (
                                    <Sparkles className="h-3 w-3 text-violet-500" />
                                )}
                                {reason}
                            </span>
                        ))}
                    </div>
                )}
                {snippet?.snippet && (
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {snippet.activity_label ? `${snippet.activity_label}: ` : ""}
                        {snippet.snippet}
                    </p>
                )}
            </div>
            <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground/70" />
        </button>
    )
}
