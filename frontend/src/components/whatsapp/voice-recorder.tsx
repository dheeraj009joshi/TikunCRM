"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Square, Play, Pause, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { whatsappService } from "@/services/whatsapp-service";
import { useToast } from "@/hooks/use-toast";

interface VoiceRecorderProps {
  leadId: string;
  disabled?: boolean;
  onVoiceSent?: () => void;
  /** Called immediately when send is clicked with temp ID for optimistic update */
  onOptimisticSend?: (tempId: string, duration: number) => void;
  /** Called when send succeeds with real message ID */
  onSendSuccess?: (tempId: string, realId: string) => void;
  /** Called when send fails */
  onSendFailed?: (tempId: string) => void;
  /** Called when recording state changes (to show/hide other UI) */
  onRecordingStateChange?: (isRecording: boolean) => void;
}

type RecordingState = "idle" | "recording" | "recorded";

export function VoiceRecorder({ 
  leadId, 
  disabled, 
  onVoiceSent,
  onOptimisticSend,
  onSendSuccess,
  onSendFailed,
  onRecordingStateChange,
}: VoiceRecorderProps) {
  const { toast } = useToast();
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const recordedDurationRef = useRef(0);
  const currentDurationRef = useRef(0); // Tracks current duration for closure safety

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const generateTempId = () => `temp_voice_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // Notify parent when recording state changes
  useEffect(() => {
    onRecordingStateChange?.(state !== "idle");
  }, [state, onRecordingStateChange]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Prefer ogg (supported by WhatsApp), then webm
      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"  // Safari
          : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : "audio/webm";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        recordedDurationRef.current = currentDurationRef.current;
        setState("recorded");
      };

      mediaRecorder.start(100);
      setState("recording");
      setDuration(0);
      currentDurationRef.current = 0;

      timerRef.current = setInterval(() => {
        currentDurationRef.current += 1;
        setDuration(currentDurationRef.current);
      }, 1000);
    } catch (error) {
      console.error("Failed to start recording:", error);
      toast({
        title: "Microphone access denied",
        description: "Please allow microphone access to record voice messages",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && state === "recording") {
      recordedDurationRef.current = currentDurationRef.current;
      mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const cancelRecording = () => {
    if (state === "recording") {
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setDuration(0);
    setIsPlaying(false);
    setPlaybackProgress(0);
    setState("idle");
    chunksRef.current = [];
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSend = () => {
    if (chunksRef.current.length === 0) return;

    const mimeType = mediaRecorderRef.current?.mimeType || "audio/webm";
    const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("webm") ? "webm" : "wav";
    const blob = new Blob(chunksRef.current, { type: mimeType });
    const file = new File([blob], `voice-message.${extension}`, { type: mimeType });
    const recordedDuration = recordedDurationRef.current;

    // Generate temp ID for optimistic update
    const tempId = generateTempId();
    
    // Notify parent immediately for optimistic update
    onOptimisticSend?.(tempId, recordedDuration);
    
    // Close the recorder UI immediately
    cancelRecording();

    // Upload and send in background
    whatsappService.uploadMedia(file)
      .then((uploadResult) => {
        return whatsappService.sendMediaToLead(
          leadId,
          uploadResult.url,
          uploadResult.content_type
        );
      })
      .then((sendResult) => {
        if (sendResult.success && sendResult.message_id) {
          onSendSuccess?.(tempId, sendResult.message_id);
          onVoiceSent?.();
        } else {
          onSendFailed?.(tempId);
          toast({
            title: "Failed to send",
            description: sendResult.error || "Could not send voice message",
            variant: "destructive",
          });
        }
      })
      .catch((error) => {
        console.error("Voice message send failed:", error);
        onSendFailed?.(tempId);
        toast({
          title: "Error",
          description: "Failed to send voice message",
          variant: "destructive",
        });
      });
  };

  // Handle audio playback events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setPlaybackProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setPlaybackProgress(0);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    
    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [audioUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  if (state === "idle") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={startRecording}
        className="h-9 w-9 shrink-0 text-[#8696a0] hover:text-white hover:bg-[#3b4a54] rounded-full"
        title="Record voice message"
      >
        <Mic className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <div className="flex-1 flex items-center gap-3 bg-[#2a3942] rounded-full px-4 py-2">
      {/* Cancel button */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={cancelRecording}
        className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-full shrink-0"
        title="Cancel"
      >
        <X className="h-5 w-5" />
      </Button>

      {/* Recording indicator */}
      {state === "recording" && (
        <>
          <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse shrink-0" />
          <div className="flex-1 h-1.5 bg-[#3b4a54] rounded-full overflow-hidden">
            <div 
              className="h-full bg-red-500 rounded-full transition-all duration-1000"
              style={{ width: `${Math.min((duration / 120) * 100, 100)}%` }}
            />
          </div>
          <span className="text-sm text-red-400 font-mono tabular-nums shrink-0">
            {formatDuration(duration)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={stopRecording}
            className="h-10 w-10 bg-red-500 hover:bg-red-600 text-white rounded-full shrink-0 flex items-center justify-center"
            title="Stop recording"
          >
            <Square className="h-4 w-4 fill-current" />
          </Button>
        </>
      )}

      {/* Recorded state - ready to send */}
      {state === "recorded" && audioUrl && (
        <>
          <audio ref={audioRef} src={audioUrl} preload="metadata" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={togglePlayback}
            className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white rounded-full shrink-0 flex items-center justify-center"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 fill-current ml-0.5" />
            )}
          </Button>
          <div className="flex-1 h-1.5 bg-[#3b4a54] rounded-full overflow-hidden">
            <div 
              className="h-full bg-[#00a884] rounded-full transition-all duration-100"
              style={{ width: `${playbackProgress}%` }}
            />
          </div>
          <span className="text-sm text-[#8696a0] font-mono tabular-nums shrink-0">
            {formatDuration(recordedDurationRef.current)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleSend}
            className="h-10 w-10 bg-[#00a884] hover:bg-[#00a884]/90 text-white rounded-full shrink-0 flex items-center justify-center"
            title="Send voice message"
          >
            <Send className="h-5 w-5" />
          </Button>
        </>
      )}
    </div>
  );
}
