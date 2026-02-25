"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageItem } from "@/services/whatsapp-baileys-service";
import { ChatHeader } from "./ChatHeader";
import { ChatInput, MediaAttachment } from "./ChatInput";
import { MessageBubble } from "./MessageBubble";
import { DateSeparator } from "./DateSeparator";

interface ChatViewProps {
  phoneNumber: string;
  customerName?: string;
  messages: MessageItem[];
  loading: boolean;
  initialLoading?: boolean;
  onSendMessage: (message: string) => Promise<void>;
  onSendMedia?: (attachment: MediaAttachment, caption: string) => Promise<void>;
  onBack?: () => void;
  showBackButton?: boolean;
}

interface MessageGroup {
  date: string;
  messages: MessageItem[];
}

export function ChatView({
  phoneNumber,
  customerName,
  messages,
  loading,
  initialLoading,
  onSendMessage,
  onSendMedia,
  onBack,
  showBackButton = false,
}: ChatViewProps) {
  const [sending, setSending] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevMessagesLengthRef = useRef(0);
  const isInitialLoadRef = useRef(true);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  useEffect(() => {
    isInitialLoadRef.current = true;
    prevMessagesLengthRef.current = 0;
    scrollToBottom(false);
  }, [phoneNumber, scrollToBottom]);

  useEffect(() => {
    const hasNewMessages = messages.length > prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;

    if (hasNewMessages) {
      if (isInitialLoadRef.current) {
        scrollToBottom(false);
        isInitialLoadRef.current = false;
      } else {
        scrollToBottom(true);
      }
    }
  }, [messages.length, scrollToBottom]);

  const showLoadingSpinner = initialLoading ?? (loading && messages.length === 0);

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } =
        scrollContainerRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollButton(!isNearBottom);
    }
  };

  const handleSend = async (message: string) => {
    setSending(true);
    try {
      await onSendMessage(message);
      scrollToBottom(true);
    } finally {
      setSending(false);
    }
  };

  const handleSendMedia = async (attachment: MediaAttachment, caption: string) => {
    if (!onSendMedia) return;
    setSending(true);
    try {
      await onSendMedia(attachment, caption);
      scrollToBottom(true);
    } finally {
      setSending(false);
    }
  };

  const groupMessagesByDate = (msgs: MessageItem[]): MessageGroup[] => {
    const groups: MessageGroup[] = [];
    let currentDate = "";

    msgs.forEach((msg) => {
      const msgDate = new Date(
        msg.created_at || msg.sent_at || msg.received_at || Date.now()
      ).toDateString();

      if (msgDate !== currentDate) {
        currentDate = msgDate;
        groups.push({
          date: msg.created_at || msg.sent_at || msg.received_at || new Date().toISOString(),
          messages: [msg],
        });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    });

    return groups;
  };

  const messageGroups = groupMessagesByDate(messages);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#efeae2] dark:bg-[#0b141a] relative">
      {/* WhatsApp background pattern */}
      <div
        className="absolute inset-0 opacity-[0.06] dark:opacity-[0.06] pointer-events-none z-0"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cpattern id='a' patternUnits='userSpaceOnUse' width='60' height='60'%3E%3Cpath d='M30 5.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 45a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM10 25a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm40 0a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z' fill='%23111b21'/%3E%3C/pattern%3E%3C/defs%3E%3Crect fill='url(%23a)' width='100%25' height='100%25'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Header */}
      <div className="flex-shrink-0 relative z-10">
        <ChatHeader
          name={customerName || ""}
          phone={phoneNumber}
          onBack={onBack}
          showBackButton={showBackButton}
        />
      </div>

      {/* Messages Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-2 relative z-10 min-h-0"
      >
        {showLoadingSpinner ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-[#00a884]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#667781] dark:text-[#8696a0]">
            <div className="bg-[#f7f8fa] dark:bg-[#182229] rounded-lg px-4 py-3 text-center max-w-xs">
              <p className="text-sm">
                No messages yet. Send a message to start the conversation.
              </p>
            </div>
          </div>
        ) : (
          <>
            {messageGroups.map((group, groupIndex) => (
              <div key={groupIndex}>
                <DateSeparator date={group.date} />
                {group.messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    body={msg.body || ""}
                    direction={msg.direction as "inbound" | "outbound"}
                    status={msg.status}
                    timestamp={msg.created_at || msg.sent_at || msg.received_at}
                    isRead={msg.is_read}
                    mediaUrl={msg.media_url}
                    mediaType={msg.media_type}
                  />
                ))}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <Button
            size="icon"
            variant="secondary"
            className={cn(
              "fixed bottom-24 right-8 rounded-full shadow-lg z-20",
              "bg-white dark:bg-[#202c33] hover:bg-[#f0f2f5] dark:hover:bg-[#374045]",
              "h-10 w-10"
            )}
            onClick={() => scrollToBottom(true)}
          >
            <ArrowDown className="h-5 w-5 text-[#54656f] dark:text-[#aebac1]" />
          </Button>
        )}
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 relative z-10">
        <ChatInput
          onSend={handleSend}
          onSendMedia={onSendMedia ? handleSendMedia : undefined}
          disabled={sending}
          placeholder="Type a message"
        />
      </div>
    </div>
  );
}
