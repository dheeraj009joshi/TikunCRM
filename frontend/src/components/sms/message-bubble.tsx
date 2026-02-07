"use client";

import { format } from "date-fns";
import { Check, CheckCheck, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { SMSMessage } from "@/services/sms-service";

interface MessageBubbleProps {
  message: SMSMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.direction === "outbound";
  
  const getStatusIcon = () => {
    switch (message.status) {
      case "delivered":
        return <CheckCheck className="h-3 w-3 text-blue-500" />;
      case "sent":
        return <Check className="h-3 w-3 text-muted-foreground" />;
      case "queued":
      case "sending":
        return <Clock className="h-3 w-3 text-muted-foreground" />;
      case "failed":
      case "undelivered":
        return <AlertCircle className="h-3 w-3 text-destructive" />;
      default:
        return null;
    }
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
          "max-w-[75%] rounded-2xl px-4 py-2",
          isOutbound
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted rounded-bl-sm"
        )}
      >
        {/* Message body */}
        <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>
        
        {/* Timestamp and status */}
        <div
          className={cn(
            "flex items-center gap-1 mt-1 text-[10px]",
            isOutbound ? "text-primary-foreground/70 justify-end" : "text-muted-foreground"
          )}
        >
          <span>{format(new Date(message.created_at), "h:mm a")}</span>
          {isOutbound && getStatusIcon()}
        </div>
      </div>
    </div>
  );
}
