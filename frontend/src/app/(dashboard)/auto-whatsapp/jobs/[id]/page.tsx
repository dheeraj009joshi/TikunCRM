"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { formatDistanceToNow, format } from "date-fns";
import {
  ArrowLeft,
  Loader2,
  Play,
  Pause,
  Square,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  MessageSquare,
  Users,
  Send,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import {
  autoWhatsAppService,
  AutoWhatsAppJobDetail,
  AutoWhatsAppJobError,
  WSMessage,
  WSStateChangeMessage,
} from "@/services/auto-whatsapp-service";

const statusConfig: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  pending: {
    label: "Pending",
    icon: <Clock className="h-4 w-4" />,
    color: "text-gray-500",
  },
  running: {
    label: "Running",
    icon: <Play className="h-4 w-4" />,
    color: "text-blue-500",
  },
  paused: {
    label: "Paused",
    icon: <Pause className="h-4 w-4" />,
    color: "text-yellow-500",
  },
  completed: {
    label: "Completed",
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: "text-green-500",
  },
  cancelled: {
    label: "Cancelled",
    icon: <XCircle className="h-4 w-4" />,
    color: "text-gray-500",
  },
  failed: {
    label: "Failed",
    icon: <AlertCircle className="h-4 w-4" />,
    color: "text-red-500",
  },
};

interface LogEntry {
  type: "progress" | "error" | "state";
  message: string;
  timestamp: Date;
}

