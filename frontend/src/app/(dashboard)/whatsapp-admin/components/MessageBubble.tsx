"use client";

import { Check, CheckCheck, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  body: string;
  direction: "inbound" | "outbound";
  status?: string;
  timestamp?: string;
  isRead?: boolean;
}

export function MessageBubble({
  body,
  direction,
  status,
  timestamp,
  isRead,
}: MessageBubbleProps) {
  const isOutbound = direction === "outbound";

  const getStatusIcon = () => {
    if (!isOutbound) return null;

    switch (status) {
      case "pending":
        return <Clock className="h-[14px] w-[14px] text-[#667781]" />;
      case "sent":
        return <Check className="h-[14px] w-[14px] text-[#667781]" />;
      case "delivered":
        return <CheckCheck className="h-[14px] w-[14px] text-[#667781]" />;
      case "read":
        return <CheckCheck className="h-[14px] w-[14px] text-[#53bdeb]" />;
      case "failed":
        return <XCircle className="h-[14px] w-[14px] text-red-500" />;
      default:
        return <Check className="h-[14px] w-[14px] text-[#667781]" />;
    }
  };

  const formatTime = (ts?: string) => {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  return (
    <div
      className={cn("flex mb-1", isOutbound ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "relative max-w-[75%] rounded-lg px-3 py-2 shadow-sm",
          isOutbound
            ? "bg-[#d9fdd3] dark:bg-[#005c4b] rounded-tr-none"
            : "bg-white dark:bg-[#202c33] rounded-tl-none"
        )}
      >
        {/* Message tail */}
        <div
          className={cn(
            "absolute top-0 w-3 h-3",
            isOutbound
              ? "right-0 -mr-2 border-t-8 border-l-8 border-t-[#d9fdd3] dark:border-t-[#005c4b] border-l-transparent"
              : "left-0 -ml-2 border-t-8 border-r-8 border-t-white dark:border-t-[#202c33] border-r-transparent"
          )}
        />

        {/* Message content */}
        <p className="text-sm whitespace-pre-wrap break-words pr-16">{body}</p>

        {/* Timestamp and status */}
        <div
          className={cn(
            "absolute bottom-1 right-2 flex items-center gap-1 text-[10px]",
            isOutbound
              ? "text-[#667781] dark:text-[#8696a0]"
              : "text-[#667781] dark:text-[#8696a0]"
          )}
        >
          <span>{formatTime(timestamp)}</span>
          {getStatusIcon()}
        </div>
      </div>
    </div>
  );
}
