"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { AlertCircle, Loader2, Mail, PhoneCall, Repeat, Target } from "lucide-react"
import { AskAboutCalls } from "@/components/call-reviews/ask-about-calls"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import {
    CallDashboard,
    CallReviewService,
    CriterionStats,
    GroupStats,
    Rate,
    TrendPoint,
    apiErrorMessage,
} from "@/services/call-review-service"

const PERIODS = [
    { days: 7, label: "7 days" },
    { days: 30, label: "30 days" },
    { days: 90, label: "90 days" },
]

function pct(rate: Rate): string {
    return rate.rate == null ? "—" : `${Math.round(rate.rate * 100)}%`
}

function fmtDate(iso: string): string {
    // Bucket dates are plain calendar days; parse as local to avoid shifting a day
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function Tile({
    label,
    value,
    detail,
    footnote,
}: {
    label: string
    value: string
    detail?: string
    footnote?: string
}) {
    return (
        <Card>
            <CardContent className="space-y-1 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="text-3xl font-bold tabular-nums">{value}</p>
                {detail && <p className="text-sm">{detail}</p>}
                {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
            </CardContent>
        </Card>
    )
}

/** Average call score over time. One series, one axis (0-100). */
function ScoreTrend({
    points,
    bucket,
    changes,
}: {
    points: TrendPoint[]
    bucket: "day" | "week"
    changes: CallDashboard["rubric_changes"]
}) {
    const [hover, setHover] = React.useState<number | null>(null)
    const scored = points.filter((p) => p.average_score != null)
    const W = 720
    const H = 240
    const pad = { left: 36, right: 16, top: 16, bottom: 28 }
    const innerW = W - pad.left - pad.right
    const innerH = H - pad.top - pad.bottom
    const x = (i: number) => pad.left + (scored.length === 1 ? innerW / 2 : (i / (scored.length - 1)) * innerW)
    const y = (score: number) => pad.top + innerH - (score / 100) * innerH
    const path = scored.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.average_score as number)}`).join(" ")
    const labelEvery = Math.max(1, Math.ceil(scored.length / 8))
    const active = hover != null ? scored[hover] : null

    // Place a "criteria changed" marker at the first bucket on or after the publish date
    const markers = changes
        .map((c) => {
            if (!c.published_at) return null
            const day = c.published_at.slice(0, 10)
            const index = scored.findIndex((p) => p.date >= day)
            return index >= 0 ? { index, version: c.version } : null
        })
        .filter((m): m is { index: number; version: number } => m !== null)

    if (scored.length === 0) {
        return <p className="py-8 text-center text-sm text-muted-foreground">No scored calls in this period.</p>
    }

    return (
        <div className="relative">
            <svg
                viewBox={`0 0 ${W} ${H}`}
                className="w-full"
                role="img"
                aria-label={`Average call quality score per ${bucket}, from ${fmtDate(scored[0].date)} to ${fmtDate(scored[scored.length - 1].date)}`}
                onMouseLeave={() => setHover(null)}
            >
                {[0, 25, 50, 75, 100].map((tick) => (
                    <g key={tick}>
                        <line
                            x1={pad.left}
                            x2={W - pad.right}
                            y1={y(tick)}
                            y2={y(tick)}
                            stroke="var(--border)"
                            strokeWidth={1}
                        />
                        <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="var(--muted-foreground)">
                            {tick}
                        </text>
                    </g>
                ))}
                {markers.map((m) => (
                    <g key={m.version}>
                        <line
                            x1={x(m.index)}
                            x2={x(m.index)}
                            y1={pad.top}
                            y2={pad.top + innerH}
                            stroke="var(--muted-foreground)"
                            strokeWidth={1}
                        />
                        <text x={x(m.index) + 4} y={pad.top + 10} fontSize={11} fill="var(--muted-foreground)">
                            criteria v{m.version}
                        </text>
                    </g>
                ))}
                {scored.map(
                    (p, i) =>
                        i % labelEvery === 0 && (
                            <text
                                key={p.date}
                                x={x(i)}
                                y={H - 8}
                                textAnchor="middle"
                                fontSize={11}
                                fill="var(--muted-foreground)"
                            >
                                {fmtDate(p.date)}
                            </text>
                        )
                )}
                {active && hover != null && (
                    <line
                        x1={x(hover)}
                        x2={x(hover)}
                        y1={pad.top}
                        y2={pad.top + innerH}
                        stroke="var(--foreground)"
                        strokeOpacity={0.25}
                        strokeWidth={1}
                    />
                )}
                <path d={path} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {scored.map((p, i) => (
                    <circle
                        key={p.date}
                        cx={x(i)}
                        cy={y(p.average_score as number)}
                        r={hover === i ? 5 : 4}
                        fill="var(--primary)"
                        stroke="var(--card)"
                        strokeWidth={2}
                    />
                ))}
                {/* Wide invisible hit targets so hovering does not need pixel accuracy */}
                {scored.map((p, i) => {
                    const band = scored.length === 1 ? innerW : innerW / (scored.length - 1)
                    return (
                        <rect
                            key={p.date}
                            x={x(i) - band / 2}
                            y={pad.top}
                            width={band}
                            height={innerH}
                            fill="transparent"
                            onMouseEnter={() => setHover(i)}
                        />
                    )
                })}
            </svg>
            {active && hover != null && (
                <div
                    className="pointer-events-none absolute top-2 z-10 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
                    style={
                        x(hover) > W / 2
                            ? { right: `${100 - (x(hover) / W) * 100 + 2}%` }
                            : { left: `${(x(hover) / W) * 100 + 2}%` }
                    }
                >
                    <p className="font-medium">
                        {bucket === "week" ? "Week of " : ""}
                        {fmtDate(active.date)}
                    </p>
                    <p>Average score {active.average_score}</p>
                    <p className="text-muted-foreground">
                        {active.calls_reviewed} {active.calls_reviewed === 1 ? "call" : "calls"} reviewed
                    </p>
                    <p className="text-muted-foreground">
                        Appointments: {active.appointment_rate.numerator} of {active.appointment_rate.denominator}
                    </p>
                </div>
            )}
        </div>
    )
}

/** Horizontal bars: share of calls, with the count written out beside each bar. */
function ShareBars({
    rows,
    emptyText,
}: {
    rows: { key: string; label: string; count: number; total: number; note?: string }[]
    emptyText: string
}) {
    if (rows.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>
    return (
        <ul className="space-y-3">
            {rows.map((r) => {
                const share = r.total ? r.count / r.total : 0
                return (
                    <li key={r.key} className="space-y-1" title={`${r.label}: ${r.count} of ${r.total} calls`}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="font-medium">{r.label}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                                {r.count} of {r.total} calls
                            </span>
                        </div>
                        <div className="h-3 w-full rounded-sm bg-muted">
                            <div
                                className="h-full rounded-r-[4px] bg-primary"
                                style={{ width: `${Math.max(share * 100, 1)}%` }}
                            />
                        </div>
                        {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                    </li>
                )
            })}
        </ul>
    )
}

function GroupTable({ title, description, rows }: { title: string; description: string; rows: GroupStats[] }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead className="text-right">Calls reviewed</TableHead>
                            <TableHead className="text-right">Avg call score</TableHead>
                            <TableHead className="text-right">Appointments set</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((r) => (
                            <TableRow key={r.id ?? "none"}>
                                <TableCell className="font-medium">{r.name}</TableCell>
                                <TableCell className="text-right tabular-nums">{r.calls_reviewed}</TableCell>
                                <TableCell className="text-right tabular-nums">{r.average_score ?? "—"}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {pct(r.appointment_rate)}
                                    <span className="text-muted-foreground">
                                        {" "}
                                        ({r.appointment_rate.numerator} of {r.appointment_rate.denominator})
                                    </span>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    )
}

function criteriaRows(list: CriterionStats[], field: "low_count" | "high_count") {
    return list.map((c) => ({
        key: c.key,
        label: c.name,
        count: c[field],
        total: c.calls,
        note: `Average score ${c.average_score ?? "—"}`,
    }))
}

export default function CallIntelligencePage() {
    const router = useRouter()
    const [days, setDays] = React.useState(30)
    const [data, setData] = React.useState<CallDashboard | null>(null)
    const [isLoading, setIsLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [showTable, setShowTable] = React.useState(false)
    const [reportState, setReportState] = React.useState<"idle" | "sending">("idle")
    const [reportNote, setReportNote] = React.useState<{ ok: boolean; text: string } | null>(null)

    const emailReport = async () => {
        setReportState("sending")
        setReportNote(null)
        try {
            const r = await CallReviewService.emailReportToMe()
            setReportNote({ ok: true, text: `The last 7 days' report was emailed to ${r.sent_to}.` })
        } catch (err) {
            setReportNote({ ok: false, text: apiErrorMessage(err, "The report could not be emailed.") })
        } finally {
            setReportState("idle")
        }
    }

    React.useEffect(() => {
        let cancelled = false
        setIsLoading(true)
        CallReviewService.getDashboard({ days })
            .then((d) => {
                if (cancelled) return
                setData(d)
                setError(null)
            })
            .catch((err) => {
                if (!cancelled) setError(apiErrorMessage(err, "Could not load call intelligence."))
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [days])

    const s = data?.summary
    const prev = data?.previous_summary
    const scoreDelta =
        s?.average_score != null && prev?.average_score != null
            ? Math.round((s.average_score - prev.average_score) * 10) / 10
            : null
    const apptDelta =
        s?.appointment_rate.rate != null && prev?.appointment_rate.rate != null
            ? Math.round((s.appointment_rate.rate - prev.appointment_rate.rate) * 100)
            : null

    return (
        <div className="space-y-6">
            <PageHeader
                title="Call Intelligence"
                description="How the team is doing on calls: AI quality scores next to what actually happened in the CRM."
                actions={
                    <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm" variant="outline" asChild>
                        <Link href="/call-reviews/recurring">
                            <Repeat className="mr-2 h-4 w-4" />
                            Call patterns
                        </Link>
                    </Button>
                    <Button size="sm" variant="outline" onClick={emailReport} disabled={reportState === "sending"}>
                        {reportState === "sending" ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Mail className="mr-2 h-4 w-4" />
                        )}
                        Email me the weekly report
                    </Button>
                    <div className="flex gap-1" role="group" aria-label="Time period">
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
                    </div>
                }
            />

            {reportNote && (
                <Alert variant={reportNote.ok ? "default" : "destructive"}>
                    {reportNote.ok ? <Mail className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                    <AlertDescription>{reportNote.text}</AlertDescription>
                </Alert>
            )}

            {error && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {data && s && s.calls_reviewed > 0 && <AskAboutCalls days={days} />}

            {isLoading && !data ? (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : !data || !s ? null : s.calls_reviewed === 0 ? (
                <Card>
                    <CardContent>
                        <EmptyState
                            icon={<PhoneCall />}
                            title="No reviewed calls in this period"
                            description="Numbers appear here once calls have been reviewed."
                            action={{ label: "Go to Call Reviews", onClick: () => router.push("/call-reviews") }}
                        />
                    </CardContent>
                </Card>
            ) : (
                <div className={cn("space-y-6", isLoading && "opacity-60")}>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <Tile label="Calls reviewed" value={String(s.calls_reviewed)} footnote={`Previous ${days} days: ${prev?.calls_reviewed ?? 0}`} />
                        <Tile
                            label="Average call quality"
                            value={s.average_score != null ? String(s.average_score) : "—"}
                            detail={
                                scoreDelta == null
                                    ? undefined
                                    : `${scoreDelta > 0 ? "+" : ""}${scoreDelta} vs previous ${days} days`
                            }
                            footnote="AI score out of 100, with manager corrections applied"
                        />
                        <Tile
                            label="Appointment-setting rate"
                            value={pct(s.appointment_rate)}
                            detail={`${s.appointment_rate.numerator} of ${s.appointment_rate.denominator} reviewed calls linked to a lead${
                                apptDelta == null ? "" : ` · ${apptDelta > 0 ? "+" : ""}${apptDelta} pts`
                            }`}
                            footnote={
                                s.calls_without_lead
                                    ? `From CRM appointments. ${s.calls_without_lead} calls with no lead are left out.`
                                    : "From CRM appointments, not from the AI"
                            }
                        />
                        <Tile
                            label="Appointment show rate"
                            value={pct(s.show_rate)}
                            detail={`${s.show_rate.numerator} of ${s.show_rate.denominator} appointments with a known outcome`}
                            footnote={
                                s.appointments_outcome_pending
                                    ? `${s.appointments_outcome_pending} still upcoming, cancelled or rescheduled are left out`
                                    : "Arrived vs no-show, from the CRM"
                            }
                        />
                    </div>

                    {data.period.truncated && (
                        <Alert>
                            <AlertDescription>
                                This period has more calls than can be analysed at once, so only the most recent are
                                included. Choose a shorter period for exact numbers.
                            </AlertDescription>
                        </Alert>
                    )}

                    {data.focus.length > 0 && (
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <Target className="h-4 w-4" />
                                    What to focus on
                                </CardTitle>
                                <CardDescription>Worked out from the numbers on this page.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ul className="grid gap-4 md:grid-cols-2">
                                    {data.focus.map((f) => (
                                        <li key={f.title}>
                                            <p className="text-sm font-medium">{f.title}</p>
                                            <p className="text-sm text-muted-foreground">{f.detail}</p>
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                            <div className="space-y-1">
                                <CardTitle className="text-base">Average call quality score over time</CardTitle>
                                <CardDescription>
                                    One point per {data.trend.bucket}. Scores before and after a criteria change are
                                    not directly comparable.
                                </CardDescription>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)}>
                                {showTable ? "Show chart" : "Show as table"}
                            </Button>
                        </CardHeader>
                        <CardContent className={showTable ? "p-0" : undefined}>
                            {showTable ? (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{data.trend.bucket === "week" ? "Week of" : "Day"}</TableHead>
                                            <TableHead className="text-right">Calls reviewed</TableHead>
                                            <TableHead className="text-right">Avg call score</TableHead>
                                            <TableHead className="text-right">Appointments set</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {data.trend.points.map((p) => (
                                            <TableRow key={p.date}>
                                                <TableCell>{fmtDate(p.date)}</TableCell>
                                                <TableCell className="text-right tabular-nums">{p.calls_reviewed}</TableCell>
                                                <TableCell className="text-right tabular-nums">{p.average_score ?? "—"}</TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {p.appointment_rate.numerator} of {p.appointment_rate.denominator}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            ) : (
                                <ScoreTrend points={data.trend.points} bucket={data.trend.bucket} changes={data.rubric_changes} />
                            )}
                        </CardContent>
                    </Card>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Most common mistakes</CardTitle>
                                <CardDescription>
                                    Criteria most often scored below {data.thresholds.low}, out of the calls where
                                    they applied.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ShareBars
                                    rows={criteriaRows(data.common_mistakes, "low_count")}
                                    emptyText={`No criterion scored below ${data.thresholds.low} in this period.`}
                                />
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Most successful behaviours</CardTitle>
                                <CardDescription>
                                    Criteria most often scored {data.thresholds.high} or above.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ShareBars
                                    rows={criteriaRows(data.successful_behaviors, "high_count")}
                                    emptyText={`No criterion scored ${data.thresholds.high} or above in this period.`}
                                />
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Most common customer objections</CardTitle>
                            <CardDescription>
                                Share of reviewed calls where the customer raised each concern. Objections a manager
                                marked as not accurate are left out.
                                {data.missed_opportunities.calls > 0 &&
                                    ` Separately, ${data.missed_opportunities.calls} calls had a missed chance to ask for the visit.`}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ShareBars
                                rows={data.objections.map((o) => ({
                                    key: o.category,
                                    label: o.label,
                                    count: o.calls,
                                    total: s.calls_reviewed,
                                    note: `Left unresolved on ${o.unresolved} of those ${o.calls}`,
                                }))}
                                emptyText="No objections recorded in this period."
                            />
                        </CardContent>
                    </Card>

                    {data.hidden_objections.calls_with_guess > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Suspected hidden objections (AI&apos;s guess)</CardTitle>
                                <CardDescription>
                                    What the AI thinks customers were really worried about but did not say. These
                                    are guesses, not facts, and are counted separately from stated objections.
                                    Guesses a manager marked wrong are left out.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ShareBars
                                    rows={data.hidden_objections.items.map((h) => ({
                                        key: h.category,
                                        label: h.label,
                                        count: h.calls,
                                        total: s.calls_reviewed,
                                        note: `${h.medium_or_high} with medium or high confidence · said out loud on ${h.stated_too}`,
                                    }))}
                                    emptyText="No guesses in this period."
                                />
                            </CardContent>
                        </Card>
                    )}

                    <GroupTable
                        title="By representative"
                        description="Call quality (AI) and appointments set (CRM) side by side. Small call counts make both numbers unreliable."
                        rows={data.by_rep}
                    />
                    {data.by_dealership.length > 1 && (
                        <GroupTable
                            title="By dealership"
                            description="Same measures, grouped by dealership."
                            rows={data.by_dealership}
                        />
                    )}
                </div>
            )}
        </div>
    )
}
