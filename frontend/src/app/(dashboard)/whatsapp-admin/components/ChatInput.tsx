"use client";

import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from "react";
import { Paperclip, Send, Smile, Mic, X, Image, FileText, Film, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface MediaAttachment {
  type: "image" | "file" | "video" | "audio";
  file: File;
  preview?: string;
  base64?: string;
}

interface ChatInputProps {
  onSend: (message: string) => void;
  onSendMedia?: (attachment: MediaAttachment, caption: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  onSendMedia,
  disabled = false,
  placeholder = "Type a message",
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [attachment, setAttachment] = useState<MediaAttachment | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        120
      )}px`;
    }
  }, [message]);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
    });
  };

  const handleFileSelect = async (
    e: ChangeEvent<HTMLInputElement>,
    type: MediaAttachment["type"]
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const base64 = await fileToBase64(file);
    let preview: string | undefined;

    if (type === "image" || type === "video") {
      preview = URL.createObjectURL(file);
    }

    setAttachment({ type, file, preview, base64 });
    e.target.value = "";
  };

  const clearAttachment = () => {
    if (attachment?.preview) {
      URL.revokeObjectURL(attachment.preview);
    }
    setAttachment(null);
  };

  const handleSend = async () => {
    if (disabled) return;

    if (attachment && onSendMedia) {
      onSendMedia(attachment, message.trim());
      clearAttachment();
      setMessage("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } else if (message.trim()) {
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

  const canSend = attachment || message.trim();

  return (
    <div className="flex flex-col bg-[#f0f2f5] dark:bg-[#202c33] border-t border-[#e9edef] dark:border-[#313d45]">
      {/* Attachment Preview */}
      {attachment && (
        <div className="px-4 py-2 border-b border-[#e9edef] dark:border-[#313d45]">
          <div className="flex items-center gap-3 bg-white dark:bg-[#2a3942] rounded-lg p-2">
            {attachment.type === "image" && attachment.preview && (
              <img
                src={attachment.preview}
                alt="Preview"
                className="h-16 w-16 object-cover rounded"
              />
            )}
            {attachment.type === "video" && attachment.preview && (
              <video
                src={attachment.preview}
                className="h-16 w-16 object-cover rounded"
              />
            )}
            {attachment.type === "file" && (
              <div className="h-16 w-16 flex items-center justify-center bg-[#f0f2f5] dark:bg-[#374045] rounded">
                <FileText className="h-8 w-8 text-[#54656f]" />
              </div>
            )}
            {attachment.type === "audio" && (
              <div className="h-16 w-16 flex items-center justify-center bg-[#f0f2f5] dark:bg-[#374045] rounded">
                <Music className="h-8 w-8 text-[#54656f]" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#111b21] dark:text-[#e9edef] truncate">
                {attachment.file.name}
              </p>
              <p className="text-xs text-[#667781] dark:text-[#8696a0]">
                {(attachment.file.size / 1024).toFixed(1)} KB
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[#54656f]"
              onClick={clearAttachment}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Input Row */}
      <div className="flex items-end gap-2 px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 flex-shrink-0 text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#374045]"
          disabled={disabled}
        >
          <Smile className="h-6 w-6" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 flex-shrink-0 text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#374045]"
              disabled={disabled}
            >
              <Paperclip className="h-6 w-6" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
              <Image className="h-4 w-4 mr-2 text-blue-500" />
              Photo
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => videoInputRef.current?.click()}>
              <Film className="h-4 w-4 mr-2 text-purple-500" />
              Video
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <FileText className="h-4 w-4 mr-2 text-orange-500" />
              Document
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => audioInputRef.current?.click()}>
              <Music className="h-4 w-4 mr-2 text-green-500" />
              Audio
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Hidden file inputs */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFileSelect(e, "image")}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => handleFileSelect(e, "video")}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
          className="hidden"
          onChange={(e) => handleFileSelect(e, "file")}
        />
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => handleFileSelect(e, "audio")}
        />

        <div className="flex-1 bg-white dark:bg-[#2a3942] rounded-lg">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={attachment ? "Add a caption..." : placeholder}
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
            canSend
              ? "bg-[#00a884] hover:bg-[#00997a] text-white"
              : "text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#374045]"
          )}
          onClick={handleSend}
          disabled={disabled || !canSend}
        >
          {canSend ? (
            <Send className="h-5 w-5" />
          ) : (
            <Mic className="h-6 w-6" />
          )}
        </Button>
      </div>
    </div>
  );
}
