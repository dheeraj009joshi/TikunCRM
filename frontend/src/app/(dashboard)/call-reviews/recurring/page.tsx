"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
    AlertCircle,
    ChevronDown,
    Download,
    Loader2,
    MessageSquareWarning,
    PhoneCall,
    Search,
    ThumbsUp,
    TrendingUp,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { CallReviewService, RecurringIssues, RecurringRow, apiErrorMessage } from "@/services/call-review-service"

const PERIODS = [
    { days: 7, label: "7 days" },
    { days: 30, label: "30 days" },
    { days: 90, label: "90 days" },
    { days: 365, label: "1 year" },
    { days: 0, label: "All time" },
]

type ListKey = "objections" | "hidden_objections" | "went_well" | "went_badly"

/** The four running lists, in the order they are shown. */
const LISTS: {
    key: ListKey
    title: string
    topLabel: string
    description: string
    icon: React.ElementType
    /** Is a rise good news (things that went well) or bad news (problems)? */
    upIsGood: boolean
    bar: string
    badge: string
    emptyText: string
}[] = [
    {
        key: "objections",
        title: "Objections",
        topLabel: "Most common objection",
        description: "Objections customers actually said on the call. A call counts once per kind of objection.",
        icon: MessageSquareWarning,
        upIsGood: false,
        bar: "bg-red-400/70",
        badge: "bg-red-500/15 text-red-700 dark:text-red-400",
        emptyText: "No objections recorded in this period.",
    },
    {
        key: "hidden_objections",
        title: "Hidden objections",
        topLabel: "Most common hidden objection",
        description:
            "What the AI suspects customers were really worried about but didn't say. Guesses, not facts; ones a manager marked wrong are left out.",
        icon: Search,
        upIsGood: false,
        bar: "bg-primary/60",
        badge: "bg-primary/15 text-primary",
        emptyText: "No guesses yet in this period. Calls reviewed before guessing was added have none until re-scored.",
    },
    {
        key: "went_well",
        title: "Went well",
        topLabel: "Most common strength",
        description: "What reps did well, grouped by scoring criterion. A call counts once per kind.",
        icon: ThumbsUp,
        upIsGood: true,
        bar: "bg-emerald-500/60",
        badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        emptyText: "Nothing recorded in this period.",
    },
    {
        key: "went_badly",
        title: "Didn't go well",
        topLabel: "Most common problem",
        description:
            "Every issue flagged on a call (missed asks, objections left open and things to improve), not just the one shown in Fix this. A call counts once per kind.",
        icon: TrendingUp,
        upIsGood: false,
        bar: "bg-amber-500/70",
        badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        emptyText: "Nothing flagged in this period.",
    },
]

/** Below this many reviewed calls, bars and percentages say more about luck than about patterns. */
const MIN_CALLS_FOR_SHARES = 5

/** "39% of calls", or "under 1%" for very rare items. */
function shareLabel(count: number, total: number): string {
    if (!total) return ""
    const share = count / total
    return share > 0 && share < 0.01 ? "under 1%" : `${Math.round(share * 100)}% of calls`
}

function callsWord(n: number): string {
    return n === 1 ? "call" : "calls"
}

