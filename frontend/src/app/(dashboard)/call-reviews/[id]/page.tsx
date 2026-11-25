"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
    AlertCircle,
    ArrowLeft,
    CalendarCheck,
    CalendarX,
    ChevronDown,
    Lightbulb,
    Loader2,
    Play,
    RefreshCw,
    Search,
    ThumbsDown,
    ThumbsUp,
    TrendingUp,
    UserCheck,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import apiClient from "@/lib/api-client"
import { cn } from "@/lib/utils"
import {
    formatCallTime,
    formatDuration,
    scoreBarTone,
    scoreTone,
    speakerLabel,
} from "@/lib/call-review-utils"
import { voiceService } from "@/services/voice-service"
import {
    AI_OUTCOME_LABELS,
    CallReviewDetail,
    CallReviewService,
    Evidence,
    FeedbackInput,
    FeedbackItemType,
    FeedbackVerdict,
    ItemFeedback,
    Observation,
    SKIP_REASON_LABELS,
    apiErrorMessage,
} from "@/services/call-review-service"

const IN_PROGRESS = new Set(["pending", "transcribing", "evaluating"])

/** A transcript quote that jumps the recording to that moment when clicked. */
function EvidenceQuote({ evidence, onJump }: { evidence: Evidence; onJump: (seconds: number) => void }) {
    const canJump = evidence.timestamp_seconds != null
    return (
        <button
            type="button"
            disabled={!canJump}
            onClick={() => canJump && onJump(evidence.timestamp_seconds as number)}
            title={canJump ? "Play from this moment" : undefined}
            className={cn(
                "group flex w-full items-start gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-left text-sm",
                canJump && "hover:bg-muted"
            )}
        >
            {canJump && (
                <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 font-mono text-xs text-primary">
                    <Play className="h-3 w-3" />
                    {formatDuration(evidence.timestamp_seconds as number)}
                </span>
            )}
            <span className="text-muted-foreground">
                <span className="font-medium text-foreground">{speakerLabel(evidence.speaker)}:</span> “
                {evidence.quote}”
            </span>
        </button>
    )
}

interface FeedbackContext {
    canManage: boolean
    get: (type: FeedbackItemType, key: string) => ItemFeedback | undefined
    save: (input: FeedbackInput) => void
}

/**
 * Manager verdict on one AI item. Managers get two toggle buttons plus a note;
 * everyone else just sees the verdict, if there is one.
 */
function FeedbackControls({
    ctx,
    type,
    itemKey,
    positive,
    negative,
}: {
    ctx: FeedbackContext
    type: FeedbackItemType
    itemKey: string
    positive: { verdict: FeedbackVerdict; label: string }
    negative: { verdict: FeedbackVerdict; label: string }
}) {
    const current = ctx.get(type, itemKey)
    const [noteOpen, setNoteOpen] = React.useState(false)
    const [note, setNote] = React.useState(current?.note ?? "")

    if (!ctx.canManage) {
        if (!current?.verdict && !current?.note) return null
        const isNegative = current.verdict === negative.verdict
        return (
            <p className="text-xs text-muted-foreground">
                <UserCheck className="mr-1 inline h-3.5 w-3.5" />
                Manager: {current.verdict ? (isNegative ? negative.label : positive.label) : "note"}
                {current.note ? ` — ${current.note}` : ""}
            </p>
        )
    }

    const toggle = (verdict: FeedbackVerdict) =>
        ctx.save({
            item_type: type,
            item_key: itemKey,
            verdict: current?.verdict === verdict ? null : verdict,
            note: current?.note ?? null,
        })

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
                <Button
                    type="button"
                    size="sm"
                    variant={current?.verdict === positive.verdict ? "secondary" : "ghost"}
                    aria-pressed={current?.verdict === positive.verdict}
                    className="h-7 px-2 text-xs"
                    onClick={() => toggle(positive.verdict)}
                >
                    <ThumbsUp className="mr-1 h-3.5 w-3.5" />
                    {positive.label}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={current?.verdict === negative.verdict ? "secondary" : "ghost"}
                    aria-pressed={current?.verdict === negative.verdict}
                    className="h-7 px-2 text-xs"
                    onClick={() => toggle(negative.verdict)}
                >
                    <ThumbsDown className="mr-1 h-3.5 w-3.5" />
                    {negative.label}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setNoteOpen((o) => !o)}
                >
                    {current?.note ? "Edit note" : "Add note"}
                </Button>
            </div>
            {current?.note && !noteOpen && (
                <p className="text-xs text-muted-foreground">Your note: {current.note}</p>
            )}
            {noteOpen && (
                <div className="flex items-start gap-2">
                    <Textarea
                        rows={2}
                        maxLength={2000}
                        value={note}
                        aria-label="Note on this item"
                        placeholder="What did the AI get wrong, or what should the rep take from this?"
                        onChange={(e) => setNote(e.target.value)}
                    />
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                            ctx.save({
                                item_type: type,
                                item_key: itemKey,
                                verdict: current?.verdict ?? null,
                                note: note.trim() || null,
                            })
                            setNoteOpen(false)
                        }}
                    >
                        Save
                    </Button>
                </div>
            )}
        </div>
    )
}

