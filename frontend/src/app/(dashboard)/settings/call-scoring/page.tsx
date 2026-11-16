"use client"

import * as React from "react"
import Link from "next/link"
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle, FlaskConical, Loader2, Plus, Trash2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { formatCallTime, scoreTone } from "@/lib/call-review-utils"
import {
    CallReviewListItem,
    CallReviewService,
    Rubric,
    RubricCriterion,
    RubricState,
    RubricTestResult,
    apiErrorMessage,
} from "@/services/call-review-service"

const MAX_CRITERIA = 12
const MAX_TEST_CALLS = 5

interface FormState {
    name: string
    criteria: RubricCriterion[]
    guidance: string
    changeNote: string
}

function toForm(rubric: Rubric | null): FormState {
    return {
        name: rubric?.name ?? "Call scoring rubric",
        criteria: (rubric?.criteria ?? []).map((c) => ({ ...c })),
        guidance: rubric?.guidance ?? "",
        // A change note describes one edit; never carry over the published version's note
        changeNote: rubric?.status === "draft" ? rubric.change_note ?? "" : "",
    }
}

function fmtScore(score: number | null | undefined): string {
    return score == null ? "—" : String(Math.round(score))
}

export default function CallScoringSettingsPage() {
    const [state, setState] = React.useState<RubricState | null>(null)
    const [form, setForm] = React.useState<FormState>(toForm(null))
    const [versions, setVersions] = React.useState<Rubric[]>([])
    const [sampleCalls, setSampleCalls] = React.useState<CallReviewListItem[]>([])
    const [selectedCalls, setSelectedCalls] = React.useState<string[]>([])
    const [testResults, setTestResults] = React.useState<RubricTestResult[] | null>(null)

    const [isLoading, setIsLoading] = React.useState(true)
    const [busy, setBusy] = React.useState<null | "save" | "publish" | "discard" | "test">(null)
    const [dirty, setDirty] = React.useState(false)
    const [confirmPublish, setConfirmPublish] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [notice, setNotice] = React.useState<string | null>(null)

    const load = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const rubric = await CallReviewService.getRubric()
            setState(rubric)
            setForm(toForm(rubric.draft ?? rubric.active))
            setDirty(false)
            if (rubric.can_edit) {
                const [history, reviews] = await Promise.all([
                    CallReviewService.listRubricVersions(),
                    CallReviewService.list({ status: "completed", page_size: 10 }),
                ])
                setVersions(history)
                setSampleCalls(reviews.items.filter((r) => r.has_transcript))
            }
            setError(null)
        } catch (err) {
            setError(apiErrorMessage(err, "Could not load the scoring criteria."))
        } finally {
            setIsLoading(false)
        }
    }, [])

    React.useEffect(() => {
        load()
    }, [load])

    const totalWeight = form.criteria.reduce((sum, c) => sum + (Number(c.weight) || 0), 0)
    const weightsOk = Math.abs(totalWeight - 100) < 0.01
    const namesOk = form.criteria.every((c) => c.name.trim() !== "")
    const formOk = form.criteria.length > 0 && weightsOk && namesOk
    const hasDraft = !!state?.draft
    const canEdit = !!state?.can_edit

    const edit = (patch: Partial<FormState>) => {
        setForm((f) => ({ ...f, ...patch }))
        setDirty(true)
        setNotice(null)
    }

    const editCriterion = (index: number, patch: Partial<RubricCriterion>) =>
        edit({ criteria: form.criteria.map((c, i) => (i === index ? { ...c, ...patch } : c)) })

    const moveCriterion = (index: number, delta: number) => {
        const target = index + delta
        if (target < 0 || target >= form.criteria.length) return
        const next = [...form.criteria]
        ;[next[index], next[target]] = [next[target], next[index]]
        edit({ criteria: next })
    }

    const addCriterion = () =>
        edit({
            criteria: [
                ...form.criteria,
                { name: "", weight: 0, what_good_looks_like: "", what_bad_looks_like: "" },
            ],
        })

    const payload = () => ({
        name: form.name,
        criteria: form.criteria.map((c) => ({ ...c, weight: Number(c.weight) || 0 })),
        guidance: form.guidance.trim() || null,
        change_note: form.changeNote.trim() || null,
    })

    const run = async (kind: "save" | "publish" | "discard" | "test", action: () => Promise<void>) => {
        setBusy(kind)
        setError(null)
        setNotice(null)
        try {
            await action()
        } catch (err) {
            setError(apiErrorMessage(err, "Something went wrong. Your changes were not applied."))
        } finally {
            setBusy(null)
        }
    }

    const handleSave = () =>
        run("save", async () => {
            await CallReviewService.saveDraft(payload())
            await load()
            setNotice("Draft saved. Calls are still scored with the published version until you publish.")
        })

    const handlePublish = () =>
        run("publish", async () => {
            await CallReviewService.saveDraft(payload())
            const published = await CallReviewService.publishDraft()
            setTestResults(null)
            await load()
            setNotice(`Version ${published.version} is now live. New call reviews will use it.`)
        })

    const handleDiscard = () =>
        run("discard", async () => {
            await CallReviewService.discardDraft()
            setTestResults(null)
            await load()
            setNotice("Draft discarded.")
        })

    const handleTest = () =>
        run("test", async () => {
            setTestResults(await CallReviewService.testRubric(selectedCalls, payload()))
        })

    const toggleCall = (id: string) =>
        setSelectedCalls((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < MAX_TEST_CALLS ? [...prev, id] : prev
        )

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight">Call Scoring</h1>
                    <p className="max-w-2xl text-sm text-muted-foreground">
                        Decide what the AI looks for when it reviews a call and how much each thing counts. Write the
                        descriptions the way you would explain them to a new rep. The AI reads them word for word.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {state?.active && <Badge variant="secondary">Live: version {state.active.version}</Badge>}
                    {(hasDraft || dirty) && <Badge variant="outline">Unpublished changes</Badge>}
                </div>
            </div>

            {error && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
            {notice && (
                <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>{notice}</AlertDescription>
                </Alert>
            )}
            {!canEdit && (
                <Alert>
                    <AlertDescription>
                        You can see how calls are scored. Only managers can change the criteria.
                    </AlertDescription>
                </Alert>
            )}

            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-base">Criteria</CardTitle>
                            <CardDescription>Weights are percentages of the overall score.</CardDescription>
                        </div>
                        <div
                            className={cn(
                                "rounded-md border px-3 py-1.5 text-sm font-medium tabular-nums",
                                weightsOk
                                    ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                                    : "border-destructive/50 text-destructive"
                            )}
                            aria-live="polite"
                        >
                            Total: {Number(totalWeight.toFixed(2))}%
                            {!weightsOk &&
                                (totalWeight < 100
                                    ? ` · add ${Number((100 - totalWeight).toFixed(2))}`
                                    : ` · remove ${Number((totalWeight - 100).toFixed(2))}`)}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    {form.criteria.map((c, i) => (
                        <div key={c.key ?? `new-${i}`} className="space-y-3 rounded-lg border p-4">
                            <div className="flex flex-wrap items-end gap-3">
                                <div className="min-w-[200px] flex-1 space-y-1.5">
                                    <Label htmlFor={`name-${i}`}>What to judge</Label>
                                    <Input
                                        id={`name-${i}`}
                                        value={c.name}
                                        maxLength={100}
                                        disabled={!canEdit}
                                        placeholder="e.g. Asking for the appointment"
                                        onChange={(e) => editCriterion(i, { name: e.target.value })}
                                    />
                                </div>
                                <div className="w-28 space-y-1.5">
                                    <Label htmlFor={`weight-${i}`}>Weight %</Label>
                                    <Input
                                        id={`weight-${i}`}
                                        type="number"
                                        min={1}
                                        max={100}
                                        value={Number.isNaN(c.weight) ? "" : c.weight}
                                        disabled={!canEdit}
                                        onChange={(e) =>
                                            editCriterion(i, { weight: e.target.value === "" ? NaN : Number(e.target.value) })
                                        }
                                    />
                                </div>
                                {canEdit && (
                                    <div className="flex gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={`Move ${c.name || "criterion"} up`}
                                            disabled={i === 0}
                                            onClick={() => moveCriterion(i, -1)}
                                        >
                                            <ArrowUp className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={`Move ${c.name || "criterion"} down`}
                                            disabled={i === form.criteria.length - 1}
                                            onClick={() => moveCriterion(i, 1)}
                                        >
                                            <ArrowDown className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={`Remove ${c.name || "criterion"}`}
                                            disabled={form.criteria.length <= 1}
                                            onClick={() => edit({ criteria: form.criteria.filter((_, x) => x !== i) })}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label htmlFor={`good-${i}`}>What good looks like</Label>
                                    <Textarea
                                        id={`good-${i}`}
                                        rows={3}
                                        maxLength={1000}
                                        value={c.what_good_looks_like}
                                        disabled={!canEdit}
                                        placeholder="e.g. Offers two specific times instead of asking “when works for you?”"
                                        onChange={(e) => editCriterion(i, { what_good_looks_like: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor={`bad-${i}`}>Common mistakes (optional)</Label>
                                    <Textarea
                                        id={`bad-${i}`}
                                        rows={3}
                                        maxLength={1000}
                                        value={c.what_bad_looks_like}
                                        disabled={!canEdit}
                                        placeholder="e.g. Ends the call without asking for a visit"
                                        onChange={(e) => editCriterion(i, { what_bad_looks_like: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                    {canEdit && (
                        <Button variant="outline" onClick={addCriterion} disabled={form.criteria.length >= MAX_CRITERIA}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add criterion
                        </Button>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Guidance for every call</CardTitle>
                    <CardDescription>
                        House rules the AI should always keep in mind, such as “we never quote a price over the
                        phone” or “a callback counts as a next step only if a day and time are agreed”.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Textarea
                        rows={4}
                        maxLength={4000}
                        value={form.guidance}
                        disabled={!canEdit}
                        aria-label="Guidance for every call"
                        onChange={(e) => edit({ guidance: e.target.value })}
                    />
                </CardContent>
            </Card>

            {canEdit && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <FlaskConical className="h-4 w-4" />
                            Try it before you publish
                        </CardTitle>
                        <CardDescription>
                            Score up to {MAX_TEST_CALLS} already-reviewed calls with the criteria above and compare
                            with their current scores. Nothing is saved.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {sampleCalls.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                No reviewed calls yet. Once a call has been reviewed on the{" "}
                                <Link href="/call-reviews" className="underline">
                                    Call Reviews
                                </Link>{" "}
                                page you can test changes against it here.
                            </p>
                        ) : (
                            <>
                                <div className="grid gap-2 md:grid-cols-2">
                                    {sampleCalls.map((call) => {
                                        const checked = selectedCalls.includes(call.id)
                                        return (
                                            <label
                                                key={call.id}
                                                className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
                                            >
                                                <Checkbox
                                                    checked={checked}
                                                    disabled={!checked && selectedCalls.length >= MAX_TEST_CALLS}
                                                    onCheckedChange={() => toggleCall(call.id)}
                                                />
                                                <span className="flex-1 truncate">
                                                    {call.customer_name ?? "Unknown caller"}
                                                    <span className="text-muted-foreground">
                                                        {" "}
                                                        · {call.rep?.name ?? "—"} · {formatCallTime(call.call?.started_at)}
                                                    </span>
                                                </span>
                                                <span className={cn("font-semibold tabular-nums", scoreTone(call.overall_score))}>
                                                    {fmtScore(call.overall_score)}
                                                </span>
                                            </label>
                                        )
                                    })}
                                </div>
                                <Button
                                    variant="outline"
                                    onClick={handleTest}
                                    disabled={!formOk || selectedCalls.length === 0 || busy !== null}
                                >
                                    {busy === "test" ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <FlaskConical className="mr-2 h-4 w-4" />
                                    )}
                                    {busy === "test"
                                        ? "Scoring… this can take a minute"
                                        : `Try on ${selectedCalls.length || ""} selected ${selectedCalls.length === 1 ? "call" : "calls"}`}
                                </Button>
                            </>
                        )}

                        {testResults && (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Call</TableHead>
                                        <TableHead className="text-right">Current score</TableHead>
                                        <TableHead className="text-right">With these criteria</TableHead>
                                        <TableHead className="text-right">Change</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {testResults.map((r) => {
                                        const call = sampleCalls.find((c) => c.id === r.review_id)
                                        const before = r.current?.overall_score
                                        const after = r.draft?.overall_score
                                        // Difference of the rounded scores, so it always matches the two numbers shown
                                        const delta =
                                            before != null && after != null ? Math.round(after) - Math.round(before) : null
                                        return (
                                            <TableRow key={r.review_id}>
                                                <TableCell>
                                                    <Link href={`/call-reviews/${r.review_id}`} className="hover:underline">
                                                        {call?.customer_name ?? "Call"} · {formatCallTime(r.call_started_at)}
                                                    </Link>
                                                    {r.error && <p className="text-sm text-destructive">{r.error}</p>}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {fmtScore(before)}
                                                    {r.current?.rubric_version != null && (
                                                        <span className="text-muted-foreground"> (v{r.current.rubric_version})</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className={cn("text-right font-semibold tabular-nums", scoreTone(after))}>
                                                    {fmtScore(after)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {delta == null ? "—" : delta > 0 ? `+${delta}` : String(delta)}
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            )}

            {canEdit && (
                <Card>
                    <CardContent className="space-y-4 p-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="change-note">What changed? (optional, shown in the history)</Label>
                            <Input
                                id="change-note"
                                maxLength={500}
                                value={form.changeNote}
                                placeholder="e.g. More weight on asking for the appointment"
                                onChange={(e) => edit({ changeNote: e.target.value })}
                            />
                        </div>
                        {!formOk && (
                            <p className="text-sm text-destructive">
                                {form.criteria.length === 0
                                    ? "Add at least one criterion."
                                    : !namesOk
                                      ? "Every criterion needs a name."
                                      : `Weights must add up to 100% (currently ${Number(totalWeight.toFixed(2))}%).`}
                            </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                            <Button onClick={() => setConfirmPublish(true)} disabled={!formOk || busy !== null || (!dirty && !hasDraft)}>
                                {busy === "publish" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Publish as version {(versions[0]?.version ?? state?.active?.version ?? 0) + 1}
                            </Button>
                            <Button variant="outline" onClick={handleSave} disabled={!formOk || busy !== null || !dirty}>
                                {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save draft
                            </Button>
                            {(hasDraft || dirty) && (
                                <Button
                                    variant="ghost"
                                    onClick={hasDraft ? handleDiscard : load}
                                    disabled={busy !== null}
                                >
                                    Discard changes
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {canEdit && versions.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Version history</CardTitle>
                        <CardDescription>
                            Every review records the version it was scored with, so scores are only compared like
                            for like.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Version</TableHead>
                                    <TableHead>Published</TableHead>
                                    <TableHead>What changed</TableHead>
                                    <TableHead className="text-right">Calls scored</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {versions.map((v) => (
                                    <TableRow key={v.id}>
                                        <TableCell className="font-medium">
                                            v{v.version}{" "}
                                            {v.status === "active" && <Badge variant="secondary">Live</Badge>}
                                        </TableCell>
                                        <TableCell>{formatCallTime(v.published_at, true)}</TableCell>
                                        <TableCell className="text-muted-foreground">{v.change_note ?? "—"}</TableCell>
                                        <TableCell className="text-right tabular-nums">{v.calls_scored ?? 0}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Publish these scoring criteria?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Calls reviewed from now on will be scored with the new version. Calls already reviewed
                            keep their existing scores unless you re-score them individually.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep editing</AlertDialogCancel>
                        <AlertDialogAction onClick={handlePublish}>Publish</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
