"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"

/** Lightweight markdown for Copilot replies (bold, lists, links). */
export function AiMessageContent({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  const blocks = React.useMemo(() => parseBlocks(content), [content])

  return (
    <div className={cn("space-y-2 text-sm leading-relaxed", className)}>
      {blocks.map((block, i) => {
        if (block.type === "paragraph") {
          return (
            <p key={i} className="whitespace-pre-wrap">
              {renderInline(block.text)}
            </p>
          )
        }
        if (block.type === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          )
        }
        return (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ol>
        )
      })}
    </div>
  )
}

type Block =
  | { type: "paragraph"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }

function parseBlocks(content: string): Block[] {
  const lines = content.split("\n")
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: { type: "ul" | "ol"; items: string[] } | null = null

  const flushParagraph = () => {
    const text = paragraph.join("\n").trim()
    if (text) blocks.push({ type: "paragraph", text })
    paragraph = []
  }

  const flushList = () => {
    if (list && list.items.length) blocks.push(list)
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const ul = /^[-*•]\s+(.+)/.exec(line.trim())
    const ol = /^\d+[.)]\s+(.+)/.exec(line.trim())

    if (ul) {
      flushParagraph()
      if (!list || list.type !== "ul") {
        flushList()
        list = { type: "ul", items: [] }
      }
      list.items.push(ul[1])
      continue
    }
    if (ol) {
      flushParagraph()
      if (!list || list.type !== "ol") {
        flushList()
        list = { type: "ol", items: [] }
      }
      list.items.push(ol[1])
      continue
    }

    flushList()
    if (line.trim() === "") {
      flushParagraph()
    } else {
      paragraph.push(line)
    }
  }

  flushList()
  flushParagraph()
  return blocks.length ? blocks : [{ type: "paragraph", text: content }]
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\[([^\]]+)\]\(([^)]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith("**")) {
      parts.push(
        <strong key={k++} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      )
    } else {
      const label = m[2]
      const href = m[3]
      const external = href.startsWith("http")
      parts.push(
        external ? (
          <a
            key={k++}
            href={href}
            className="text-primary underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            {label}
          </a>
        ) : (
          <Link
            key={k++}
            href={href}
            className="text-primary underline underline-offset-2"
          >
            {label}
          </Link>
        )
      )
    }
    last = m.index + token.length
  }

  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : [text]
}

/** Drop redundant numbered lead dumps when structured UI blocks are shown. */
export function compactAssistantText(
  content: string,
  uiBlocks?: Array<{ type?: string }>
): string {
  if (
    !uiBlocks?.some((b) =>
      ["lead_table", "ranked_leads", "note_hits"].includes(b.type || "")
    )
  ) {
    return content
  }

  const lines = content.split("\n")
  const out: string[] = []
  let hitLeadList = false

  for (const line of lines) {
    const t = line.trim()
    if (/^\d+[.)]\s+\*\*[^*]+\*\*/.test(t) || /^\d+[.)]\s+[A-Z]/.test(t)) {
      hitLeadList = true
      break
    }
    out.push(line)
  }

  const summary = out.join("\n").trim()
  if (hitLeadList && summary.length < 20) {
    return "I found matching leads — see the interactive results below."
  }
  if (hitLeadList) return summary
  return content
}
