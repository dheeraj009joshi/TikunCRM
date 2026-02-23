"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Paperclip, Send, Smile, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = "Type a message",
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        120
      )}px`;
    }
  }, [message]);

  const handleSend = () => {
    if (message.trim() && !disabled) {
      onSend(message.trim());
      setMessage("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-end gap-2 px-4 py-3 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-[#e9edef] dark:border-[#313d45]">
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 flex-shrink-0 text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#374045]"
        disabled={disabled}
      >
        <Smile className="h-6 w-6" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 flex-shrink-0 text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#374045]"
        disabled={disabled}
      >
        <Paperclip className="h-6 w-6" />
      </Button>

      <div className="flex-1 bg-white dark:bg-[#2a3942] rounded-lg">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className={cn(
            "w-full px-3 py-2 text-sm bg-transparent resize-none outline-none",
            "text-[#111b21] dark:text-[#d1d7db]",
            "placeholder:text-[#667781] dark:placeholder:text-[#8696a0]",
            "max-h-[120px]"
          )}
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-10 w-10 flex-shrink-0 rounded-full",
          message.trim()
            ? "bg-[#00a884] hover:bg-[#00997a] text-white"
            : "text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#374045]"
        )}
        onClick={handleSend}
        disabled={disabled || !message.trim()}
      >
        {message.trim() ? (
          <Send className="h-5 w-5" />
        ) : (
          <Mic className="h-6 w-6" />
        )}
      </Button>
    </div>
  );
}