const ACCURACY = {
    positive: { verdict: "accurate" as FeedbackVerdict, label: "Accurate" },
    negative: { verdict: "inaccurate" as FeedbackVerdict, label: "Not accurate" },
}
const USEFULNESS = {
    positive: { verdict: "useful" as FeedbackVerdict, label: "Useful" },
    negative: { verdict: "not_useful" as FeedbackVerdict, label: "Not useful" },
}

/** Lets a manager replace the AI score for one criterion. */
function ScoreCorrection({ ctx, criterionKey }: { ctx: FeedbackContext; criterionKey: string }) {
    const current = ctx.get("category", criterionKey)
    const [open, setOpen] = React.useState(false)
    const [value, setValue] = React.useState(current?.corrected_score?.toString() ?? "")

    if (!ctx.canManage) return null
    const parsed = Number(value)
    const valid = value !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= 100

    if (!open) {
        return (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}>
                {current?.corrected_score != null ? "Change corrected score" : "Correct this score"}
            </Button>
        )
    }
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Input
                type="number"
                min={0}
                max={100}
                value={value}
                aria-label="Corrected score, 0 to 100"
                className="h-8 w-24"
                onChange={(e) => setValue(e.target.value)}
            />
            <Button
                type="button"
                size="sm"
                disabled={!valid}
                onClick={() => {
                    ctx.save({
                        item_type: "category",
                        item_key: criterionKey,
                        corrected_score: parsed,
                        verdict: current?.verdict ?? null,
                        note: current?.note ?? null,
                    })
                    setOpen(false)
                }}
            >
                Save
            </Button>
            {current?.corrected_score != null && (
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                        ctx.save({
                            item_type: "category",
                            item_key: criterionKey,
                            corrected_score: null,
                            verdict: current?.verdict ?? null,
                            note: current?.note ?? null,
                        })
                        setValue("")
                        setOpen(false)
                    }}
                >
                    Use AI score
                </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
            </Button>
        </div>
    )
}

