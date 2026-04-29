"use client";

import { useState, useRef } from "react";
import { Paperclip, X, Image, Video, Mic, FileText, Loader2, Send } from "lucide-react";
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
import { whatsappService, getMediaCategory } from "@/services/whatsapp-service";
import { useToast } from "@/hooks/use-toast";

interface MediaUploadButtonProps {
  leadId: string;
  disabled?: boolean;
  onMediaSent?: () => void;
}

const ACCEPTED_TYPES = {
  image: "image/jpeg,image/png,image/gif,image/webp",
  video: "video/mp4,video/3gpp",
  audio: "audio/ogg,audio/mpeg,audio/amr,audio/aac",
  document: "application/pdf",
};

const ALL_ACCEPTED = Object.values(ACCEPTED_TYPES).join(",");

export function MediaUploadButton({ leadId, disabled, onMediaSent }: MediaUploadButtonProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (16MB max)
    if (file.size > 16 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Maximum file size is 16MB",
        variant: "destructive",
      });
      return;
    }

    // Create preview URL for images and videos
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
    
    // Reset the input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClose = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setCaption("");
    setDialogOpen(false);
  };

  const handleSend = async () => {
    if (!selectedFile) return;

    setUploading(true);
    try {
      // Upload file to Azure
      const uploadResult = await whatsappService.uploadMedia(selectedFile);

      // Send via WhatsApp
      const sendResult = await whatsappService.sendMediaToLead(
        leadId,
        uploadResult.url,
        caption || undefined
      );

      if (sendResult.success) {
        toast({ title: "Media sent" });
        handleClose();
        onMediaSent?.();
      } else {
        toast({
          title: "Failed to send",
          description: sendResult.error || "Could not send media",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Media upload/send failed:", error);
      toast({
        title: "Error",
        description: "Failed to upload or send media",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
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

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ALL_ACCEPTED}
        onChange={handleFileSelect}
        className="hidden"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
        className="h-10 w-10 shrink-0 text-[#8696a0] hover:text-white hover:bg-[#3b4a54]"
        title="Attach media"
      >
        <Paperclip className="h-5 w-5" />
      </Button>

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="bg-[#202c33] border-[#2a3942] text-[#e9edef] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#e9edef]">
              {getFileIcon()}
              Send Media
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Preview */}
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

                {/* File info overlay */}
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

            {/* Caption input */}
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
              disabled={uploading}
              className="border-[#3b4a54] bg-[#2a3942] text-[#e9edef] hover:bg-[#3b4a54] hover:text-[#e9edef]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              disabled={!selectedFile || uploading}
              className="bg-[#00a884] hover:bg-[#00a884]/90 text-white"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