export default function AutoWhatsAppJobDetailPage() {
  const router = useRouter();
  const params = useParams();
  const jobId = params.id as string;
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<AutoWhatsAppJobDetail | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Load job details
  const loadJob = useCallback(async () => {
    try {
      const data = await autoWhatsAppService.getJob(jobId);
      setJob(data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.detail || "Failed to load job",
        variant: "destructive",
      });
      router.push("/auto-whatsapp/jobs");
    } finally {
      setLoading(false);
    }
  }, [jobId, router, toast]);

  useEffect(() => {
    loadJob();
  }, [loadJob]);

  // WebSocket connection
  useEffect(() => {
    if (!job || !["pending", "running", "paused"].includes(job.status)) {
      return;
    }

    const ws = autoWhatsAppService.createJobWebSocket(jobId);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data: WSMessage = JSON.parse(event.data);

        if (data.type === "heartbeat") return;

        if (data.type === "progress") {
          setJob((prev) =>
            prev
              ? {
                  ...prev,
                  status: data.status as any,
                  sent_count: data.sent,
                  failed_count: data.failed,
                  progress_percent: data.percent,
                  current_index: data.current_index,
                }
              : prev
          );

          if (data.current_lead_name) {
            setLogs((prev) => [
              ...prev,
              {
                type: "progress",
                message: `Sent to ${data.current_lead_name}`,
                timestamp: new Date(),
              },
            ]);
          }
        } else if (data.type === "error") {
          setLogs((prev) => [
            ...prev,
            {
              type: "error",
              message: `Failed: ${data.lead_name || data.phone} - ${data.error}`,
              timestamp: new Date(),
            },
          ]);
        } else if (
          ["started", "paused", "resumed", "completed", "cancelled", "failed"].includes(
            data.type
          )
        ) {
          const stateData = data as WSStateChangeMessage;
          setJob((prev) =>
            prev
              ? {
                  ...prev,
                  status: stateData.status as any,
                  sent_count: stateData.sent,
                  failed_count: stateData.failed,
                }
              : prev
          );

          setLogs((prev) => [
            ...prev,
            {
              type: "state",
              message: stateData.message || `Job ${stateData.type}`,
              timestamp: new Date(),
            },
          ]);

          // Reload job for full details on completion
          if (["completed", "cancelled", "failed"].includes(stateData.type)) {
            loadJob();
          }
        }
      } catch (e) {
        console.error("WebSocket message parse error:", e);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("WebSocket closed");
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [job?.status, jobId, loadJob]);

  const handlePause = async () => {
    try {
      setActionLoading("pause");
      await autoWhatsAppService.pauseJob(jobId);
      toast({ title: "Job paused" });
      await loadJob();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.detail || "Failed to pause job",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleResume = async () => {
    try {
      setActionLoading("resume");
      await autoWhatsAppService.resumeJob(jobId);
      toast({ title: "Job resumed" });
      await loadJob();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.detail || "Failed to resume job",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async () => {
    if (!confirm("Are you sure you want to cancel this job?")) return;

    try {
      setActionLoading("cancel");
      await autoWhatsAppService.cancelJob(jobId);
      toast({ title: "Job cancelled" });
      await loadJob();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.detail || "Failed to cancel job",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!job) {
    return null;
  }

  const config = statusConfig[job.status] || statusConfig.pending;
  const isActive = ["pending", "running", "paused"].includes(job.status);
  const canPause = job.status === "running";
  const canResume = job.status === "paused";
  const canCancel = isActive;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => router.push("/auto-whatsapp/jobs")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{job.name}</h1>
          <p className="text-muted-foreground">
            Created {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
            {job.created_by_name && ` by ${job.created_by_name}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canPause && (
            <Button onClick={handlePause} disabled={actionLoading !== null}>
              {actionLoading === "pause" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Pause className="h-4 w-4 mr-2" />
              )}
              Pause
            </Button>
          )}
          {canResume && (
            <Button onClick={handleResume} disabled={actionLoading !== null}>
              {actionLoading === "resume" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Resume
            </Button>
          )}
          {canCancel && (
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={actionLoading !== null}
            >
              {actionLoading === "cancel" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Square className="h-4 w-4 mr-2" />
              )}
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Status and Progress */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <div className={config.color}>{config.icon}</div>
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <p className="text-xl font-bold">{config.label}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Total Leads</p>
                <p className="text-xl font-bold">{job.total_leads}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-green-500" />
              <div>
                <p className="text-sm text-muted-foreground">Sent</p>
                <p className="text-xl font-bold text-green-600">{job.sent_count}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <div>
                <p className="text-sm text-muted-foreground">Failed</p>
                <p className="text-xl font-bold text-red-600">{job.failed_count}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Progress</span>
              <span>{job.progress_percent}%</span>
            </div>
            <Progress value={job.progress_percent} className="h-3" />
            <p className="text-sm text-muted-foreground">
              {job.sent_count + job.failed_count} of {job.total_leads} processed
              ({job.remaining_count} remaining)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Message and Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Message */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Message
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-muted p-4 rounded-lg whitespace-pre-wrap">
              {job.message_text}
            </div>
          </CardContent>
        </Card>

        {/* Live Logs */}
        <Card>
          <CardHeader>
            <CardTitle>Live Activity</CardTitle>
            <CardDescription>Real-time job progress</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64 rounded-md border p-4">
              {logs.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  {isActive ? "Waiting for activity..." : "No activity recorded"}
                </p>
              ) : (
                <div className="space-y-2">
                  {logs.map((log, i) => (
                    <div
                      key={i}
                      className={`text-sm ${
                        log.type === "error"
                          ? "text-red-600"
                          : log.type === "state"
                          ? "text-blue-600 font-medium"
                          : "text-muted-foreground"
                      }`}
                    >
                      <span className="text-xs opacity-50">
                        {format(log.timestamp, "HH:mm:ss")}
                      </span>{" "}
                      {log.message}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Errors */}
      {job.errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Failed Messages ({job.errors.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible>
              <AccordionItem value="errors">
                <AccordionTrigger>View all errors</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {job.errors.map((error, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-sm"
                      >
                        <XCircle className="h-4 w-4 text-red-500 mt-0.5" />
                        <div>
                          <p className="font-medium">
                            {error.lead_name} ({error.phone})
                          </p>
                          <p className="text-red-600">{error.error}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* Job Logs */}
      {job.logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Job History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {job.logs.map((log) => (
                <div key={log.id} className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {format(new Date(log.created_at), "MMM d, HH:mm:ss")}
                  </span>
                  <Badge variant="outline">{log.action}</Badge>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
