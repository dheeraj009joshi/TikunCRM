"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertCircle, BarChart3, Loader2, PhoneCall, PhoneIncoming, PhoneOutgoing, Settings2, Sparkles } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
    AI_OUTCOME_LABELS,
    CallReviewListItem,
    CallReviewListResponse,
    CallReviewService,
    CallSummary,
    SKIP_REASON_LABELS,
    UnreviewedCall,
    apiErrorMessage,
} from "@/services/call-review-service"
import { cn } from "@/lib/utils"
import { formatCallTime as formatWhen, formatDuration, scoreTone } from "@/lib/call-review-utils"

const PAGE_SIZE = 25
const IN_PROGRESS = new Set(["pending", "transcribing", "evaluating"])

function DirectionIcon({ call }: { call: CallSummary | null }) {
    if (!call?.direction) return null
    const Icon = call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing
    return (
        <span title={call.direction === "inbound" ? "Inbound call" : "Outbound call"}>
            <Icon className="h-4 w-4 text-muted-foreground" />
        </span>
    )
}

function StatusCell({ item }: { item: CallReviewListItem }) {
    if (item.status === "completed") {
        return <Badge variant="secondary">{item.manager_reviewed ? "Manager checked" : "AI reviewed"}</Badge>
    }
    if (item.status === "failed") {
        return (
            <Badge variant="destructive" title={item.error ?? undefined}>
                Failed
            </Badge>
        )
    }
    if (item.status === "skipped") {
        return (
            <span className="text-sm text-muted-foreground">
                {SKIP_REASON_LABELS[item.skip_reason ?? ""] ?? "Skipped"}
            </span>
        )
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {item.status === "transcribing" ? "Transcribing" : item.status === "evaluating" ? "Scoring" : "Queued"}
        </span>
    )
}

export default function CallReviewsPage() {
    const router = useRouter()
    const [data, setData] = React.useState<CallReviewListResponse | null>(null)
    const [unreviewed, setUnreviewed] = React.useState<UnreviewedCall[]>([])
    const [page, setPage] = React.useState(1)
    const [isLoading, setIsLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [queueing, setQueueing] = React.useState<string | null>(null)

    const load = React.useCallback(
        async (silent = false) => {
            if (!silent) setIsLoading(true)
            try {
                const res = await CallReviewService.list({ page, page_size: PAGE_SIZE })
                setData(res)
                setError(null)
                if (res.can_manage) {
                    setUnreviewed(await CallReviewService.listUnreviewedCalls())
                }
            } catch (err) {
                if (!silent) setError(apiErrorMessage(err, "Could not load call reviews."))
            } finally {
                if (!silent) setIsLoading(false)
            }
        },
        [page]
    )

    React.useEffect(() => {
        load()
    }, [load])

    // Refresh quietly while anything is still being transcribed or scored
    const hasInProgress = data?.items.some((i) => IN_PROGRESS.has(i.status)) ?? false
    React.useEffect(() => {
        if (!hasInProgress) return
        const timer = setInterval(() => load(true), 5000)
        return () => clearInterval(timer)
    }, [hasInProgress, load])

    const handleReview = async (callId: string) => {
        setQueueing(callId)
        try {
            await CallReviewService.reviewCall(callId)
            setPage(1)
            await load(true)
        } catch (err) {
            setError(apiErrorMessage(err, "Could not start the review."))
        } finally {
            setQueueing(null)
        }
    }

    const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

    return (
        <div className="space-y-6">
            <PageHeader
                title="Call Reviews"
                description="AI feedback on recorded customer calls, scored against your rubric."
                actions={
                    data?.can_manage ? (
                        <>
                            <Button variant="outline" asChild>
                                <Link href="/call-reviews/dashboard">
                                    <BarChart3 className="mr-2 h-4 w-4" />
                                    Team dashboard
                                </Link>
                            </Button>
                            <Button variant="outline" asChild>
                                <Link href="/settings/call-scoring">
                                    <Settings2 className="mr-2 h-4 w-4" />
                                    Scoring criteria
                                </Link>
                            </Button>
                        </>
                    ) : undefined
                }
            />

            {error && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {data?.can_manage && !data.auto_review_enabled && (
                <Alert>
                    <AlertDescription>
                        Automatic review is switched off, so calls are only reviewed when you choose them below. Your
                        administrator can turn on automatic review for every eligible call.
                    </AlertDescription>
                </Alert>
            )}

            <Card>
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : !data || data.items.length === 0 ? (
                        <EmptyState
                            icon={<PhoneCall />}
                            title="No calls reviewed yet"
                            description={
                                data?.can_manage
                                    ? "Pick a recorded call below to get its first AI review."
                                    : "Reviews of your calls will appear here."
                            }
                        />
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Call</TableHead>
                                    <TableHead>Customer</TableHead>
                                    <TableHead>Representative</TableHead>
                                    <TableHead className="text-right">Length</TableHead>
                                    <TableHead className="text-right">Call score</TableHead>
                                    <TableHead>AI heard</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.items.map((item) => (
                                    <TableRow
                                        key={item.id}
                                        className="cursor-pointer"
                                        onClick={() => router.push(`/call-reviews/${item.id}`)}
                                    >
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <DirectionIcon call={item.call} />
                                                <Link
                                                    href={`/call-reviews/${item.id}`}
                                                    className="font-medium hover:underline"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    {formatWhen(item.call?.started_at)}
                                                </Link>
                                            </div>
                                        </TableCell>
                                        <TableCell>{item.customer_name ?? "Unknown caller"}</TableCell>
                                        <TableCell>{item.rep?.name ?? "—"}</TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {item.call ? formatDuration(item.call.duration_seconds) : "—"}
                                        </TableCell>
                                        <TableCell
                                            className={cn(
                                                "text-right font-semibold tabular-nums",
                                                scoreTone(item.overall_score)
                                            )}
                                        >
                                            {item.overall_score != null ? Math.round(item.overall_score) : "—"}
                                            {item.score_corrected && (
                                                <span className="ml-1 text-xs font-normal text-muted-foreground" title="Corrected by a manager">
                                                    (corrected)
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {item.ai_call_outcome ? AI_OUTCOME_LABELS[item.ai_call_outcome] : "—"}
                                        </TableCell>
                                        <TableCell>
                                            <StatusCell item={item} />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {data && data.total > PAGE_SIZE && (
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                        Page {page} of {totalPages} · {data.total} calls
                    </span>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                            Previous
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page >= totalPages}
                            onClick={() => setPage(page + 1)}
                        >
                            Next
                        </Button>
                    </div>
                </div>
            )}

            {data?.can_manage && unreviewed.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Recorded calls not yet reviewed</CardTitle>
                        <CardDescription>
                            Reviewing a call sends its recording for transcription and AI scoring. It usually takes
                            under a minute.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableBody>
                                {unreviewed.map((u) => (
                                    <TableRow key={u.call.id}>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <DirectionIcon call={u.call} />
                                                {formatWhen(u.call.started_at)}
                                            </div>
                                        </TableCell>
                                        <TableCell>{u.customer_name ?? "Unknown caller"}</TableCell>
                                        <TableCell>{u.rep?.name ?? "—"}</TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {formatDuration(u.call.duration_seconds)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={queueing !== null}
                                                onClick={() => handleReview(u.call.id)}
                                            >
                                                {queueing === u.call.id ? (
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Sparkles className="mr-2 h-4 w-4" />
                                                )}
                                                Review call
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