function ObservationList({
    title,
    description,
    icon,
    items,
    emptyText,
    onJump,
    ctx,
    type,
    labels = ACCURACY,
}: {
    title: string
    description?: string
    icon: React.ReactNode
    items: Observation[]
    emptyText: string
    onJump: (seconds: number) => void
    ctx: FeedbackContext
    type: FeedbackItemType
    labels?: typeof ACCURACY
}) {
    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    {icon}
                    {title}
                </CardTitle>
                {description && <CardDescription>{description}</CardDescription>}
            </CardHeader>
            <CardContent>
                {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{emptyText}</p>
                ) : (
                    <ul className="space-y-4">
                        {items.map((item, i) => (
                            <li key={i} className="space-y-2">
                                <p className="text-sm">{item.text}</p>
                                {item.evidence.map((ev, j) => (
                                    <EvidenceQuote key={j} evidence={ev} onJump={onJump} />
                                ))}
                                <FeedbackControls ctx={ctx} type={type} itemKey={String(i)} {...labels} />
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    )
}

const CONFIDENCE_LABEL: Record<string, string> = { low: "low confidence", medium: "medium confidence", high: "high confidence" }

/** Plain-word verdict for the score, using the same bands as the score colours. */
function scoreVerdict(score: number | null): string {
    if (score == null) return "Not scored"
    if (score >= 80) return "Strong call"
    if (score >= 60) return "Decent call"
    return "Needs work"
}

/** Score as a ring that fills to the score, number in the middle. */
function ScoreRing({ score }: { score: number | null }) {
    const r = 26
    const circumference = 2 * Math.PI * r
    const filled = score == null ? 0 : (Math.max(0, Math.min(100, score)) / 100) * circumference
    return (
        <div className={cn("relative h-16 w-16 shrink-0", scoreTone(score))}>
            <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90" aria-hidden="true">
                <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-muted" />
                <circle
                    cx="32"
                    cy="32"
                    r={r}
                    fill="none"
                    strokeWidth="6"
                    strokeLinecap="round"
                    stroke="currentColor"
                    strokeDasharray={`${filled} ${circumference}`}
                />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xl font-bold tabular-nums">
                {score != null ? Math.round(score) : "—"}
            </span>
        </div>
    )
}

const TILE_TONES = {
    good: { tile: "border-emerald-500/25 bg-emerald-500/5", badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
    fix: { tile: "border-amber-500/25 bg-amber-500/5", badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
    hidden: { tile: "border-primary/25 bg-primary/5", badge: "bg-primary/15 text-primary" },
} as const

/** One of the three coloured tiles on the at-a-glance card. */
function GlanceTile({
    tone,
    label,
    icon,
    children,
}: {
    tone: keyof typeof TILE_TONES
    label: string
    icon: React.ReactNode
    children: React.ReactNode
}) {
    const t = TILE_TONES[tone]
    return (
        <div className={cn("flex flex-col gap-2.5 rounded-lg border p-4", t.tile)}>
            <div className="flex items-center gap-2">
                <span className={cn("flex h-7 w-7 items-center justify-center rounded-md", t.badge)}>{icon}</span>
                <span className="text-sm font-semibold">{label}</span>
            </div>
            <div className="text-sm leading-relaxed">{children}</div>
        </div>
    )
}

/**
 * The 15-second view: score, whether an appointment was booked, and three
 * tiles: the best thing, the one thing to fix, and the AI's guess at the
 * objection the customer did not say. Everything else is in the breakdown.
 */
function AtAGlance({ review, hiddenMarkedWrong }: { review: CallReviewDetail; hiddenMarkedWrong: boolean }) {
    const ev = review.evaluation
    if (!ev) return null
    const crm = review.crm_outcome
    const score = ev.adjusted_overall_score ?? ev.overall_score
    const unresolved = ev.customer_objections.find((o) => !o.resolved)
    const hidden = ev.hidden_objection
    const isSalesCall = ev.ai_call_outcome !== "not_a_sales_conversation"

    // The single most important thing to fix. The server picks it (skipping items a manager marked
    // wrong) so the tile matches Recurring issues; the local rule is only a fallback.
    const missed = ev.missed_appointment_opportunities[0]
    const fix = ev.top_fix !== undefined
        ? ev.top_fix
        : missed
        ? { text: missed.text, tag: "Missed the ask" }
        : unresolved
          ? { text: unresolved.objection, tag: "Objection left open" }
          : ev.improvements[0]
            ? { text: ev.improvements[0].text, tag: null }
            : null

    return (
        <Card>
            <CardContent className="space-y-5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <ScoreRing score={score} />
                        <div>
                            <p className="text-lg font-semibold leading-tight">{scoreVerdict(score)}</p>
                            <p className="text-sm text-muted-foreground">
                                Call quality score{ev.adjusted_overall_score != null ? " · corrected by a manager" : ""}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {review.manager_review.reviewed_at && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium">
                                <UserCheck className="h-3.5 w-3.5" />
                                Manager checked
                            </span>
                        )}
                        {crm?.appointment_booked ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                                <CalendarCheck className="h-4 w-4" />
                                Appointment booked
                            </span>
                        ) : crm?.appointment_booked === false ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm font-medium text-muted-foreground">
                                <CalendarX className="h-4 w-4" />
                                No appointment booked
                            </span>
                        ) : (
                            <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
                                Not linked to a lead
                            </span>
                        )}
                    </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                    <GlanceTile tone="good" label="Did well" icon={<ThumbsUp className="h-4 w-4" />}>
                        {ev.strengths[0] ? (
                            <p className="line-clamp-3" title={ev.strengths[0].text}>
                                {ev.strengths[0].text}
                            </p>
                        ) : (
                            <p className="text-muted-foreground">Nothing specific noted.</p>
                        )}
                    </GlanceTile>

                    <GlanceTile tone="fix" label="Fix this" icon={<TrendingUp className="h-4 w-4" />}>
                        {fix ? (
                            <div className="space-y-1.5">
                                {fix.tag && (
                                    <span className="inline-block rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                                        {fix.tag}
                                    </span>
                                )}
                                <p className="line-clamp-3" title={fix.text}>
                                    {fix.text}
                                </p>
                            </div>
                        ) : (
                            <p className="text-muted-foreground">Nothing to fix on this call.</p>
                        )}
                    </GlanceTile>

                    {(hidden || isSalesCall) && (
                        <GlanceTile tone="hidden" label="Hidden objection" icon={<Search className="h-4 w-4" />}>
                            {hidden ? (
                                <div className={cn("space-y-2", hiddenMarkedWrong && "opacity-60")}>
                                    <p className={cn("font-medium", hiddenMarkedWrong && "line-through")}>{hidden.guess}</p>
                                    {hidden.how_to_uncover && !hiddenMarkedWrong && (
                                        <p className="rounded-md border-l-2 border-primary/50 bg-background/60 px-2.5 py-1.5 italic">
                                            &ldquo;{hidden.how_to_uncover}&rdquo;
                                        </p>
                                    )}
                                    <p className="text-xs text-muted-foreground">
                                        {hiddenMarkedWrong
                                            ? "A manager marked this guess as wrong."
                                            : `AI's guess · ${CONFIDENCE_LABEL[hidden.confidence] ?? hidden.confidence}${hidden.supported ? "" : " · no clear clues"}`}
                                    </p>
                                </div>
                            ) : (
                                <p className="text-muted-foreground">No guess yet. Re-score this call to get one.</p>
                            )}
                        </GlanceTile>
                    )}
                </div>

                {review.manager_review.note && (
                    <p className="rounded-md bg-muted px-3 py-2 text-sm">
                        <span className="font-medium">Manager note: </span>
                        {review.manager_review.note}
                    </p>
                )}
            </CardContent>
        </Card>
    )
}

export default function CallReviewDetailPage() {
    const params = useParams<{ id: string }>()
    const reviewId = params.id

    const [review, setReview] = React.useState<CallReviewDetail | null>(null)
    const [isLoading, setIsLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [isRerunning, setIsRerunning] = React.useState(false)

    const [audioUrl, setAudioUrl] = React.useState<string | null>(null)
    const [audioError, setAudioError] = React.useState(false)
    const [currentTime, setCurrentTime] = React.useState(0)
    const [search, setSearch] = React.useState("")
    const [showDetails, setShowDetails] = React.useState(false)
    const audioRef = React.useRef<HTMLAudioElement>(null)
    const objectUrlRef = React.useRef<string | null>(null)
    const lineRefs = React.useRef<Record<number, HTMLDivElement | null>>({})

    const load = React.useCallback(
        async (silent = false) => {
            if (!silent) setIsLoading(true)
            try {
                setReview(await CallReviewService.get(reviewId))
                setError(null)
            } catch (err) {
                if (!silent) setError(apiErrorMessage(err, "Could not load this call review."))
            } finally {
                if (!silent) setIsLoading(false)
            }
        },
        [reviewId]
    )

    React.useEffect(() => {
        load()
    }, [load])

    // Keep refreshing while the call is being transcribed / scored
    const inProgress = review ? IN_PROGRESS.has(review.status) : false
    React.useEffect(() => {
        if (!inProgress) return
        const timer = setInterval(() => load(true), 4000)
        return () => clearInterval(timer)
    }, [inProgress, load])

    // Load the recording through the existing access-controlled endpoints
    const callId = review?.call?.has_recording ? review.call.id : null
    React.useEffect(() => {
        if (!callId) return
        let cancelled = false
        ;(async () => {
            try {
                const { recording_url: url } = await voiceService.getRecordingUrl(callId)
                const isProxyUrl = url.includes("/voice/calls/") && url.includes("/recording")
                if (isProxyUrl) {
                    const res = await apiClient.get<Blob>(url, { responseType: "blob", timeout: 120_000 })
                    if (cancelled) return
                    const objectUrl = URL.createObjectURL(res.data)
                    objectUrlRef.current = objectUrl
                    setAudioUrl(objectUrl)
                } else if (!cancelled) {
                    setAudioUrl(url)
                }
            } catch {
                if (!cancelled) setAudioError(true)
            }
        })()
        return () => {
            cancelled = true
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current)
                objectUrlRef.current = null
            }
        }
    }, [callId])

    const transcript = React.useMemo(() => review?.transcript ?? [], [review])

    const activeLine = React.useMemo(() => {
        let active = -1
        for (let i = 0; i < transcript.length; i++) {
            if (transcript[i].start <= currentTime + 0.05) active = i
            else break
        }
        return active
    }, [transcript, currentTime])

    const jumpTo = React.useCallback(
        (seconds: number) => {
            const audio = audioRef.current
            if (audio) {
                audio.currentTime = Math.max(0, seconds)
                audio.play().catch(() => undefined)
            }
            setCurrentTime(seconds)
            const index = transcript.findIndex((l) => Math.abs(l.start - seconds) < 0.05)
            if (index >= 0) {
                lineRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" })
            }
        },
        [transcript]
    )

    const feedbackCtx: FeedbackContext = React.useMemo(
        () => ({
            canManage: !!review?.can_manage,
            get: (type, key) => review?.feedback.find((f) => f.item_type === type && f.item_key === key),
            save: async (input) => {
                try {
                    const result = await CallReviewService.saveFeedback(reviewId, input)
                    setReview((r) =>
                        r && r.evaluation
                            ? {
                                  ...r,
                                  feedback: result.feedback,
                                  evaluation: {
                                      ...r.evaluation,
                                      adjusted_overall_score: result.adjusted_overall_score,
                                      top_fix: result.top_fix,
                                  },
                              }
                            : r
                    )
                    setError(null)
                } catch (err) {
                    setError(apiErrorMessage(err, "Could not save your feedback."))
                }
            },
        }),
        [review, reviewId]
    )

    const [signOffNote, setSignOffNote] = React.useState<string | null>(null)
    const handleSignOff = async (reviewed: boolean) => {
        try {
            const note = signOffNote ?? review?.manager_review.note ?? null
            const result = await CallReviewService.setManagerReview(reviewId, reviewed, note)
            setReview((r) =>
                r ? { ...r, manager_review: { ...r.manager_review, reviewed_at: result.reviewed_at, note: result.note } } : r
            )
            setSignOffNote(null)
        } catch (err) {
            setError(apiErrorMessage(err, "Could not save the manager review."))
        }
    }

    const handleRerun = async () => {
        setIsRerunning(true)
        try {
            await CallReviewService.rerun(reviewId)
            await load(true)
        } catch (err) {
            setError(apiErrorMessage(err, "Could not re-run this review."))
        } finally {
            setIsRerunning(false)
        }
    }

    const query = search.trim().toLowerCase()
    const matchCount = query ? transcript.filter((l) => l.text.toLowerCase().includes(query)).length : 0

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!review) {
        return (
            <div className="space-y-4">
                <BackLink />
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error ?? "Call review not found."}</AlertDescription>
                </Alert>
            </div>
        )
    }

    const ev = review.evaluation
    const crm = review.crm_outcome
    const shownScore = ev ? ev.adjusted_overall_score ?? ev.overall_score : null
    const mr = review.manager_review

    return (
        <div className="space-y-6">
            <BackLink />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight">
                        Call with {review.customer_name ?? "unknown caller"}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {formatCallTime(review.call?.started_at, true)}
                        {review.call && ` · ${formatDuration(review.call.duration_seconds)}`}
                        {review.call?.direction && ` · ${review.call.direction === "inbound" ? "Inbound" : "Outbound"}`}
                        {review.rep && ` · ${review.rep.name}`}
                        {review.dealership && ` · ${review.dealership.name}`}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {review.lead_id && (
                        <Button variant="outline" size="sm" asChild>
                            <Link href={`/leads/${review.lead_id}`}>Open lead</Link>
                        </Button>
                    )}
                    {review.can_manage && !inProgress && (
                        <Button variant="outline" size="sm" onClick={handleRerun} disabled={isRerunning}>
                            {isRerunning ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            {review.status === "failed" ? "Try again" : "Re-score with current criteria"}
                        </Button>
                    )}
                </div>
            </div>

            {error && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {inProgress && (
                <Alert>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <AlertDescription>
                        {review.status === "evaluating" || transcript.length > 0
                            ? ev
                                ? "Re-scoring this call with the current criteria…"
                                : "Transcript ready. The AI is scoring this call…"
                            : "Transcribing the recording…"}{" "}
                        This page updates by itself.
                    </AlertDescription>
                </Alert>
            )}
            {review.status === "failed" && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                        This review could not be completed. {review.error ?? ""}
                    </AlertDescription>
                </Alert>
            )}
            {review.status === "skipped" && (
                <Alert>
                    <AlertDescription>
                        Not reviewed: {SKIP_REASON_LABELS[review.skip_reason ?? ""] ?? "call was not eligible"}.
                    </AlertDescription>
                </Alert>
            )}

            <AtAGlance
                review={review}
                hiddenMarkedWrong={feedbackCtx.get("hidden_objection", "0")?.verdict === "inaccurate"}
            />

            {ev && (
                <Button
                    variant="ghost"
                    className="w-full justify-center border border-dashed text-muted-foreground hover:text-foreground"
                    onClick={() => setShowDetails((v) => !v)}
                    aria-expanded={showDetails}
                    aria-controls="call-review-details"
                >
                    <ChevronDown className={cn("mr-2 h-4 w-4 transition-transform", showDetails && "rotate-180")} />
                    {showDetails
                        ? "Hide full breakdown"
                        : review.can_manage
                          ? "Full breakdown, transcript and manager review"
                          : "Full breakdown and transcript"}
                </Button>
            )}

            {/* Everything below is the detail view. Without an evaluation yet, the transcript is all there is, so show it. */}
            {(showDetails || !ev) && (
                <div id="call-review-details" className="space-y-6">
                    {ev?.summary && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">Summary</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm">{ev.summary}</p>
                            </CardContent>
                        </Card>
                    )}

                    {/* Score + outcome. Quality and outcome are shown apart on purpose. */}
                    {ev && (
                        <div className="grid gap-4 lg:grid-cols-3">
                            <Card>
                                <CardHeader className="pb-2">
                                    <CardDescription>Call quality score</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex items-baseline gap-2">
                                        <span className={cn("text-5xl font-bold tabular-nums", scoreTone(shownScore))}>
                                            {shownScore != null ? Math.round(shownScore) : "—"}
                                        </span>
                                        <span className="text-muted-foreground">/ 100</span>
                                    </div>
                                    {ev.adjusted_overall_score != null && (
                                        <p className="mt-1 text-sm">
                                            Corrected by a manager. The AI scored it{" "}
                                            {ev.overall_score != null ? Math.round(ev.overall_score) : "—"}.
                                        </p>
                                    )}
                                    <p className="mt-2 text-xs text-muted-foreground">
                                        How well the rep handled the conversation, judged by AI against scoring criteria
                                        version {ev.rubric_version ?? "—"}. Not a measure of whether the customer booked.
                                    </p>
                                </CardContent>
                            </Card>

                            <Card className="lg:col-span-2">
                                <CardHeader className="pb-2">
                                    <CardDescription>Outcome</CardDescription>
                                </CardHeader>
                                <CardContent className="grid gap-4 sm:grid-cols-2">
                                    <div>
                                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                            In the CRM
                                        </p>
                                        <div className="mt-1 flex items-center gap-2 font-medium">
                                            {crm?.appointment_booked ? (
                                                <>
                                                    <CalendarCheck className="h-4 w-4 text-emerald-600" />
                                                    Appointment booked
                                                </>
                                            ) : crm?.appointment_booked === false ? (
                                                <>
                                                    <CalendarX className="h-4 w-4 text-muted-foreground" />
                                                    No appointment booked
                                                </>
                                            ) : (
                                                "Unknown (call not linked to a lead)"
                                            )}
                                        </div>
                                        {crm?.appointment?.scheduled_at && (
                                            <p className="text-sm text-muted-foreground">
                                                For {formatCallTime(crm.appointment.scheduled_at, true)} · status{" "}
                                                {crm.appointment.status.replace(/_/g, " ")}
                                            </p>
                                        )}
                                        {crm?.rep_logged_outcome && (
                                            <p className="text-sm text-muted-foreground">
                                                Rep logged: {crm.rep_logged_outcome.replace(/_/g, " ")}
                                            </p>
                                        )}
                                    </div>
                                    <div>
                                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                            What the AI heard on the call
                                        </p>
                                        <p className="mt-1 font-medium">
                                            {ev.ai_call_outcome ? AI_OUTCOME_LABELS[ev.ai_call_outcome] : "—"}
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            Based on the conversation only. The CRM record is the source of truth.
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {ev && (review.can_manage || mr.reviewed_at || mr.note) && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <UserCheck className="h-4 w-4" />
                                    Manager review
                                </CardTitle>
                                <CardDescription>
                                    {mr.reviewed_at
                                        ? `Checked ${formatCallTime(mr.reviewed_at, true)}${mr.reviewed_by ? ` by ${mr.reviewed_by}` : ""}.`
                                        : "No manager has checked this AI review yet."}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {review.can_manage ? (
                                    <>
                                        <Textarea
                                            rows={2}
                                            maxLength={4000}
                                            aria-label="Note for the representative"
                                            placeholder="Optional note for the rep"
                                            value={signOffNote ?? mr.note ?? ""}
                                            onChange={(e) => setSignOffNote(e.target.value)}
                                        />
                                        <div className="flex flex-wrap gap-2">
                                            <Button size="sm" onClick={() => handleSignOff(true)}>
                                                {mr.reviewed_at ? "Save note" : "Mark as reviewed"}
                                            </Button>
                                            {mr.reviewed_at && (
                                                <Button size="sm" variant="ghost" onClick={() => handleSignOff(false)}>
                                                    Undo reviewed
                                                </Button>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    mr.note && <p className="text-sm">{mr.note}</p>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    <div className="grid gap-6 xl:grid-cols-5">
                        {/* Left: AI feedback */}
                        <div className="space-y-6 xl:col-span-3">
                            {ev && (
                                <Card>
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-base">Score breakdown</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-5">
                                        {ev.category_scores.map((c) => (
                                            <div key={c.key} className="space-y-1.5">
                                                <div className="flex items-baseline justify-between gap-3">
                                                    <span className="text-sm font-medium">
                                                        {c.name}{" "}
                                                        <span className="font-normal text-muted-foreground">
                                                            · {c.weight}% of score
                                                        </span>
                                                    </span>
                                                    <span
                                                        className={cn(
                                                            "text-sm font-semibold tabular-nums",
                                                            scoreTone(c.not_applicable ? null : c.score)
                                                        )}
                                                    >
                                                        {c.not_applicable ? "Not applicable" : c.score}
                                                    </span>
                                                </div>
                                                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                                    {!c.not_applicable && c.score != null && (
                                                        <div
                                                            className={cn("h-full rounded-full", scoreBarTone(c.score))}
                                                            style={{ width: `${c.score}%` }}
                                                        />
                                                    )}
                                                </div>
                                                {c.rationale && (
                                                    <p className="text-sm text-muted-foreground">{c.rationale}</p>
                                                )}
                                                {c.evidence.map((e, j) => (
                                                    <EvidenceQuote key={j} evidence={e} onJump={jumpTo} />
                                                ))}
                                                {feedbackCtx.get("category", c.key)?.corrected_score != null && (
                                                    <p className="text-sm font-medium">
                                                        <UserCheck className="mr-1 inline h-4 w-4" />
                                                        Manager corrected this to{" "}
                                                        {feedbackCtx.get("category", c.key)?.corrected_score}
                                                    </p>
                                                )}
                                                <ScoreCorrection ctx={feedbackCtx} criterionKey={c.key} />
                                            </div>
                                        ))}
                                    </CardContent>
                                </Card>
                            )}

                            {ev && (
                                <>
                                    <ObservationList
                                        title="What went well"
                                        ctx={feedbackCtx}
                                        type="strength"
                                        icon={<ThumbsUp className="h-4 w-4 text-emerald-600" />}
                                        items={ev.strengths}
                                        emptyText="Nothing specific noted."
                                        onJump={jumpTo}
                                    />
                                    <ObservationList
                                        title="Areas to improve"
                                        ctx={feedbackCtx}
                                        type="improvement"
                                        icon={<TrendingUp className="h-4 w-4 text-amber-600" />}
                                        items={ev.improvements}
                                        emptyText="Nothing specific noted."
                                        onJump={jumpTo}
                                    />
                                    <ObservationList
                                        title="Missed appointment opportunities"
                                        ctx={feedbackCtx}
                                        type="missed_opportunity"
                                        description="Moments where the rep could have asked for a visit."
                                        icon={<CalendarX className="h-4 w-4 text-red-600" />}
                                        items={ev.missed_appointment_opportunities}
                                        emptyText="None found in this call."
                                        onJump={jumpTo}
                                    />
                                    {ev.hidden_objection && (
                                        <Card>
                                            <CardHeader className="pb-3">
                                                <CardTitle className="flex items-center gap-2 text-base">
                                                    <Search className="h-4 w-4" />
                                                    Hidden objection (AI&apos;s guess)
                                                </CardTitle>
                                                <CardDescription>
                                                    What the customer may really have meant but did not say. A guess to coach from: it does not
                                                    affect the score.
                                                </CardDescription>
                                            </CardHeader>
                                            <CardContent className="space-y-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-sm font-medium">{ev.hidden_objection.guess}</span>
                                                    <Badge variant="outline">
                                                        {CONFIDENCE_LABEL[ev.hidden_objection.confidence] ?? ev.hidden_objection.confidence}
                                                    </Badge>
                                                </div>
                                                {ev.hidden_objection.how_to_uncover && (
                                                    <p className="text-sm text-muted-foreground">
                                                        <span className="font-medium text-foreground">Question that could bring it out: </span>
                                                        {ev.hidden_objection.how_to_uncover}
                                                    </p>
                                                )}
                                                {ev.hidden_objection.evidence.length > 0 ? (
                                                    <>
                                                        <p className="text-xs font-medium text-muted-foreground">Clues in the call</p>
                                                        {ev.hidden_objection.evidence.map((e, j) => (
                                                            <EvidenceQuote key={j} evidence={e} onJump={jumpTo} />
                                                        ))}
                                                    </>
                                                ) : (
                                                    <p className="text-xs text-muted-foreground">
                                                        No clear clues in the transcript, so treat this as a hunch.
                                                    </p>
                                                )}
                                                <FeedbackControls
                                                    ctx={feedbackCtx}
                                                    type="hidden_objection"
                                                    itemKey="0"
                                                    positive={{ verdict: "accurate", label: "Right guess" }}
                                                    negative={{ verdict: "inaccurate", label: "Wrong guess" }}
                                                />
                                            </CardContent>
                                        </Card>
                                    )}
                                    <Card>
                                        <CardHeader className="pb-3">
                                            <CardTitle className="text-base">Customer objections and concerns</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            {ev.customer_objections.length === 0 ? (
                                                <p className="text-sm text-muted-foreground">
                                                    The customer raised no objections.
                                                </p>
                                            ) : (
                                                <ul className="space-y-4">
                                                    {ev.customer_objections.map((o, i) => (
                                                        <li key={i} className="space-y-2">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="text-sm font-medium">{o.objection}</span>
                                                                <Badge variant={o.resolved ? "secondary" : "outline"}>
                                                                    {o.resolved ? "Resolved" : "Not resolved"}
                                                                </Badge>
                                                            </div>
                                                            {o.how_rep_responded && (
                                                                <p className="text-sm text-muted-foreground">
                                                                    {o.how_rep_responded}
                                                                </p>
                                                            )}
                                                            {o.evidence.map((e, j) => (
                                                                <EvidenceQuote key={j} evidence={e} onJump={jumpTo} />
                                                            ))}
                                                            <FeedbackControls
                                                                ctx={feedbackCtx}
                                                                type="objection"
                                                                itemKey={String(i)}
                                                                {...ACCURACY}
                                                            />
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </CardContent>
                                    </Card>
                                    <ObservationList
                                        title="Coaching suggestions"
                                        ctx={feedbackCtx}
                                        type="coaching"
                                        labels={USEFULNESS}
                                        description="What to try on the next call."
                                        icon={<Lightbulb className="h-4 w-4 text-primary" />}
                                        items={ev.coaching_suggestions}
                                        emptyText="No suggestions for this call."
                                        onJump={jumpTo}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        AI-generated feedback · scoring criteria v{ev.rubric_version ?? "—"} · model{" "}
                                        {ev.llm_model} · quotes are checked against the transcript before being shown.
                                    </p>
                                </>
                            )}
                        </div>

                        {/* Right: recording + transcript */}
                        <div className="xl:col-span-2">
                            <Card className="xl:sticky xl:top-4">
                                <CardHeader className="space-y-3 pb-3">
                                    <CardTitle className="text-base">Recording and transcript</CardTitle>
                                    {audioUrl ? (
                                        <audio
                                            ref={audioRef}
                                            src={audioUrl}
                                            controls
                                            preload="metadata"
                                            className="w-full"
                                            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                                            onError={() => setAudioError(true)}
                                        />
                                    ) : audioError ? (
                                        <p className="text-sm text-muted-foreground">The recording could not be loaded.</p>
                                    ) : review.call?.has_recording ? (
                                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <Loader2 className="h-4 w-4 animate-spin" /> Loading recording…
                                        </p>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">No recording for this call.</p>
                                    )}
                                    {transcript.length > 0 && (
                                        <div className="relative">
                                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                value={search}
                                                onChange={(e) => setSearch(e.target.value)}
                                                placeholder="Search transcript"
                                                aria-label="Search transcript"
                                                className="pl-8"
                                            />
                                            {query && (
                                                <span className="absolute right-2.5 top-2.5 text-xs text-muted-foreground">
                                                    {matchCount} {matchCount === 1 ? "match" : "matches"}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </CardHeader>
                                <CardContent>
                                    {transcript.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">
                                            {inProgress ? "Transcript will appear here." : "No transcript available."}
                                        </p>
                                    ) : (
                                        <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
                                            {transcript.map((line, i) => {
                                                const isMatch = query !== "" && line.text.toLowerCase().includes(query)
                                                if (query && !isMatch) return null
                                                return (
                                                    <div
                                                        key={i}
                                                        ref={(el) => {
                                                            lineRefs.current[i] = el
                                                        }}
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={() => jumpTo(line.start)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter" || e.key === " ") {
                                                                e.preventDefault()
                                                                jumpTo(line.start)
                                                            }
                                                        }}
                                                        className={cn(
                                                            "cursor-pointer rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                                                            i === activeLine && !query && "bg-primary/10"
                                                        )}
                                                    >
                                                        <div className="flex items-center gap-2 text-xs">
                                                            <span className="font-mono text-muted-foreground">
                                                                {formatDuration(line.start)}
                                                            </span>
                                                            <span
                                                                className={cn(
                                                                    "font-semibold",
                                                                    line.speaker === "rep"
                                                                        ? "text-primary"
                                                                        : "text-foreground"
                                                                )}
                                                            >
                                                                {speakerLabel(line.speaker)}
                                                            </span>
                                                        </div>
                                                        <p>{line.text}</p>
                                                    </div>
                                                )
                                            })}
                                            {query && matchCount === 0 && (
                                                <p className="px-2 py-4 text-sm text-muted-foreground">
                                                    Nothing in the transcript matches “{search.trim()}”.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

function BackLink() {
    return (
        <Link
            href="/call-reviews"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
            <ArrowLeft className="h-4 w-4" />
            All call reviews
        </Link>
    )
}
