"use client"

import * as React from "react"
import Link from "next/link"
import { AlertCircle, AlertTriangle, Loader2, MessageCircleQuestion } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CallQuestionAnswer, CallReviewService, apiErrorMessage } from "@/services/call-review-service"

const EXAMPLES = [
    "Which objection is left unresolved most often?",
    "Who is weakest at asking for the appointment?",
    "How does call quality compare with the previous period?",
]

function fmtDate(iso: string | null): string {
    if (!iso) return "Call"
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function Answer({ item }: { item: CallQuestionAnswer }) {
    return (
        <div className="space-y-3 rounded-md border p-4">
            <p className="text-sm font-medium">{item.question}</p>
            <p className="whitespace-pre-line text-sm leading-relaxed">{item.answer}</p>

            {item.unverified_figures.length > 0 && (
                <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                        {item.unverified_figures.length === 1 ? "This figure in the answer was" : "These figures in the answer were"}{" "}
                        not found in the CRM numbers: <strong>{item.unverified_figures.join(", ")}</strong>. Check
                        against the dashboard below before relying on {item.unverified_figures.length === 1 ? "it" : "them"}.
                    </AlertDescription>
                </Alert>
            )}

            {item.caveats.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {item.caveats.map((c, i) => (
                        <li key={i}>{c}</li>
                    ))}
                </ul>
            )}

            {item.supporting_calls.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Example calls:</span>
                    {item.supporting_calls.map((c) => (
                        <Link
                            key={c.review_id}
                            href={`/call-reviews/${c.review_id}`}
                            className="rounded-md border px-2 py-1 hover:bg-muted"
                        >
                            {fmtDate(c.date)} · {c.rep}
                            {c.score != null ? ` · ${c.score}` : ""}
                        </Link>
                    ))}
                </div>
            )}

            <p className="text-xs text-muted-foreground">
                {item.llm_model
                    ? `Written by AI from the last ${item.days ?? ""} days' figures (${item.calls_considered} reviewed calls). It can be wrong.`
                    : "No AI was used for this answer."}
            </p>
        </div>
    )
}

export function AskAboutCalls({ days }: { days: number }) {
    const [question, setQuestion] = React.useState("")
    const [items, setItems] = React.useState<CallQuestionAnswer[]>([])
    const [isAsking, setIsAsking] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    React.useEffect(() => {
        let cancelled = false
        CallReviewService.listQuestions(3)
            .then((list) => {
                if (!cancelled) setItems(list)
            })
            .catch(() => {
                // Earlier questions are a convenience; the box still works without them
            })
        return () => {
            cancelled = true
        }
    }, [])

    const ask = async (text: string) => {
        const q = text.trim()
        if (!q || isAsking) return
        setIsAsking(true)
        setError(null)
        try {
            const answer = await CallReviewService.ask(q, days)
            setItems((prev) => [answer, ...prev.filter((p) => p.id !== answer.id)].slice(0, 3))
            setQuestion("")
        } catch (err) {
            setError(apiErrorMessage(err, "Could not get an answer. Please try again."))
        } finally {
            setIsAsking(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <MessageCircleQuestion className="h-4 w-4" />
                    Ask about your calls
                </CardTitle>
                <CardDescription>
                    Answers are written by AI using only the figures on this page for the selected {days} days.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(e) => {
                        e.preventDefault()
                        void ask(question)
                    }}
                >
                    <Input
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        maxLength={500}
                        placeholder="Type a question about the team's calls"
                        aria-label="Question about your calls"
                        disabled={isAsking}
                        className="flex-1"
                    />
                    <Button type="submit" disabled={isAsking || question.trim().length < 5}>
                        {isAsking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isAsking ? "Working it out" : "Ask"}
                    </Button>
                </form>

                <div className="flex flex-wrap gap-2">
                    {EXAMPLES.map((ex) => (
                        <Button key={ex} type="button" size="sm" variant="outline" disabled={isAsking} onClick={() => void ask(ex)}>
                            {ex}
                        </Button>
                    ))}
                </div>

                {error && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                {items.map((item) => (
                    <Answer key={item.id} item={item} />
                ))}
            </CardContent>
        </Card>
    )
}
