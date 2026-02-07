"use client";

import { format, isToday, isYesterday } from "date-fns";
import { MessageSquare, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConversationListItem } from "@/services/sms-service";
import { Badge } from "@/components/ui/badge";

interface ConversationListProps {
  conversations: ConversationListItem[];
  selectedLeadId?: string;
  onSelect: (leadId: string) => void;
}

export function ConversationList({ conversations, selectedLeadId, onSelect }: ConversationListProps) {
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) {
      return format(date, "h:mm a");
    }
    if (isYesterday(date)) {
      return "Yesterday";
    }
    return format(date, "MMM d");
  };
  
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <MessageSquare className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">No conversations yet</p>
      </div>
    );
  }
  
  return (
    <div className="divide-y">
      {conversations.map((conversation) => (
        <button
          key={conversation.lead_id}
          onClick={() => onSelect(conversation.lead_id)}
          className={cn(
            "w-full flex items-start gap-3 p-4 text-left hover:bg-muted/50 transition-colors",
            selectedLeadId === conversation.lead_id && "bg-muted"
          )}
        >
          {/* Avatar */}
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="h-5 w-5 text-primary" />
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium truncate">{conversation.lead_name}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatTime(conversation.last_message.created_at)}
              </span>
            </div>
            
            <div className="flex items-center justify-between gap-2 mt-0.5">
              <p className="text-sm text-muted-foreground truncate">
                {conversation.last_message.direction === "outbound" && (
                  <span className="text-muted-foreground">You: </span>
                )}
                {conversation.last_message.body}
              </p>
              
              {conversation.unread_count > 0 && (
                <Badge variant="default" className="shrink-0 h-5 min-w-[20px] flex items-center justify-center">
                  {conversation.unread_count}
                </Badge>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
