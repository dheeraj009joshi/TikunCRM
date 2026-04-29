"use client";

import { useState, useRef, useEffect } from "react";
import { format } from "date-fns";
import { 
  PhoneIncoming, 
  PhoneOutgoing, 
  PhoneMissed, 
  Play, 
  Pause,
  Download,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CallLogItem } from "@/services/whatsapp-service";
import apiClient from "@/lib/api-client";

interface CallRecordingCardProps {
  call: CallLogItem;
}

export function CallRecordingCard({ call }: CallRecordingCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Fetch recording via authenticated API proxy
  useEffect(() => {
    if (!call.recording_url || audioBlobUrl) return;

    let cancelled = false;
    const fetchRecording = async () => {
      setLoadingAudio(true);
      setAudioError(false);
      try {
        // Use the proxy endpoint to get recording with auth
        const response = await apiClient.get(`/voice/calls/${call.id}/recording`, {
          responseType: "blob",
        });
        if (cancelled) return;
        const blob = new Blob([response.data], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        setAudioBlobUrl(url);
      } catch (err) {
        console.error("Failed to load recording:", err);
        if (!cancelled) setAudioError(true);
      } finally {
        if (!cancelled) setLoadingAudio(false);
      }
    };

    fetchRecording();
    return () => {
      cancelled = true;
    };
  }, [call.id, call.recording_url, audioBlobUrl]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
    };
  }, [audioBlobUrl]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getCallIcon = () => {
    if (call.status === "no-answer" || call.status === "failed" || call.status === "canceled") {
      return <PhoneMissed className="h-4 w-4" />;
    }
    if (call.direction === "inbound") {
      return <PhoneIncoming className="h-4 w-4" />;
    }
    return <PhoneOutgoing className="h-4 w-4" />;
  };

  const getCallTitle = () => {
    if (call.status === "no-answer") return "Missed voice call";
    if (call.status === "failed") return "Failed call";
    if (call.status === "canceled") return "Canceled call";
    if (call.status === "busy") return "Busy";
    if (call.direction === "inbound") return "Voice call";
    return "Voice call";
  };

  const isMissed = ["no-answer", "failed", "canceled"].includes(call.status);

  const togglePlayback = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const audio = audioRef.current;
    const progressPercent = (audio.currentTime / audio.duration) * 100;
    setProgress(progressPercent);
    setCurrentTime(audio.currentTime);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = clickX / rect.width;
    audioRef.current.currentTime = percent * audioRef.current.duration;
  };

  const handleDownload = async () => {
    if (!audioBlobUrl && !call.recording_url) return;
    
    try {
      let downloadUrl = audioBlobUrl;
      
      // If we don't have a blob URL yet, fetch it
      if (!downloadUrl) {
        const response = await apiClient.get(`/voice/calls/${call.id}/recording`, {
          responseType: "blob",
        });
        const blob = new Blob([response.data], { type: "audio/wav" });
        downloadUrl = URL.createObjectURL(blob);
      }

      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `call-recording-${call.id}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Only revoke if we created a new URL for download
      if (!audioBlobUrl && downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    };
    
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    
    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, []);

  const duration = call.recording_duration_seconds || call.duration_seconds || 0;
  const displayTime = isPlaying || progress > 0 ? currentTime : duration;

  return (
    <div className="flex justify-center py-1">
      <div className={cn(
        "rounded-xl px-3 py-2 min-w-[280px] max-w-[380px] w-full",
        isMissed ? "bg-[#1a1a1a]" : "bg-[#202c33]"
      )}>
        {/* Call info row */}
        <div className="flex items-center gap-2 mb-2">
          <span className={cn(
            "flex items-center gap-1.5 text-sm",
            isMissed ? "text-red-400" : "text-[#00a884]"
          )}>
            {getCallIcon()}
            {getCallTitle()}
          </span>
          <span className="text-xs text-[#8696a0]">
            {format(new Date(call.started_at), "h:mm a")}
          </span>
          {call.duration_seconds > 0 && (
            <span className="text-xs text-[#8696a0]">
              | {formatTime(call.duration_seconds)}
            </span>
          )}
        </div>

        {/* Recording player - WhatsApp style */}
        {call.recording_url && (
          <div className="flex items-center gap-2">
            {audioBlobUrl && <audio ref={audioRef} src={audioBlobUrl} preload="metadata" />}
            
            {loadingAudio ? (
              <div className="flex items-center justify-center h-10 w-full">
                <Loader2 className="h-5 w-5 animate-spin text-[#8696a0]" />
              </div>
            ) : audioError ? (
              <div className="text-xs text-red-400 py-2">Failed to load recording</div>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={togglePlayback}
                  disabled={!audioBlobUrl}
                  className="h-10 w-10 rounded-full bg-[#00a884] hover:bg-[#00a884]/90 text-white shrink-0"
                >
                  {isPlaying ? (
                    <Pause className="h-5 w-5 fill-current" />
                  ) : (
                    <Play className="h-5 w-5 fill-current ml-0.5" />
                  )}
                </Button>
                
                {/* Progress bar - clickable */}
                <div 
                  className="flex-1 h-1.5 bg-[#3b4a54] rounded-full cursor-pointer relative"
                  onClick={handleSeek}
                >
                  <div 
                    className="h-full bg-[#00a884] rounded-full transition-all duration-100"
                    style={{ width: `${progress}%` }}
                  />
                  {/* Scrubber dot */}
                  {progress > 0 && (
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-[#00a884] rounded-full"
                      style={{ left: `calc(${progress}% - 6px)` }}
                    />
                  )}
                </div>
                
                <span className="text-xs text-[#8696a0] min-w-[36px] text-right tabular-nums">
                  {formatTime(displayTime)}
                </span>
                
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleDownload}
                  className="h-8 w-8 text-[#8696a0] hover:text-white hover:bg-transparent shrink-0"
                  title="Download"
                >
                  <Download className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        )}

        {/* Notes if any */}
        {call.notes && (
          <p className="mt-2 text-xs text-[#8696a0] italic">
            {call.notes}
          </p>
        )}

        {/* Outcome badge if any */}
        {call.outcome && (
          <div className="mt-2">
            <span className={cn(
              "inline-block text-xs px-2 py-0.5 rounded-full",
              call.outcome === "interested" && "bg-green-900/50 text-green-300",
              call.outcome === "callback" && "bg-yellow-900/50 text-yellow-300",
              call.outcome === "not_interested" && "bg-red-900/50 text-red-300",
              call.outcome === "voicemail" && "bg-blue-900/50 text-blue-300",
              !["interested", "callback", "not_interested", "voicemail"].includes(call.outcome) && "bg-[#2a3942] text-[#8696a0]"
            )}>
              {call.outcome.replace("_", " ")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
