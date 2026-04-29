"use client";

import { useState, useRef } from "react";
import { Paperclip, X, Image, Video, Mic, FileText, Send, File } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { whatsappService, getMediaCategory } from "@/services/whatsapp-service";
import { useToast } from "@/hooks/use-toast";

interface MediaUploadButtonProps {
  leadId: string;
  disabled?: boolean;
  onMediaSent?: () => void;
  onOptimisticSend?: (tempId: string, contentType: string, caption?: string) => void;
  onSendSuccess?: (tempId: string, realId: string) => void;
  onSendFailed?: (tempId: string) => void;
}

const ACCEPTED_TYPES = {
  image: "image/jpeg,image/png,image/gif,image/webp",
  video: "video/mp4,video/3gpp",
  audio: "audio/ogg,audio/mpeg,audio/amr,audio/aac,audio/webm,audio/wav",
  document: "application/pdf",
};

export function MediaUploadButton({ 
  leadId, 
  disabled, 
  onMediaSent,
  onOptimisticSend,
  onSendSuccess,
  onSendFailed,
}: MediaUploadButtonProps) {
  const { toast } = useToast();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 16 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Maximum file size is 16MB",
        variant: "destructive",
      });
      return;
    }

    const category = getMediaCategory(file.type);
    if (category === "image" || category === "video") {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }

    setSelectedFile(file);
    setCaption("");
    setDialogOpen(true);
    setMenuOpen(false);
    
    // Reset inputs
    if (photoInputRef.current) photoInputRef.current.value = "";
    if (videoInputRef.current) videoInputRef.current.value = "";
    if (documentInputRef.current) documentInputRef.current.value = "";
  };

  const handleClose = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    setCaption("");
    setDialogOpen(false);
  };

  const generateTempId = () => `temp_media_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const handleSend = () => {
    if (!selectedFile) return;

    const fileType = selectedFile.type;
    const captionText = caption;
    const file = selectedFile;
    const tempId = generateTempId();

    // Notify parent for optimistic update immediately
    onOptimisticSend?.(tempId, fileType, captionText || undefined);

    // Close dialog immediately
    handleClose();

    // Upload and send in background
    whatsappService.uploadMedia(file)
      .then((uploadResult) => {
        return whatsappService.sendMediaToLead(
          leadId,
          uploadResult.url,
          uploadResult.content_type,
          captionText || undefined
        );
      })
      .then((sendResult) => {
        if (sendResult.success && sendResult.message_id) {
          onSendSuccess?.(tempId, sendResult.message_id);
          onMediaSent?.();
        } else {
          onSendFailed?.(tempId);
          toast({
            title: "Failed to send",
            description: sendResult.error || "Could not send media",
            variant: "destructive",
          });
        }
      })
      .catch((error) => {
        console.error("Media upload/send failed:", error);
        onSendFailed?.(tempId);
        toast({
          title: "Error",
          description: "Failed to upload or send media",
          variant: "destructive",
        });
      });
  };

  const getFileIcon = () => {
    if (!selectedFile) return <Paperclip className="h-5 w-5" />;
    const category = getMediaCategory(selectedFile.type);
    switch (category) {
      case "image": return <Image className="h-5 w-5" />;
      case "video": return <Video className="h-5 w-5" />;
      case "audio": return <Mic className="h-5 w-5" />;
      default: return <FileText className="h-5 w-5" />;
    }
  };

  const menuItems = [
    {
      icon: <Image className="h-5 w-5" />,
      label: "Photos",
      color: "bg-purple-500",
      onClick: () => photoInputRef.current?.click(),
    },
    {
      icon: <Video className="h-5 w-5" />,
      label: "Videos",
      color: "bg-pink-500",
      onClick: () => videoInputRef.current?.click(),
    },
    {
      icon: <File className="h-5 w-5" />,
      label: "Document",
      color: "bg-blue-500",
      onClick: () => documentInputRef.current?.click(),
    },
  ];

  return (
    <>
      <input
        ref={photoInputRef}
        type="file"
        accept={ACCEPTED_TYPES.image}
        onChange={handleFileSelect}
        className="hidden"
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={ACCEPTED_TYPES.video}
        onChange={handleFileSelect}
        className="hidden"
      />
      <input
        ref={documentInputRef}
        type="file"
        accept={ACCEPTED_TYPES.document}
        onChange={handleFileSelect}
        className="hidden"
      />

      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            className="h-9 w-9 shrink-0 text-[#8696a0] hover:text-white hover:bg-[#3b4a54] rounded-full"
            title="Attach"
          >
            <Paperclip className="h-5 w-5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="w-auto p-2 bg-[#233138] border-[#3b4a54] shadow-xl"
        >
          <div className="flex flex-col gap-1">
            {menuItems.map((item, index) => (
              <button
                key={index}
                onClick={item.onClick}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#3b4a54] transition-colors text-left"
              >
                <div className={cn("p-2 rounded-full text-white", item.color)}>
                  {item.icon}
                </div>
                <span className="text-sm text-[#e9edef]">{item.label}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="bg-[#202c33] border-[#2a3942] text-[#e9edef] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#e9edef]">
              {getFileIcon()}
              Send Media
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {selectedFile && (
              <div className="relative rounded-lg overflow-hidden bg-[#0b141a]">
                {previewUrl && getMediaCategory(selectedFile.type) === "image" && (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="w-full max-h-[300px] object-contain"
                  />
                )}
                {previewUrl && getMediaCategory(selectedFile.type) === "video" && (
                  <video
                    src={previewUrl}
                    controls
                    className="w-full max-h-[300px]"
                  />
                )}
                {getMediaCategory(selectedFile.type) === "audio" && (
                  <div className="p-6 flex flex-col items-center gap-4">
                    <Mic className="h-12 w-12 text-[#00a884]" />
                    <p className="text-sm text-[#8696a0]">{selectedFile.name}</p>
                    <audio
                      src={previewUrl || URL.createObjectURL(selectedFile)}
                      controls
                      className="w-full"
                    />
                  </div>
                )}
                {getMediaCategory(selectedFile.type) === "document" && (
                  <div className="p-6 flex flex-col items-center gap-2">
                    <FileText className="h-12 w-12 text-[#00a884]" />
                    <p className="text-sm text-[#8696a0]">{selectedFile.name}</p>
                    <p className="text-xs text-[#8696a0]">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                )}

                <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-3 py-2 flex items-center justify-between">
                  <span className="text-xs text-white truncate max-w-[200px]">
                    {selectedFile.name}
                  </span>
                  <span className="text-xs text-[#8696a0]">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm text-[#8696a0]">Caption (optional)</label>
              <Input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Add a caption..."
                className="bg-[#2a3942] border-[#3b4a54] text-[#e9edef] placeholder:text-[#8696a0]"
                maxLength={1024}
              />
            </div>
          </div>

          <DialogFooter className="flex flex-row gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={handleClose}
              className="border-[#3b4a54] bg-[#2a3942] text-[#e9edef] hover:bg-[#3b4a54] hover:text-[#e9edef]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              disabled={!selectedFile}
              className="bg-[#00a884] hover:bg-[#00a884]/90 text-white"
            >
              <Send className="h-4 w-4 mr-2" />
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
