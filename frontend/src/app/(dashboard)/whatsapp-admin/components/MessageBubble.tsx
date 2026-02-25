"use client";

import { Check, CheckCheck, Clock, XCircle, FileText, Download, Image, Film, Mic, MapPin, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  body: string;
  direction: "inbound" | "outbound";
  status?: string;
  timestamp?: string;
  isRead?: boolean;
  mediaUrl?: string;
  mediaType?: string;
}

export function MessageBubble({
  body,
  direction,
  status,
  timestamp,
  isRead,
  mediaUrl,
  mediaType,
}: MessageBubbleProps) {
  const isOutbound = direction === "outbound";
  const hasMedia = !!mediaType;

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

  const renderMedia = () => {
    if (!mediaType) return null;

    // Image with URL
    if ((mediaType === "image" || mediaType?.startsWith("image/")) && mediaUrl) {
      return (
        <div className="mb-1 -mx-1 -mt-1 rounded-t-lg overflow-hidden">
          <img
            src={mediaUrl}
            alt="Image"
            className="max-w-full max-h-64 object-contain cursor-pointer hover:opacity-90"
            onClick={() => window.open(mediaUrl, "_blank")}
          />
        </div>
      );
    }

    // Image placeholder (no URL)
    if (mediaType === "image" && !mediaUrl) {
      return (
        <div className={cn(
          "flex items-center gap-2 p-3 mb-1 rounded-lg",
          isOutbound ? "bg-[#c7f3c0] dark:bg-[#004d40]" : "bg-[#f5f6f6] dark:bg-[#374045]"
        )}>
          <Image className="h-8 w-8 text-[#54656f]" />
          <p className="text-sm text-[#667781]">Photo</p>
        </div>
      );
    }

    // Video with URL
    if ((mediaType === "video" || mediaType?.startsWith("video/")) && mediaUrl) {
      return (
        <div className="mb-1 -mx-1 -mt-1 rounded-t-lg overflow-hidden">
          <video
            src={mediaUrl}
            controls
            className="max-w-full max-h-64"
          />
        </div>
      );
    }

    // Video placeholder
    if (mediaType === "video" && !mediaUrl) {
      return (
        <div className={cn(
          "flex items-center gap-2 p-3 mb-1 rounded-lg",
          isOutbound ? "bg-[#c7f3c0] dark:bg-[#004d40]" : "bg-[#f5f6f6] dark:bg-[#374045]"
        )}>
          <Film className="h-8 w-8 text-[#54656f]" />
          <p className="text-sm text-[#667781]">Video</p>
        </div>
      );
    }

    // Audio with URL
    if ((mediaType === "audio" || mediaType === "ptt" || mediaType?.startsWith("audio/")) && mediaUrl) {
      return (
        <div className="mb-2">
          <audio src={mediaUrl} controls className="w-full max-w-[250px]" />
        </div>
      );
    }

    // Audio placeholder
    if ((mediaType === "audio" || mediaType === "ptt") && !mediaUrl) {
      return (
        <div className={cn(
          "flex items-center gap-2 p-3 mb-1 rounded-lg",
          isOutbound ? "bg-[#c7f3c0] dark:bg-[#004d40]" : "bg-[#f5f6f6] dark:bg-[#374045]"
        )}>
          <Mic className="h-8 w-8 text-[#54656f]" />
          <p className="text-sm text-[#667781]">Voice message</p>
        </div>
      );
    }

    // Document with URL
    if ((mediaType === "document" || mediaType === "file") && mediaUrl) {
      return (
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "flex items-center gap-2 p-2 mb-1 rounded-lg",
            isOutbound ? "bg-[#c7f3c0] dark:bg-[#004d40]" : "bg-[#f5f6f6] dark:bg-[#374045]"
          )}
        >
          <FileText className="h-8 w-8 text-[#54656f]" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{body || "Document"}</p>
            <p className="text-xs text-[#667781]">Click to download</p>
          </div>
          <Download className="h-5 w-5 text-[#54656f]" />
        </a>
      );
    }

    // Document placeholder
    if ((mediaType === "document" || mediaType === "file") && !mediaUrl) {
      return (
        <div className={cn(
          "flex items-center gap-2 p-3 mb-1 rounded-lg",
          isOutbound ? "bg-[#c7f3c0] dark:bg-[#004d40]" : "bg-[#f5f6f6] dark:bg-[#374045]"
        )}>
          <FileText className="h-8 w-8 text-[#54656f]" />
          <p className="text-sm text-[#667781]">{body || "Document"}</p>
        </div>
      );
    }

    // Sticker
    if (mediaType === "sticker" && mediaUrl) {
      return (
        <div className="mb-1">
          <img src={mediaUrl} alt="Sticker" className="max-w-[150px] max-h-[150px]" />
        </div>
      );
    }

    // Location
    if (mediaType === "location") {
      return (
        <div className={cn(
          "flex items-center gap-2 p-3 mb-1 rounded-lg",
          isOutbound ? "bg-[#c7f3c0] dark:bg-[#004d40]" : "bg-[#f5f6f6] dark:bg-[#374045]"
        )}>
          <MapPin className="h-8 w-8 text-[#54656f]" />
          <p className="text-sm text-[#667781]">Location</p>
        </div>
      );
    }

    // Contact
    if (mediaType === "contact") {
      return (
        <div className={cn(
          "flex items-center gap-2 p-3 mb-1 rounded-lg",
          isOutbound ? "bg-[#c7f3c0] dark:bg-[#004d40]" : "bg-[#f5f6f6] dark:bg-[#374045]"
        )}>
          <User className="h-8 w-8 text-[#54656f]" />
          <p className="text-sm text-[#667781]">{body || "Contact"}</p>
        </div>
      );
    }

    return null;
  };

  return (
    <div
      className={cn("flex mb-1", isOutbound ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "relative max-w-[75%] rounded-lg shadow-sm",
          hasMedia ? "p-1" : "px-3 py-2",
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

        {/* Media content */}
        {renderMedia()}

        {/* Message content */}
        {body && (
          <p className={cn(
            "text-sm whitespace-pre-wrap break-words",
            hasMedia ? "px-2 pb-1 pt-1" : "pr-16"
          )}>{body}</p>
        )}

        {/* Timestamp and status */}
        <div
          className={cn(
            "flex items-center gap-1 text-[10px]",
            hasMedia && !body ? "absolute bottom-1 right-2 bg-black/30 text-white px-1.5 py-0.5 rounded" : 
            body ? "absolute bottom-1 right-2" : "absolute bottom-1 right-2",
            !hasMedia && (isOutbound
              ? "text-[#667781] dark:text-[#8696a0]"
              : "text-[#667781] dark:text-[#8696a0]")
          )}
        >
          <span>{formatTime(timestamp)}</span>
          {getStatusIcon()}
        </div>
      </div>
    </div>
  );
}
