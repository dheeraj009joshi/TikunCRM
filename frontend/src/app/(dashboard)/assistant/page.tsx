"use client"

import * as React from "react"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Bot,
  ChevronDown,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  AiAssistantService,
  AiConversationBrief,
  AiMessage,
  AiUiBlock,
  buildLeadsUrlFromFilters,
} from "@/services/ai-assistant-service"

type LiveTool = {
  name: string
  label: string
  args?: Record<string, unknown>
  summary?: string
  status: "running" | "done"
}

type LiveAssistant = {
  thinking: string
  thinkingDone: boolean
  thinkingMs?: number
  tools: LiveTool[]
  content: string
  uiBlocks: AiUiBlock[]
}

const SUGGESTIONS = [
  "Leads with SSN, DL, and about 2000–3000 down",
  "Who should I call first this morning?",
  "Which of my leads have a driver license stip?",
]

function ThinkingBlock({
  text,
  done,
  durationMs,
  streaming,
}: {
  text: string
  done: boolean
  durationMs?: number
  streaming?: boolean
}) {
  const [open, setOpen] = React.useState(!done)
  React.useEffect(() => {
    if (done) setOpen(false)
  }, [done])

  return (
    <div className="mb-3 rounded-lg border bg-muted/40 text-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles className={cn("h-3.5 w-3.5", streaming && "animate-pulse")} />
        <span className="font-medium">
          {done
            ? `Thought for ${Math.max(1, Math.round((durationMs || 0) / 1000))}s`
            : "Thinking…"}
        </span>
        <ChevronDown
          className={cn("ml-auto h-4 w-4 transition", open && "rotate-180")}
        />
      </button>
      {open && text && (
        <div className="border-t px-3 py-2 text-muted-foreground whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  )
}

function ToolChips({ tools }: { tools: LiveTool[] }) {
  if (!tools.length) return null
  return (
    <div className="mb-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Working</p>
      <div className="flex flex-wrap gap-2">
        {tools.map((t, i) => (
          <span
            key={`${t.name}-${i}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
              t.status === "done"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"
            )}
          >
            {t.status === "running" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Wrench className="h-3 w-3" />
            )}
            {t.status === "done"
              ? `${t.name} · ${t.summary || "done"}`
              : t.label || t.name}
          </span>
        ))}
      </div>
    </div>
  )
}

function LeadTableBlock({
  block,
  ranked,
}: {
  block: AiUiBlock
  ranked?: boolean
}) {
  const leads = block.leads || []
  const href = buildLeadsUrlFromFilters(block.filter_params)
  return (
    <div className="mt-3 overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2 text-xs">
        <span className="font-medium">
          {ranked ? "Call priority" : null}
          {!ranked && (
            <>
              {block.total ?? leads.length} lead
              {(block.total ?? leads.length) === 1 ? "" : "s"} matched
            </>
          )}
          {ranked && (
            <>
              {" "}
              · top {leads.length}
            </>
          )}
        </span>
        <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
          <Link href={href}>Open in Leads</Link>
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              {ranked && <th className="px-3 py-2 font-medium">#</th>}
              <th className="px-3 py-2 font-medium">Lead</th>
              <th className="px-3 py-2 font-medium">Down</th>
              <th className="px-3 py-2 font-medium">Stips</th>
              <th className="px-3 py-2 font-medium">
                {ranked ? "Why" : "Stage"}
              </th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                {ranked && (
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {l.rank ?? "—"}
                  </td>
                )}
                <td className="px-3 py-2">
                  <Link
                    href={`/leads/${l.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {l.name}
                  </Link>
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {l.down_payment != null
                    ? `$${Number(l.down_payment).toLocaleString()}`
                    : "—"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {[
                    l.has_ssn_stip ? "SSN" : null,
                    l.has_dl_stip ? "DL" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {ranked
                    ? (l.reasons || []).slice(0, 2).join("; ") || "—"
                    : l.stage || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ConfirmActionsBlock({
  block,
  conversationId,
  disabled,
  onDone,
}: {
  block: AiUiBlock
  conversationId: string | null
  disabled?: boolean
  onDone: (note: string) => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [dismissed, setDismissed] = React.useState(false)
  const [status, setStatus] = React.useState<"pending" | "done" | "cancelled">(
    "pending"
  )

  if (dismissed || status === "cancelled") {
    return (
      <div className="mt-3 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
        Actions cancelled
      </div>
    )
  }
  if (status === "done") {
    return (
      <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
        Actions confirmed and applied
      </div>
    )
  }

  const actions = block.actions || []

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:text-amber-100">
          Needs confirmation
        </span>
        <span className="text-sm font-semibold">
          {block.title || `Confirm ${actions.length} action(s)`}
        </span>
      </div>
      <ul className="space-y-1 text-sm">
        {actions.map((a, i) => (
          <li key={i} className="text-muted-foreground">
            {i + 1}. {a.summary || a.tool}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || disabled}
          onClick={async () => {
            setBusy(true)
            try {
              const res = await AiAssistantService.confirmActions(
                conversationId,
                actions.map((a) => ({
                  tool: a.tool,
                  args: a.args,
                  summary: a.summary,
                }))
              )
              setStatus("done")
              onDone(res.message || "Actions applied.")
            } catch (e) {
              onDone((e as Error).message || "Confirm failed")
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
          Confirm
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || disabled}
          onClick={() => {
            setStatus("cancelled")
            setDismissed(true)
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

function UiBlocks({
  blocks,
  conversationId,
  streaming,
  onConfirmDone,
}: {
  blocks?: AiUiBlock[]
  conversationId: string | null
  streaming?: boolean
  onConfirmDone?: (note: string) => void
}) {
  if (!blocks?.length) return null
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "lead_table") {
          return <LeadTableBlock key={i} block={b} />
        }
        if (b.type === "ranked_leads") {
          return <LeadTableBlock key={i} block={b} ranked />
        }
        if (b.type === "confirm_actions") {
          return (
            <ConfirmActionsBlock
              key={i}
              block={b}
              conversationId={conversationId}
              disabled={streaming}
              onDone={(note) => onConfirmDone?.(note)}
            />
          )
        }
        return null
      })}
    </>
  )
}

function AssistantBubble({
  content,
  thinking,
  thinkingDone,
  thinkingMs,
  tools,
  uiBlocks,
  streaming,
  conversationId,
  onConfirmDone,
}: {
  content: string
  thinking?: string
  thinkingDone?: boolean
  thinkingMs?: number
  tools?: LiveTool[]
  uiBlocks?: AiUiBlock[]
  streaming?: boolean
  conversationId: string | null
  onConfirmDone?: (note: string) => void
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Bot className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 rounded-2xl border bg-card px-4 py-3 shadow-sm">
        {(thinking || streaming) && (
          <ThinkingBlock
            text={thinking || ""}
            done={!!thinkingDone}
            durationMs={thinkingMs}
            streaming={streaming && !thinkingDone}
          />
        )}
        {tools && tools.length > 0 && <ToolChips tools={tools} />}
        {content ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {content}
            {streaming && (
              <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-foreground/70 align-middle" />
            )}
          </div>
        ) : (
          streaming && (
            <p className="text-sm text-muted-foreground">Working…</p>
          )
        )}
        <UiBlocks
          blocks={uiBlocks}
          conversationId={conversationId}
          streaming={streaming}
          onConfirmDone={onConfirmDone}
        />
      </div>
    </div>
  )
}

export default function AssistantPage() {
  const queryClient = useQueryClient()
  const [conversationId, setConversationId] = React.useState<string | null>(null)
  const [input, setInput] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [messages, setMessages] = React.useState<AiMessage[]>([])
  const [live, setLive] = React.useState<LiveAssistant | null>(null)
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  const statusQuery = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => AiAssistantService.status(),
  })

  const convQuery = useQuery({
    queryKey: ["ai-conversations"],
    queryFn: () => AiAssistantService.listConversations(),
  })

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, live])

  const loadConversation = async (id: string) => {
    setError(null)
    setLive(null)
    setConversationId(id)
    const data = await AiAssistantService.getConversation(id)
    setMessages(data.messages || [])
  }

  const startNew = () => {
    abortRef.current?.abort()
    setConversationId(null)
    setMessages([])
    setLive(null)
    setError(null)
    setInput("")
  }

  const send = async (text?: string) => {
    const message = (text ?? input).trim()
    if (!message || sending) return
    if (!statusQuery.data?.enabled) {
      setError("Tikun AI is not configured. Set OPENAI_API_KEY on the backend.")
      return
    }

    setSending(true)
    setError(null)
    setInput("")
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: message,
        created_at: new Date().toISOString(),
      },
    ])
    setLive({
      thinking: "",
      thinkingDone: false,
      tools: [],
      content: "",
      uiBlocks: [],
    })

    const ac = new AbortController()
    abortRef.current = ac

    try {
      await AiAssistantService.streamChat(
        message,
        conversationId,
        {
          onConversation: (c) => {
            setConversationId(c.id)
            queryClient.invalidateQueries({ queryKey: ["ai-conversations"] })
          },
          onThinkingStart: () => {
            setLive((prev) =>
              prev
                ? { ...prev, thinking: "", thinkingDone: false }
                : prev
            )
          },
          onThinkingDelta: (t) => {
            setLive((prev) =>
              prev ? { ...prev, thinking: prev.thinking + t } : prev
            )
          },
          onThinkingDone: (d) => {
            setLive((prev) =>
              prev
                ? {
                    ...prev,
                    thinking: d.text || prev.thinking,
                    thinkingDone: true,
                    thinkingMs: d.duration_ms,
                  }
                : prev
            )
          },
          onToolStart: (d) => {
            setLive((prev) =>
              prev
                ? {
                    ...prev,
                    tools: [
                      ...prev.tools,
                      {
                        name: d.name,
                        label: d.label,
                        args: d.args,
                        status: "running",
                      },
                    ],
                  }
                : prev
            )
          },
          onToolResult: (d) => {
            setLive((prev) => {
              if (!prev) return prev
              const tools = [...prev.tools]
              for (let i = tools.length - 1; i >= 0; i--) {
                if (tools[i].name === d.name && tools[i].status === "running") {
                  tools[i] = {
                    ...tools[i],
                    status: "done",
                    summary: d.summary,
                  }
                  break
                }
              }
              return { ...prev, tools }
            })
          },
          onMessageDelta: (t) => {
            setLive((prev) =>
              prev ? { ...prev, content: prev.content + t } : prev
            )
          },
          onUiBlock: (block) => {
            setLive((prev) =>
              prev ? { ...prev, uiBlocks: [...prev.uiBlocks, block] } : prev
            )
          },
          onDone: (data) => {
            setLive((current) => {
              if (!current) return null
              const finalMsg: AiMessage = {
                id: String(data.message_id || `asst-${Date.now()}`),
                role: "assistant",
                content: current.content,
                thinking: current.thinking,
                tool_traces: current.tools.map((t) => ({
                  name: t.name,
                  args: t.args,
                  result_summary: t.summary,
                })),
                ui_blocks: current.uiBlocks,
                created_at: new Date().toISOString(),
              }
              setMessages((prev) => [...prev, finalMsg])
              return null
            })
            queryClient.invalidateQueries({ queryKey: ["ai-conversations"] })
          },
          onError: (msg) => setError(msg),
        },
        ac.signal
      )
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message || "Stream failed")
      }
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }

  const deleteConv = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await AiAssistantService.deleteConversation(id)
    if (conversationId === id) startNew()
    queryClient.invalidateQueries({ queryKey: ["ai-conversations"] })
  }

  const conversations: AiConversationBrief[] = convQuery.data || []

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[480px] overflow-hidden rounded-xl border bg-background">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/20 md:flex">
        <div className="p-3">
          <Button className="w-full justify-start gap-2" onClick={startNew}>
            <Plus className="h-4 w-4" />
            New chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">
            Recent
          </p>
          <div className="space-y-0.5">
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => loadConversation(c.id)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted",
                  conversationId === c.id && "bg-muted"
                )}
              >
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <Trash2
                  className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-70"
                  onClick={(e) => deleteConv(c.id, e)}
                />
              </button>
            ))}
            {!conversations.length && (
              <p className="px-2 text-xs text-muted-foreground">No chats yet</p>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <Bot className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-sm font-semibold">Tikun AI</h1>
            <p className="text-xs text-muted-foreground">
              ChatGPT-style assistant · uses your CRM permissions
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto md:hidden"
            onClick={startNew}
          >
            New
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            {!messages.length && !live && (
              <div className="py-12 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Sparkles className="h-6 w-6" />
                </div>
                <h2 className="text-lg font-semibold">How can I help?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ask in plain English — I&apos;ll search leads and show my
                  thinking.
                </p>
                <div className="mt-6 flex flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-xl border px-4 py-3 text-left text-sm hover:bg-muted/50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-sm text-primary-foreground">
                    {m.content}
                  </div>
                </div>
              ) : (
                <AssistantBubble
                  key={m.id}
                  content={m.content}
                  thinking={m.thinking || undefined}
                  thinkingDone
                  thinkingMs={4000}
                  tools={(m.tool_traces || []).map((t) => ({
                    name: t.name,
                    label: t.name,
                    args: t.args,
                    summary: t.result_summary,
                    status: "done" as const,
                  }))}
                  uiBlocks={m.ui_blocks}
                  conversationId={conversationId}
                  onConfirmDone={(note) => {
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: `confirm-${Date.now()}`,
                        role: "assistant",
                        content: note,
                        created_at: new Date().toISOString(),
                      },
                    ])
                  }}
                />
              )
            )}

            {live && (
              <AssistantBubble
                content={live.content}
                thinking={live.thinking}
                thinkingDone={live.thinkingDone}
                thinkingMs={live.thinkingMs}
                tools={live.tools}
                uiBlocks={live.uiBlocks}
                streaming
                conversationId={conversationId}
              />
            )}

            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t p-4">
          <div className="mx-auto flex max-w-3xl gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message Tikun AI…"
              className="min-h-[52px] max-h-40 resize-none"
              disabled={sending}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <Button
              size="icon"
              className="h-[52px] w-[52px] shrink-0"
              disabled={sending || !input.trim()}
              onClick={() => send()}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground">
            Enter to send · Shift+Enter for newline · SSN/DL mean stips on file,
            not ID numbers
          </p>
        </div>
      </div>
    </div>
  )
}
