"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Square, Play, Pause, Send, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { whatsappService } from "@/services/whatsapp-service";
import { useToast } from "@/hooks/use-toast";

interface VoiceRecorderProps {
  leadId: string;
  disabled?: boolean;
  onVoiceSent?: () => void;
}

type RecordingState = "idle" | "recording" | "recorded" | "sending";

export function VoiceRecorder({ leadId, disabled, onVoiceSent }: VoiceRecorderProps) {
  const { toast } = useToast();
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const drawWaveform = useCallback(() => {
    if (!canvasRef.current || !analyserRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = "#0b141a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2;
    ctx.strokeStyle = "#00a884";
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();

    if (state === "recording") {
      animationRef.current = requestAnimationFrame(drawWaveform);
    }
  }, [state]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up audio analysis for waveform
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Set up MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
          ? "audio/ogg;codecs=opus"
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
        setState("recorded");
      };

      mediaRecorder.start(100);
      setState("recording");
      setDuration(0);

      // Start duration timer
      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);

      // Start waveform animation
      drawWaveform();
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
      mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    }
  };

  const cancelRecording = () => {
    stopRecording();
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setDuration(0);
    setIsPlaying(false);
    setState("idle");
    analyserRef.current = null;
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

  const handleSend = async () => {
    if (!audioUrl || chunksRef.current.length === 0) return;

    setState("sending");
    try {
      // Get the actual mime type used during recording
      const mimeType = mediaRecorderRef.current?.mimeType || "audio/webm";
      const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("webm") ? "webm" : "wav";
      
      // Create blob from chunks with correct type
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const file = new File([blob], `voice-message.${extension}`, { type: mimeType });

      // Upload to Azure
      const uploadResult = await whatsappService.uploadMedia(file);

      // Send via WhatsApp with proper content type
      const sendResult = await whatsappService.sendMediaToLead(
        leadId,
        uploadResult.url,
        uploadResult.content_type
      );

      if (sendResult.success) {
        toast({ title: "Voice message sent" });
        cancelRecording();
        onVoiceSent?.();
      } else {
        toast({
          title: "Failed to send",
          description: sendResult.error || "Could not send voice message",
          variant: "destructive",
        });
        setState("recorded");
      }
    } catch (error) {
      console.error("Voice message send failed:", error);
      toast({
        title: "Error",
        description: "Failed to send voice message",
        variant: "destructive",
      });
      setState("recorded");
    }
  };

  // Handle audio element events
  useEffect(() => {
    if (audioRef.current) {
      const audio = audioRef.current;
      const handleEnded = () => setIsPlaying(false);
      audio.addEventListener("ended", handleEnded);
      return () => audio.removeEventListener("ended", handleEnded);
    }
  }, [audioUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
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
    <div className="flex items-center gap-2 bg-[#2a3942] rounded-lg px-3 py-2 min-w-[200px]">
      {/* Cancel button */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={cancelRecording}
        disabled={state === "sending"}
        className="h-8 w-8 text-[#ef4444] hover:text-[#ef4444] hover:bg-[#3b4a54]"
        title="Cancel"
      >
        <X className="h-4 w-4" />
      </Button>

      {/* Recording / Playback area */}
      <div className="flex-1 flex items-center gap-2">
        {state === "recording" && (
          <>
            <canvas
              ref={canvasRef}
              width={100}
              height={32}
              className="rounded"
            />
            <span className="text-sm text-[#00a884] font-mono min-w-[40px]">
              {formatDuration(duration)}
            </span>
          </>
        )}

        {(state === "recorded" || state === "sending") && audioUrl && (
          <>
            <audio ref={audioRef} src={audioUrl} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={togglePlayback}
              disabled={state === "sending"}
              className="h-8 w-8 text-white hover:bg-[#3b4a54]"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <div className="flex-1 h-1 bg-[#3b4a54] rounded">
              <div className="h-full w-full bg-[#00a884] rounded" />
            </div>
            <span className="text-sm text-[#8696a0] font-mono min-w-[40px]">
              {formatDuration(duration)}
            </span>
          </>
        )}
      </div>

      {/* Stop / Send button */}
      {state === "recording" && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={stopRecording}
          className="h-8 w-8 bg-[#ef4444] hover:bg-[#ef4444]/90 text-white"
          title="Stop recording"
        >
          <Square className="h-4 w-4 fill-current" />
        </Button>
      )}

      {(state === "recorded" || state === "sending") && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleSend}
          disabled={state === "sending"}
          className="h-8 w-8 bg-[#00a884] hover:bg-[#00a884]/90 text-white"
          title="Send"
        >
          {state === "sending" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );
}
