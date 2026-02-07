"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2 } from "lucide-react";

interface MessageComposerProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}

export function MessageComposer({ onSend, disabled, placeholder = "Type a message..." }: MessageComposerProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;
    
    setSending(true);
    try {
      await onSend(trimmed);
      setMessage("");
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  };
  
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Send on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  
  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    
    // Auto-resize
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  };
  
  return (
    <div className="flex items-end gap-2 p-4 border-t bg-background">
      <Textarea
        ref={textareaRef}
        value={message}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || sending}
        className="min-h-[40px] max-h-[120px] resize-none"
        rows={1}
      />
      <Button
        size="icon"
        onClick={handleSend}
        disabled={!message.trim() || disabled || sending}
        className="shrink-0"
      >
        {sending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
