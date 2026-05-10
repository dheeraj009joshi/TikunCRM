"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  History,
  Loader2,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { autoWhatsAppService, AutoWhatsAppJob } from "@/services/auto-whatsapp-service";

const statusConfig: Record<
  string,
  { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: {
    label: "Pending",
    icon: <Clock className="h-3 w-3" />,
    variant: "secondary",
  },
  running: {
    label: "Running",
    icon: <Play className="h-3 w-3" />,
    variant: "default",
  },
  paused: {
    label: "Paused",
    icon: <Pause className="h-3 w-3" />,
    variant: "outline",
  },
  completed: {
    label: "Completed",
    icon: <CheckCircle2 className="h-3 w-3" />,
    variant: "default",
  },
  cancelled: {
    label: "Cancelled",
    icon: <XCircle className="h-3 w-3" />,
    variant: "secondary",
  },
  failed: {
    label: "Failed",
    icon: <AlertCircle className="h-3 w-3" />,
    variant: "destructive",
  },
};

export default function AutoWhatsAppJobsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<AutoWhatsAppJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    loadJobs();
  }, [page, statusFilter]);

  const loadJobs = async () => {
    try {
      setLoading(true);
      const response = await autoWhatsAppService.listJobs({
        page,
        page_size: 20,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setJobs(response.jobs);
      setTotal(response.total);
      setTotalPages(response.total_pages);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.detail || "Failed to load jobs",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const config = statusConfig[status] || statusConfig.pending;
    return (
      <Badge
        variant={config.variant}
        className={
          status === "completed"
            ? "bg-green-500"
            : status === "running"
            ? "bg-blue-500"
            : ""
        }
      >
        {config.icon}
        <span className="ml-1">{config.label}</span>
      </Badge>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => router.push("/auto-whatsapp")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History className="h-6 w-6" />
            Job History
          </h1>
          <p className="text-muted-foreground">
            View and manage your bulk WhatsApp send jobs
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>All Jobs</CardTitle>
              <CardDescription>{total} total jobs</CardDescription>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No jobs found
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Progress</TableHead>
                      <TableHead>Sent / Failed</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Created By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => (
                      <TableRow
                        key={job.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => router.push(`/auto-whatsapp/jobs/${job.id}`)}
                      >
                        <TableCell className="font-medium">{job.name}</TableCell>
                        <TableCell>{getStatusBadge(job.status)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={job.progress_percent} className="w-20" />
                            <span className="text-sm text-muted-foreground">
                              {job.progress_percent}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-green-600">{job.sent_count}</span>
                          {" / "}
                          <span className="text-red-600">{job.failed_count}</span>
                          {" of "}
                          {job.total_leads}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDistanceToNow(new Date(job.created_at), {
                            addSuffix: true,
                          })}
                        </TableCell>
                        <TableCell>{job.created_by_name || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
