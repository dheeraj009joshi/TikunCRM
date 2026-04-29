"use client";

import { useState } from "react";
import { Play, Download, FileText, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMediaProxyUrl, getMediaCategory } from "@/services/whatsapp-service";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";

interface WhatsAppMediaPreviewProps {
  messageId: string;
  mediaUrls: string[];
  mediaContentTypes: string[];
  isOutbound?: boolean;
}

export function WhatsAppMediaPreview({
  messageId,
  mediaUrls,
  mediaContentTypes,
  isOutbound = false,
}: WhatsAppMediaPreviewProps) {
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);

  if (!mediaUrls || mediaUrls.length === 0) return null;

  const handleDownload = async (index: number) => {
    const url = getMediaProxyUrl(messageId, index);
    const contentType = mediaContentTypes[index] || "application/octet-stream";
    const extension = contentType.split("/")[1] || "bin";
    
    try {
      const response = await fetch(url, { credentials: "include" });
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `whatsapp-media-${index + 1}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  const openFullscreen = (index: number) => {
    setFullscreenIndex(index);
    setZoom(1);
  };

  const closeFullscreen = () => {
    setFullscreenIndex(null);
    setZoom(1);
  };

  const navigateFullscreen = (direction: "prev" | "next") => {
    if (fullscreenIndex === null) return;
    const newIndex = direction === "prev" 
      ? (fullscreenIndex - 1 + mediaUrls.length) % mediaUrls.length
      : (fullscreenIndex + 1) % mediaUrls.length;
    setFullscreenIndex(newIndex);
    setZoom(1);
  };

  return (
    <>
      <div className={cn(
        "flex flex-wrap gap-1.5 mt-1.5",
        mediaUrls.length === 1 ? "max-w-[280px]" : "max-w-[300px]"
      )}>
        {mediaUrls.map((_, index) => {
          const contentType = mediaContentTypes[index] || "application/octet-stream";
          const category = getMediaCategory(contentType);
          const proxyUrl = getMediaProxyUrl(messageId, index);

          return (
            <MediaThumbnail
              key={index}
              url={proxyUrl}
              contentType={contentType}
              category={category}
              isOutbound={isOutbound}
              isSingle={mediaUrls.length === 1}
              onClick={() => openFullscreen(index)}
              onDownload={() => handleDownload(index)}
            />
          );
        })}
      </div>

      {/* Fullscreen viewer */}
      <Dialog open={fullscreenIndex !== null} onOpenChange={() => closeFullscreen()}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto h-auto p-0 bg-black/95 border-none overflow-hidden">
          {fullscreenIndex !== null && (
            <div className="relative flex items-center justify-center min-h-[50vh]">
              {/* Close button */}
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 z-50 text-white hover:bg-white/20 rounded-full"
                onClick={closeFullscreen}
              >
                <X className="h-6 w-6" />
              </Button>

              {/* Navigation arrows */}
              {mediaUrls.length > 1 && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute left-2 z-50 text-white hover:bg-white/20 rounded-full"
                    onClick={() => navigateFullscreen("prev")}
                  >
                    <ChevronLeft className="h-8 w-8" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 z-50 text-white hover:bg-white/20 rounded-full"
                    onClick={() => navigateFullscreen("next")}
                  >
                    <ChevronRight className="h-8 w-8" />
                  </Button>
                </>
              )}

              {/* Zoom controls for images */}
              {getMediaCategory(mediaContentTypes[fullscreenIndex] || "") === "image" && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-white hover:bg-white/20"
                    onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <span className="text-white text-sm min-w-[3rem] text-center">{Math.round(zoom * 100)}%</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-white hover:bg-white/20"
                    onClick={() => setZoom(Math.min(3, zoom + 0.25))}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* Download button */}
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 left-2 z-50 text-white hover:bg-white/20 rounded-full"
                onClick={() => handleDownload(fullscreenIndex)}
              >
                <Download className="h-5 w-5" />
              </Button>

              {/* Media content */}
              <FullscreenMedia
                url={getMediaProxyUrl(messageId, fullscreenIndex)}
                contentType={mediaContentTypes[fullscreenIndex] || ""}
                zoom={zoom}
              />

              {/* Counter */}
              {mediaUrls.length > 1 && (
                <div className="absolute bottom-4 right-4 z-50 text-white text-sm bg-black/50 px-2 py-1 rounded">
                  {fullscreenIndex + 1} / {mediaUrls.length}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface MediaThumbnailProps {
  url: string;
  contentType: string;
  category: "image" | "video" | "audio" | "document";
  isOutbound: boolean;
  isSingle: boolean;
  onClick: () => void;
  onDownload: () => void;
}

function MediaThumbnail({
  url,
  contentType,
  category,
  isOutbound,
  isSingle,
  onClick,
  onDownload,
}: MediaThumbnailProps) {
  const [error, setError] = useState(false);

  const thumbnailClass = cn(
    "relative rounded-lg overflow-hidden cursor-pointer group",
    isSingle ? "w-full max-w-[280px]" : "w-[140px] h-[140px]",
    isOutbound ? "bg-[#005c4b]/50" : "bg-[#1f2c34]"
  );

  if (category === "image") {
    return (
      <div className={thumbnailClass} onClick={onClick}>
        {error ? (
          <div className="w-full h-32 flex items-center justify-center text-[#8696a0]">
            <FileText className="h-8 w-8" />
          </div>
        ) : (
          <img
            src={url}
            alt="Media"
            className={cn(
              "object-cover",
              isSingle ? "w-full max-h-[300px]" : "w-full h-full"
            )}
            onError={() => setError(true)}
          />
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
        <button
          className="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onDownload(); }}
        >
          <Download className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (category === "video") {
    return (
      <div className={thumbnailClass} onClick={onClick}>
        <video
          src={url}
          className={cn(
            "object-cover",
            isSingle ? "w-full max-h-[300px]" : "w-full h-full"
          )}
          muted
          playsInline
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <div className="p-3 rounded-full bg-white/90">
            <Play className="h-6 w-6 text-[#00a884] fill-current" />
          </div>
        </div>
        <button
          className="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onDownload(); }}
        >
          <Download className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (category === "audio") {
    return (
      <div className={cn(
        "rounded-lg p-3 min-w-[200px]",
        isOutbound ? "bg-[#005c4b]" : "bg-[#1f2c34]"
      )}>
        <audio
          src={url}
          controls
          className="w-full h-10"
          style={{ filter: "invert(1)" }}
        />
        <button
          className="mt-2 flex items-center gap-1 text-xs text-[#8696a0] hover:text-white transition-colors"
          onClick={onDownload}
        >
          <Download className="h-3 w-3" />
          Download
        </button>
      </div>
    );
  }

  // Document
  return (
    <div
      className={cn(
        "rounded-lg p-3 flex items-center gap-3 cursor-pointer min-w-[200px]",
        isOutbound ? "bg-[#005c4b]" : "bg-[#1f2c34]"
      )}
      onClick={onDownload}
    >
      <FileText className="h-10 w-10 text-[#00a884]" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">Document</p>
        <p className="text-xs text-[#8696a0]">{contentType}</p>
      </div>
      <Download className="h-5 w-5 text-[#8696a0]" />
    </div>
  );
}

interface FullscreenMediaProps {
  url: string;
  contentType: string;
  zoom: number;
}

function FullscreenMedia({ url, contentType, zoom }: FullscreenMediaProps) {
  const category = getMediaCategory(contentType);

  if (category === "image") {
    return (
      <img
        src={url}
        alt="Media"
        className="max-w-full max-h-[85vh] object-contain transition-transform duration-200"
        style={{ transform: `scale(${zoom})` }}
      />
    );
  }

  if (category === "video") {
    return (
      <video
        src={url}
        controls
        autoPlay
        className="max-w-full max-h-[85vh]"
      />
    );
  }

  if (category === "audio") {
    return (
      <div className="p-8 bg-[#1f2c34] rounded-lg">
        <audio src={url} controls autoPlay className="w-[400px]" />
      </div>
    );
  }

  return (
    <div className="p-8 bg-[#1f2c34] rounded-lg flex flex-col items-center gap-4">
      <FileText className="h-16 w-16 text-[#00a884]" />
      <p className="text-white">Document: {contentType}</p>
    </div>
  );
}
