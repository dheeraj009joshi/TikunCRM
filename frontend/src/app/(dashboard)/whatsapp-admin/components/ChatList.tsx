"use client";

import { useState } from "react";
import { Search, Plus, RefreshCw, Loader2, Check, CheckCheck, Clock, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { ConversationItem } from "@/services/whatsapp-baileys-service";

interface ChatListProps {
  conversations: ConversationItem[];
  selectedPhone: string | null;
  onSelectConversation: (phone: string) => void;
  onNewChat: () => void;
  onRefresh: () => void;
  loading?: boolean;
}

export function ChatList({
  conversations,
  selectedPhone,
  onSelectConversation,
  onNewChat,
  onRefresh,
  loading = false,
}: ChatListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredConversations = conversations.filter((c) => {
    const query = searchQuery.toLowerCase();
    return (
      c.customer_name?.toLowerCase().includes(query) ||
      c.lead_name?.toLowerCase().includes(query) ||
      c.phone_number.includes(query) ||
      c.last_message?.toLowerCase().includes(query)
    );
  });

  const getInitials = (name?: string, phone?: string) => {
    if (name) {
      return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return phone?.slice(-2) || "??";
  };

  const formatTimestamp = (ts?: string) => {
    if (!ts) return "";
    const date = new Date(ts);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    if (date.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case "sending":
      case "queued":
        return <Clock className="h-[14px] w-[14px] text-[#667781]" />;
      case "sent":
        return <Check className="h-[14px] w-[14px] text-[#667781]" />;
      case "delivered":
        return <CheckCheck className="h-[14px] w-[14px] text-[#667781]" />;
      case "read":
        return <CheckCheck className="h-[14px] w-[14px] text-[#53bdeb]" />;
      case "failed":
      case "undelivered":
        return <XCircle className="h-[14px] w-[14px] text-red-500" />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#111b21] border-r border-[#e9edef] dark:border-[#313d45]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#f0f2f5] dark:bg-[#202c33]">
        <h2 className="text-lg font-semibold text-[#111b21] dark:text-[#e9edef]">
          Chats
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-[#54656f] dark:text-[#aebac1] hover:bg-[#e9edef] dark:hover:bg-[#374045]"
            onClick={onNewChat}
          >
            <Plus className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-[#54656f] dark:text-[#aebac1] hover:bg-[#e9edef] dark:hover:bg-[#374045]"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={cn("h-5 w-5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 bg-white dark:bg-[#111b21]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#54656f] dark:text-[#8696a0]" />
          <Input
            placeholder="Search or start new chat"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-[#f0f2f5] dark:bg-[#202c33] border-0 focus-visible:ring-0 text-sm placeholder:text-[#667781] dark:placeholder:text-[#8696a0]"
          />
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto">
        {loading && conversations.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-[#00a884]" />
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-[#667781] dark:text-[#8696a0]">
            <p className="text-sm">
              {searchQuery ? "No conversations found" : "No conversations yet"}
            </p>
            {!searchQuery && (
              <Button
                variant="link"
                className="text-[#00a884] mt-2"
                onClick={onNewChat}
              >
                Start a new chat
              </Button>
            )}
          </div>
        ) : (
          filteredConversations.map((conversation) => (
            <div
              key={conversation.phone_number}
              onClick={() => onSelectConversation(conversation.phone_number)}
              className={cn(
                "flex items-center gap-3 px-3 py-3 cursor-pointer transition-colors",
                "hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]",
                "border-b border-[#e9edef] dark:border-[#313d45]",
                selectedPhone === conversation.phone_number &&
                  "bg-[#f0f2f5] dark:bg-[#2a3942]"
              )}
            >
              <Avatar className="h-12 w-12 flex-shrink-0 bg-[#dfe5e7] dark:bg-[#6b7c85]">
                <AvatarFallback className="bg-[#dfe5e7] dark:bg-[#6b7c85] text-[#54656f] dark:text-[#d1d7db] text-sm font-medium">
                  {getInitials(
                    conversation.customer_name || conversation.lead_name,
                    conversation.phone_number
                  )}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-[#111b21] dark:text-[#e9edef] truncate">
                    {conversation.customer_name || conversation.lead_name || conversation.phone_number}
                  </span>
                  <span
                    className={cn(
                      "text-xs flex-shrink-0 ml-2",
                      conversation.unread_count > 0
                        ? "text-[#00a884]"
                        : "text-[#667781] dark:text-[#8696a0]"
                    )}
                  >
                    {formatTimestamp(conversation.last_message_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-[#667781] dark:text-[#8696a0] truncate flex items-center gap-1">
                    {conversation.direction === "outbound" && (
                      <span className="flex-shrink-0">
                        {getStatusIcon(conversation.last_message_status)}
                      </span>
                    )}
                    <span className="truncate">
                      {conversation.last_message || "No messages"}
                    </span>
                  </p>
                  {conversation.unread_count > 0 && (
                    <span className="flex-shrink-0 ml-2 bg-[#00a884] text-white text-xs font-medium px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                      {conversation.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
