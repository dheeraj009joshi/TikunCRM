"use client";

import { useMemo } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { MessageCircle, User, Image, Video, Mic, FileText, Check, CheckCheck, Clock, AlertCircle, FileStack } from "lucide-react";
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
  /**
   * When there are no existing chats but the parent is showing “Start new chat” search hits,
   * hide the large empty placeholder so the list area does not duplicate empty UI.
   */
  hideEmptyStateForNewChatSearch?: boolean;
}

export function WhatsAppConversationList({
  conversations,
  selectedLeadId,
  onSelect,
  searchQuery = "",
  hideEmptyStateForNewChatSearch = false,
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
    if (hideEmptyStateForNewChatSearch) {
      return null;
    }
    if (searchQuery.trim().length >= 2) {
      return (
        <div
          className="px-4 py-8 text-center text-sm max-w-sm mx-auto"
          style={{ color: WA_TEXT_SECONDARY }}
        >
          <p>No existing chats match this search.</p>
          <p className="mt-2 text-xs opacity-90">
            Try another name or number, or choose a lead under &quot;Start new chat&quot; when
            results appear.
          </p>
        </div>
      );
    }
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
                className="text-sm truncate flex-1 min-w-0 flex items-center gap-1"
                style={{ color: WA_TEXT_SECONDARY }}
              >
                {conv.last_message.direction === "outbound" && (
                  <>
                    {(() => {
                      const status = conv.last_message.status;
                      if (status === "failed" || status === "undelivered") {
                        return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />;
                      }
                      if (status === "sending" || status === "queued") {
                        return <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: WA_TEXT_SECONDARY }} />;
                      }
                      if (status === "read") {
                        return <CheckCheck className="h-3.5 w-3.5 shrink-0" style={{ color: "#53bdeb" }} />;
                      }
                      if (status === "delivered") {
                        return <CheckCheck className="h-3.5 w-3.5 shrink-0" style={{ color: WA_TEXT_SECONDARY }} />;
                      }
                      // sent
                      return <Check className="h-3.5 w-3.5 shrink-0" style={{ color: WA_TEXT_SECONDARY }} />;
                    })()}
                  </>
                )}
                {(() => {
                  const body = conv.last_message.body;
                  const mediaContentTypes = (conv.last_message as { media_content_types?: string[] }).media_content_types || [];
                  const mediaUrls = (conv.last_message as { media_urls?: string[] }).media_urls || [];
                  const hasMedia = mediaUrls.length > 0;
                  const firstContentType = mediaContentTypes[0] || "";
                  
                  // Check if it's a template placeholder
                  if (body?.startsWith("[Template")) {
                    // Extract template name if present: "[Template: Name]" -> "Name"
                    const templateName = body.startsWith("[Template: ") 
                      ? body.replace("[Template: ", "").replace("]", "")
                      : "Template";
                    return (
                      <>
                        <FileStack className="h-4 w-4 inline-block shrink-0" />
                        <span className="truncate">{templateName}</span>
                      </>
                    );
                  }
                  
                  // Determine media type from content type
                  if (hasMedia || body === "[Photo]" || body === "[Media]" || body === "[Video]" || body === "[Voice message]" || body === "[Audio]") {
                    // Check actual content type first
                    if (firstContentType.startsWith("audio/") || body === "[Voice message]" || body === "[Audio]") {
                      return (
                        <>
                          <Mic className="h-4 w-4 inline-block shrink-0" />
                          <span>Voice message</span>
                        </>
                      );
                    }
                    if (firstContentType.startsWith("video/") || body === "[Video]") {
                      return (
                        <>
                          <Video className="h-4 w-4 inline-block shrink-0" />
                          <span>Video</span>
                        </>
                      );
                    }
                    if (firstContentType === "application/pdf" || body === "[Document]") {
                      return (
                        <>
                          <FileText className="h-4 w-4 inline-block shrink-0" />
                          <span>Document</span>
                        </>
                      );
                    }
                    // Default to photo for images and unknown media
                    return (
                      <>
                        <Image className="h-4 w-4 inline-block shrink-0" />
                        <span>Photo</span>
                      </>
                    );
                  }
                  return <span className="truncate">{body}</span>;
                })()}
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