function fmtDate(iso: string | null): string {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

/** "3 more than last period" in words, so the direction never relies on colour alone. */
function Change({ now, before, upIsGood }: { now: number; before: number; upIsGood: boolean }) {
    const diff = now - before
    if (diff === 0) return <span className="text-xs text-muted-foreground">Same as last period</span>
    const good = diff > 0 === upIsGood
    return (
        <span
            className={cn(
                "text-xs font-medium",
                good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            )}
        >
            {diff > 0 ? "▲" : "▼"} {Math.abs(diff)} {diff > 0 ? "more" : "fewer"} than last period ({before})
        </span>
    )
}

function Row({
    row,
    total,
    compare,
    list,
}: {
    row: RecurringRow
    total: number
    compare: boolean
    list: (typeof LISTS)[number]
}) {
    const [open, setOpen] = React.useState(false)
    const share = total ? row.count / total : 0
    const panelId = `pattern-${list.key}-${row.key}`
    return (
        <li className="rounded-lg border">
            <button
                type="button"
                className="flex w-full items-start gap-4 rounded-lg p-4 text-left hover:bg-muted/50"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls={panelId}
            >
                <div className={cn("flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md", list.badge)}>
                    <span className="text-lg font-bold leading-none tabular-nums">{row.count}</span>
                    <span className="text-[10px] uppercase tracking-wide">{row.count === 1 ? "call" : "calls"}</span>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="font-medium">{row.label}</span>
                        {compare && <Change now={row.count} before={row.previous_count} upIsGood={list.upIsGood} />}
                    </div>
                    {total >= MIN_CALLS_FOR_SHARES && (
                        <div className="flex items-center gap-3">
                            <div
                                className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted"
                                role="img"
                                aria-label={`${shareLabel(row.count, total)}: ${row.count} of ${total} reviewed calls`}
                            >
                                <div
                                    className={cn("h-full rounded-full", list.bar)}
                                    style={{ width: `${Math.max(share * 100, 1)}%` }}
                                />
                            </div>
                            <span className="w-24 shrink-0 text-xs font-medium tabular-nums">{shareLabel(row.count, total)}</span>
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                        {row.count} of {total} reviewed {callsWord(total)} ·{" "}
                        {row.by_rep
                            .slice(0, 3)
                            .map((r) => `${r.name} ${r.count}`)
                            .join(", ")}
                        {row.by_rep.length > 3 ? `, +${row.by_rep.length - 3} more` : ""}
                    </p>
                </div>
                <ChevronDown
                    className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                />
            </button>
            {open && (
                <ul id={panelId} className="divide-y border-t">
                    {row.examples.map((ex) => (
                        <li key={ex.review_id}>
                            <Link
                                href={`/call-reviews/${ex.review_id}`}
                                className="flex flex-col gap-0.5 px-4 py-2.5 text-sm hover:bg-muted/50 sm:flex-row sm:gap-4"
                            >
                                <span className="shrink-0 text-xs text-muted-foreground sm:w-44 sm:pt-0.5">
                                    {fmtDate(ex.date)} · {ex.rep}
                                </span>
                                <span className="flex-1">
                                    {ex.text}
                                    {ex.confidence && (
                                        <span className="ml-1.5 text-xs text-muted-foreground">({ex.confidence} confidence)</span>
                                    )}
                                    {ex.resolved != null && (
                                        <span className="ml-1.5 text-xs text-muted-foreground">
                                            ({ex.resolved ? "resolved" : "left open"})
                                        </span>
                                    )}
                                </span>
                            </Link>
                        </li>
                    ))}
                    {row.count > row.examples.length && (
                        <li className="px-4 py-2.5 text-xs text-muted-foreground">
                            Showing the {row.examples.length} most recent of {row.count}.
                        </li>
                    )}
                </ul>
            )}
        </li>
    )
}

/** Spreadsheet copy of all four lists, so the record can be kept or shared outside the CRM. */
function downloadCsv(data: RecurringIssues, periodLabel: string) {
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const lines = [["List", "Kind", "Calls", "Share of reviewed calls", "Previous period", "By rep"].map(cell).join(",")]
    for (const list of LISTS) {
        for (const r of data[list.key]) {
            lines.push(
                [
                    list.title,
                    r.label,
                    r.count,
                    data.calls_reviewed ? `${Math.round((r.count / data.calls_reviewed) * 100)}%` : "",
                    data.period.all_time ? "" : r.previous_count,
                    r.by_rep.map((b) => `${b.name} ${b.count}`).join("; "),
                ]
                    .map(cell)
                    .join(",")
            )
        }
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `call-patterns-${periodLabel.toLowerCase().replace(/\s+/g, "-")}.csv`
    a.click()
    URL.revokeObjectURL(url)
}

export default function CallPatternsPage() {
    const router = useRouter()
    const [days, setDays] = React.useState(30)
    const [tab, setTab] = React.useState<ListKey>("objections")
    const [data, setData] = React.useState<RecurringIssues | null>(null)
    const [isLoading, setIsLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)

    React.useEffect(() => {
        let cancelled = false
        setIsLoading(true)
        CallReviewService.getRecurring(days)
            .then((d) => {
                if (cancelled) return
                setData(d)
                setError(null)
            })
            .catch((err) => {
                if (!cancelled) setError(apiErrorMessage(err, "Could not load call patterns."))
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [days])

    const periodLabel = PERIODS.find((p) => p.days === days)?.label ?? `${days} days`
    // Only compare with the previous period when there is one and it had calls
    const compare = !!data && !data.period.all_time && data.previous_calls_reviewed > 0

    return (
        <div className="space-y-6">
            <PageHeader
                title="Call patterns"
                description="A running record across every reviewed call: what customers object to, what they don't say, what reps do well and what they don't. Most common first."
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex flex-wrap gap-1" role="group" aria-label="Time period">
                            {PERIODS.map((p) => (
                                <Button
                                    key={p.days}
                                    size="sm"
                                    variant={days === p.days ? "default" : "outline"}
                                    aria-pressed={days === p.days}
                                    onClick={() => setDays(p.days)}
                                >
                                    {p.label}
                                </Button>
                            ))}
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={!data || data.calls_reviewed === 0}
                            onClick={() => data && downloadCsv(data, periodLabel)}
                        >
                            <Download className="mr-2 h-4 w-4" />
                            Download
                        </Button>
                    </div>
                }
            />

            {error && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {isLoading && !data ? (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : !data ? null : data.calls_reviewed === 0 ? (
                <Card>
                    <CardContent>
                        <EmptyState
                            icon={<PhoneCall />}
                            title="No reviewed calls in this period"
                            description="The lists fill up as calls are reviewed."
                            action={{ label: "Go to Call Reviews", onClick: () => router.push("/call-reviews") }}
                        />
                    </CardContent>
                </Card>
            ) : (
                <div className={cn("space-y-6", isLoading && "opacity-60")}>
                    <p className="text-sm text-muted-foreground">
                        Based on {data.calls_reviewed} reviewed {data.calls_reviewed === 1 ? "call" : "calls"}
                        {data.period.all_time ? " in total" : ` in the last ${periodLabel}`}.
                        {data.period.truncated && " Only the most recent 5,000 are included."}
                        {data.calls_reviewed < MIN_CALLS_FOR_SHARES &&
                            ` Bars and percentages appear once ${MIN_CALLS_FOR_SHARES} or more calls are reviewed.`}
                    </p>

                    {/* Top of each list at a glance; click to open that list */}
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {LISTS.map((list) => {
                            const top = data[list.key][0]
                            const Icon = list.icon
                            return (
                                <button
                                    key={list.key}
                                    type="button"
                                    onClick={() => setTab(list.key)}
                                    aria-pressed={tab === list.key}
                                    className={cn(
                                        "flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50",
                                        tab === list.key && "ring-2 ring-primary/40"
                                    )}
                                >
                                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        <span className={cn("flex h-6 w-6 items-center justify-center rounded-md", list.badge)}>
                                            <Icon className="h-3.5 w-3.5" />
                                        </span>
                                        {list.topLabel}
                                    </span>
                                    {top ? (
                                        <>
                                            <span className="font-semibold leading-snug">{top.label}</span>
                                            <span className="text-sm text-muted-foreground">
                                                {top.count} of {data.calls_reviewed} {callsWord(data.calls_reviewed)}
                                                {data.calls_reviewed >= MIN_CALLS_FOR_SHARES &&
                                                    ` · ${shareLabel(top.count, data.calls_reviewed).replace(" of calls", "")}`}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="text-sm text-muted-foreground">None yet</span>
                                    )}
                                </button>
                            )
                        })}
                    </div>

                    <Tabs value={tab} onValueChange={(v) => setTab(v as ListKey)}>
                        <TabsList className="h-auto flex-wrap">
                            {LISTS.map((list) => (
                                <TabsTrigger key={list.key} value={list.key}>
                                    {list.title}
                                    <span className="ml-1.5 text-xs text-muted-foreground">({data[list.key].length})</span>
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        {LISTS.map((list) => (
                            <TabsContent key={list.key} value={list.key} className="space-y-3">
                                <p className="text-sm text-muted-foreground">
                                    {list.description}
                                    {data.calls_reviewed >= MIN_CALLS_FOR_SHARES &&
                                        ` The bar is the share of all ${data.calls_reviewed} reviewed calls where it came up.`}{" "}
                                    Click a row to see the calls.
                                </p>
                                {data[list.key].length === 0 ? (
                                    <p className="text-sm text-muted-foreground">{list.emptyText}</p>
                                ) : (
                                    <ul className="space-y-3">
                                        {data[list.key].map((row) => (
                                            <Row key={row.key} row={row} total={data.calls_reviewed} compare={compare} list={list} />
                                        ))}
                                    </ul>
                                )}
                            </TabsContent>
                        ))}
                    </Tabs>
                </div>
            )}
        </div>
    )
}
