"use client";

import { format } from "date-fns";
import { Check, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { WhatsAppMessage } from "@/services/whatsapp-service";

interface WhatsAppMessageBubbleProps {
  message: WhatsAppMessage;
}

/** WhatsApp-style bubble: green for sent, light gray for received; tail; timestamp + ticks */
function isTemplateLogBody(body: string | undefined): boolean {
  return Boolean(body?.trimStart().startsWith("[Template "));
}

export function WhatsAppMessageBubble({ message }: WhatsAppMessageBubbleProps) {
  const isOutbound = message.direction === "outbound";
  const isTemplateStub = isTemplateLogBody(message.body);

  const getTick = () => {
    if (message.status === "delivered" || message.status === "read") {
      return <CheckCheck className="h-3.5 w-3.5 text-blue-400" />;
    }
    if (message.status === "sent" || message.status === "queued" || message.status === "sending") {
      return <Check className="h-3.5 w-3.5 text-white/80" />;
    }
    return <Check className="h-3.5 w-3.5 text-white/80" />;
  };

  return (
    <div
      className={cn(
        "flex",
        isOutbound ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[75%] rounded-lg px-3 py-1.5 shadow-sm",
          "rounded-br-md" /* tail for sent */,
          isOutbound
            ? "bg-[#005c4b] text-white rounded-bl-lg rounded-br-[4px]"
            : "bg-[#202c33] text-[#e9edef] rounded-bl-[4px] rounded-br-lg"
        )}
      >
        {isTemplateStub ? (
          <div className="space-y-0.5">
            <p className="text-sm font-medium">WhatsApp template</p>
            <p
              className={cn(
                "text-[11px] leading-snug whitespace-pre-wrap break-all",
                isOutbound ? "text-white/65" : "text-[#8696a0]"
              )}
            >
              {message.body}
            </p>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>
        )}
        <div
          className={cn(
            "flex items-center gap-1.5 mt-0.5 justify-end",
            isOutbound ? "text-white/70" : "text-[#8696a0]"
          )}
        >
          <span className="text-[11px]">{format(new Date(message.created_at), "h:mm a")}</span>
          {isOutbound && getTick()}
        </div>
      </div>
    </div>
  );
}
