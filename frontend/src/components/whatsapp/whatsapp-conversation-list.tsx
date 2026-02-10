"use client";

import { useMemo } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { MessageCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { WhatsAppConversationListItem } from "@/services/whatsapp-service";

// WhatsApp Desktop colors
const WA_BORDER = "#e9edef";
const WA_TEXT_PRIMARY = "#111b21";
const WA_TEXT_SECONDARY = "#667781";
const WA_GREEN = "#00a884";
const WA_EMPTY_ICON = "#8696a0";

interface WhatsAppConversationListProps {
  conversations: WhatsAppConversationListItem[];
  selectedLeadId?: string;
  onSelect: (leadId: string) => void;
  searchQuery?: string;
}

export function WhatsAppConversationList({
  conversations,
  selectedLeadId,
  onSelect,
  searchQuery = "",
}: WhatsAppConversationListProps) {
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) return format(date, "h:mm a");
    if (isYesterday(date)) return "Yesterday";
    return format(date, "MMM d");
  };

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase().trim();
    return conversations.filter(
      (c) =>
        c.lead_name?.toLowerCase().includes(q) ||
        c.lead_phone?.toLowerCase().includes(q) ||
        c.lead_phone?.replace(/\D/g, "").includes(q.replace(/\D/g, ""))
    );
  }, [conversations, searchQuery]);

  if (conversations.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-[200px] text-center p-6"
        style={{ color: WA_EMPTY_ICON }}
      >
        <MessageCircle className="h-16 w-16 mb-4 opacity-60" />
        <p className="text-sm font-medium" style={{ color: WA_TEXT_SECONDARY }}>
          No WhatsApp chats yet
        </p>
      </div>
    );
  }

  if (filteredConversations.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-[200px] text-center p-6"
        style={{ color: WA_EMPTY_ICON }}
      >
        <MessageCircle className="h-14 w-14 mb-3 opacity-60" />
        <p className="text-sm" style={{ color: WA_TEXT_SECONDARY }}>
          No chats match &quot;{searchQuery}&quot;
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {filteredConversations.map((conv) => (
        <button
          key={conv.lead_id}
          onClick={() => onSelect(conv.lead_id)}
          className={cn(
            "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-b",
            selectedLeadId === conv.lead_id
              ? "bg-[#f0f2f5]"
              : "bg-white hover:bg-[#f5f6f6]"
          )}
          style={{ borderBottomColor: WA_BORDER }}
        >
          <div
            className="h-12 w-12 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${WA_GREEN}20` }}
          >
            <User className="h-6 w-6" style={{ color: WA_GREEN }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium truncate text-[15px]" style={{ color: WA_TEXT_PRIMARY }}>
                {conv.lead_name}
              </span>
              <span className="text-xs shrink-0" style={{ color: WA_TEXT_SECONDARY }}>
                {formatTime(conv.last_message.created_at)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 mt-0.5">
              <p
                className="text-sm truncate flex-1 min-w-0"
                style={{ color: WA_TEXT_SECONDARY }}
              >
                {conv.last_message.direction === "outbound" && (
                  <span style={{ color: WA_TEXT_SECONDARY }}>You: </span>
                )}
                {conv.last_message.body}
              </p>
              {conv.unread_count > 0 && (
                <span
                  className="shrink-0 h-5 min-w-[20px] rounded-full flex items-center justify-center text-xs font-medium text-white px-1.5"
                  style={{ backgroundColor: WA_GREEN }}
                >
                  {conv.unread_count}
                </span>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
