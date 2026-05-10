"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  Send,
  Users,
  Filter,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Smartphone,
  QrCode,
  Trash2,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  autoWhatsAppService,
  AutoWhatsAppProfile,
  LeadPreviewItem,
  LeadPreviewFilter,
} from "@/services/auto-whatsapp-service";
import { LeadStageService, LeadStage } from "@/services/lead-stage-service";
import { LeadService, type CampaignFilterOption } from "@/services/lead-service";

export default function AutoWhatsAppPage() {
  const router = useRouter();
  const { toast } = useToast();

  // Profile state
  const [profile, setProfile] = useState<AutoWhatsAppProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileVerifying, setProfileVerifying] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrPolling, setQrPolling] = useState(false);

  // Lead selection state
  const [stages, setStages] = useState<LeadStage[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignFilterOption[]>([]);
  const [filters, setFilters] = useState<LeadPreviewFilter>({
    has_phone: true,
    is_active: true,
  });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewLeads, setPreviewLeads] = useState<LeadPreviewItem[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [totalCount, setTotalCount] = useState(0);
  const [hasPhoneCount, setHasPhoneCount] = useState(0);

  // Message state
  const [jobName, setJobName] = useState("");
  const [messageText, setMessageText] = useState("");
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  // Load profile and filter options on mount
  useEffect(() => {
    loadProfile();
    loadStages();
    loadCampaigns();
  }, []);

  const loadProfile = async (verify: boolean = false) => {
    try {
      if (verify) {
        setProfileVerifying(true);
      } else {
        setProfileLoading(true);
      }
      const data = await autoWhatsAppService.getProfile(verify);
      setProfile(data);
      
      // After initial load, verify the actual status in background
      if (!verify && data) {
        verifyProfileStatus();
      }
    } catch (error: any) {
      if (error.response?.status !== 404) {
        console.error("Failed to load profile:", error);
      }
      setProfile(null);
    } finally {
      setProfileLoading(false);
      setProfileVerifying(false);
    }
  };
  
  const verifyProfileStatus = async () => {
    try {
      setProfileVerifying(true);
      const data = await autoWhatsAppService.getProfile(true);
      setProfile(data);
    } catch (error: any) {
      console.error("Failed to verify profile:", error);
    } finally {
      setProfileVerifying(false);
    }
  };

  const loadStages = async () => {
    try {
      const data = await LeadStageService.list();
      setStages(data);
    } catch (error) {
      console.error("Failed to load stages:", error);
    }
  };

  const loadCampaigns = async () => {
    try {
      const data = await LeadService.getCampaignFilterOptions();
      setCampaigns(data);
    } catch (error) {
      console.error("Failed to load campaigns:", error);
    }
  };

  const handleSetupProfile = async () => {
    try {
      setSetupLoading(true);
      const response = await autoWhatsAppService.setupProfile();
      
      if (response.status === "connected") {
        toast({ title: "Already connected", description: response.message });
        await loadProfile();
        return;
      }

      if (response.qr_code_base64) {
        setQrCode(response.qr_code_base64);
        startQRPolling();
      }
    } catch (error: any) {
      toast({
        title: "Setup failed",
        description: error.response?.data?.detail || "Failed to start setup",
        variant: "destructive",
      });
    } finally {
      setSetupLoading(false);
    }
  };

  const startQRPolling = () => {
    setQrPolling(true);
    const interval = setInterval(async () => {
      try {
        const response = await autoWhatsAppService.getQRCode();
        
        if (response.status === "connected") {
          clearInterval(interval);
          setQrPolling(false);
          setQrCode(null);
          toast({ title: "Connected!", description: "WhatsApp is now connected" });
          await loadProfile();
          return;
        }

        if (response.qr_code_base64) {
          setQrCode(response.qr_code_base64);
        }
      } catch (error: any) {
        // If profile not found (404), stop polling
        if (error.response?.status === 404) {
          console.warn("Profile not found, stopping QR polling");
          clearInterval(interval);
          setQrPolling(false);
          setQrCode(null);
          return;
        }
        console.error("QR polling error:", error);
      }
    }, 3000);

    // Stop polling after 2 minutes
    setTimeout(() => {
      clearInterval(interval);
      setQrPolling(false);
    }, 120000);
  };

  const handleDeleteProfile = async () => {
    if (!confirm("Are you sure you want to disconnect WhatsApp?")) return;
    
    try {
      await autoWhatsAppService.deleteProfile();
      setProfile(null);
      toast({ title: "Disconnected", description: "WhatsApp profile removed" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.detail || "Failed to disconnect",
        variant: "destructive",
      });
    }
  };

  const handlePreviewLeads = async () => {
    try {
      setPreviewLoading(true);
      const response = await autoWhatsAppService.previewLeads(filters);
      setPreviewLeads(response.leads);
      setTotalCount(response.total_count);
      setHasPhoneCount(response.has_phone_count);
      setSelectedLeadIds(new Set(response.leads.map((l) => l.id)));
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.detail || "Failed to load leads",
        variant: "destructive",
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const toggleLeadSelection = (leadId: string) => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) {
        next.delete(leadId);
      } else {
        next.add(leadId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedLeadIds.size === previewLeads.length) {
      setSelectedLeadIds(new Set());
    } else {
      setSelectedLeadIds(new Set(previewLeads.map((l) => l.id)));
    }
  };

  const handleCreateJob = async () => {
    if (!jobName.trim()) {
      toast({ title: "Error", description: "Please enter a job name", variant: "destructive" });
      return;
    }
    if (!messageText.trim()) {
      toast({ title: "Error", description: "Please enter a message", variant: "destructive" });
      return;
    }
    if (selectedLeadIds.size === 0) {
      toast({ title: "Error", description: "Please select at least one lead", variant: "destructive" });
      return;
    }

    try {
      setCreateLoading(true);
      const job = await autoWhatsAppService.createJob({
        name: jobName.trim(),
        message_text: messageText.trim(),
        lead_ids: Array.from(selectedLeadIds),
        filter_criteria: filters as Record<string, unknown>,
      });

      toast({ title: "Job created!", description: `Sending to ${job.total_leads} leads` });
      setShowPreviewModal(false);
      router.push(`/auto-whatsapp/jobs/${job.id}`);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.detail || "Failed to create job",
        variant: "destructive",
      });
    } finally {
      setCreateLoading(false);
    }
  };

  const insertPlaceholder = (placeholder: string) => {
    setMessageText((prev) => prev + placeholder);
  };

  const isProfileConnected = profile?.status === "connected";

  // Profile setup section
  const renderProfileSection = () => {
    if (profileLoading) {
      return (
        <Card>
          <CardContent className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </CardContent>
        </Card>
      );
    }

    if (qrCode) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Scan QR Code
            </CardTitle>
            <CardDescription>
              Open WhatsApp on your phone and scan this QR code to connect
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <div className="bg-white p-4 rounded-lg">
              <img
                src={`data:image/png;base64,${qrCode}`}
                alt="WhatsApp QR Code"
                className="w-64 h-64"
              />
            </div>
            {qrPolling && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for scan...
              </div>
            )}
            <Button variant="outline" onClick={() => setQrCode(null)}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      );
    }

    if (!profile) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              Connect WhatsApp
            </CardTitle>
            <CardDescription>
              Set up WhatsApp Web to send bulk messages
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleSetupProfile} disabled={setupLoading}>
              {setupLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <QrCode className="h-4 w-4 mr-2" />
              )}
              Connect WhatsApp
            </Button>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5" />
                WhatsApp Connection
              </CardTitle>
              <CardDescription>
                {profile.phone_number
                  ? `Connected: ${profile.phone_number}`
                  : "Connection status"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {profileVerifying && (
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Verifying...
                </span>
              )}
              <Badge
                variant={isProfileConnected ? "default" : "destructive"}
                className={isProfileConnected ? "bg-green-500" : ""}
              >
                {isProfileConnected ? (
                  <>
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
                  </>
                ) : (
                  <>
                    <XCircle className="h-3 w-3 mr-1" /> {profile.status}
                  </>
                )}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex gap-2">
          {!isProfileConnected && (
            <Button onClick={handleSetupProfile} disabled={setupLoading}>
              {setupLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Reconnect
            </Button>
          )}
          <Button variant="outline" onClick={handleDeleteProfile}>
            <Trash2 className="h-4 w-4 mr-2" />
            Disconnect
          </Button>
          <Button variant="outline" onClick={() => router.push("/auto-whatsapp/jobs")}>
            <History className="h-4 w-4 mr-2" />
            Job History
          </Button>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="h-6 w-6" />
            Auto WhatsApp
          </h1>
          <p className="text-muted-foreground">
            Send bulk WhatsApp messages to your leads
          </p>
        </div>
      </div>

      {/* Profile Section */}
      {renderProfileSection()}

      {/* Main Content - Only show if connected */}
      {isProfileConnected && (
        <>
          {/* Filters */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Select Leads
              </CardTitle>
              <CardDescription>
                Filter and select leads to send messages to
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>Stage</Label>
                  <Select
                    value={filters.stage_ids?.[0] || "all"}
                    onValueChange={(value) =>
                      setFilters((prev) => ({
                        ...prev,
                        stage_ids: value === "all" ? undefined : [value],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All stages" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All stages</SelectItem>
                      {stages.map((stage) => (
                        <SelectItem key={stage.id} value={stage.id}>
                          {stage.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {campaigns.length > 0 && (
                  <div className="space-y-2">
                    <Label>Campaign</Label>
                    <Select
                      value={filters.campaign_ids?.[0] || "all"}
                      onValueChange={(value) =>
                        setFilters((prev) => ({
                          ...prev,
                          campaign_ids: value === "all" ? undefined : [value],
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All campaigns" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All campaigns</SelectItem>
                        {campaigns.map((campaign) => (
                          <SelectItem key={campaign.id} value={campaign.id} title={campaign.match_pattern}>
                            {campaign.display_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Search</Label>
                  <Input
                    placeholder="Search by name, phone..."
                    value={filters.search || ""}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        search: e.target.value || undefined,
                      }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label>Active Status</Label>
                  <Select
                    value={filters.is_active === undefined ? "all" : filters.is_active.toString()}
                    onValueChange={(value) =>
                      setFilters((prev) => ({
                        ...prev,
                        is_active: value === "all" ? undefined : value === "true",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="true">Active only</SelectItem>
                      <SelectItem value="false">Inactive only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button onClick={handlePreviewLeads} disabled={previewLoading}>
                {previewLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Users className="h-4 w-4 mr-2" />
                )}
                Preview Leads
              </Button>
            </CardContent>
          </Card>

          {/* Leads Table */}
          {previewLeads.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Selected Leads</CardTitle>
                    <CardDescription>
                      {selectedLeadIds.size} of {previewLeads.length} selected
                      ({hasPhoneCount} have phone numbers)
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleSelectAll}
                  >
                    {selectedLeadIds.size === previewLeads.length
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border max-h-96 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Stage</TableHead>
                        <TableHead>Interested In</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewLeads.map((lead) => (
                        <TableRow key={lead.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedLeadIds.has(lead.id)}
                              onCheckedChange={() => toggleLeadSelection(lead.id)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {lead.first_name} {lead.last_name}
                          </TableCell>
                          <TableCell>{lead.phone || "-"}</TableCell>
                          <TableCell>
                            {lead.stage_name && (
                              <Badge
                                variant="outline"
                                style={{
                                  borderColor: lead.stage_color || undefined,
                                  color: lead.stage_color || undefined,
                                }}
                              >
                                {lead.stage_name}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{lead.interested_in || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Message Composer */}
          {selectedLeadIds.size > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5" />
                  Compose Message
                </CardTitle>
                <CardDescription>
                  Write your message with placeholders for personalization
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Job Name</Label>
                  <Input
                    placeholder="e.g., New Year Promotion"
                    value={jobName}
                    onChange={(e) => setJobName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Message</Label>
                  <Textarea
                    placeholder="Hi {{first_name}}, we have exciting news..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    rows={5}
                  />
                  <div className="flex flex-wrap gap-2">
                    <span className="text-sm text-muted-foreground">Placeholders:</span>
                    {[
                      "{{first_name}}",
                      "{{last_name}}",
                      "{{full_name}}",
                      "{{interested_in}}",
                    ].map((p) => (
                      <Button
                        key={p}
                        variant="outline"
                        size="sm"
                        onClick={() => insertPlaceholder(p)}
                      >
                        {p}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <Button onClick={() => setShowPreviewModal(true)}>
                    <Send className="h-4 w-4 mr-2" />
                    Review & Send to {selectedLeadIds.size} Leads
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Preview Modal */}
      <Dialog open={showPreviewModal} onOpenChange={setShowPreviewModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Confirm Bulk Send</DialogTitle>
            <DialogDescription>
              Review your message before sending to {selectedLeadIds.size} leads
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Job Name</Label>
              <p className="font-medium">{jobName}</p>
            </div>

            <div>
              <Label className="text-muted-foreground">Message Preview</Label>
              <div className="bg-muted p-4 rounded-lg whitespace-pre-wrap">
                {messageText}
              </div>
            </div>

            <div className="flex items-center gap-2 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <AlertCircle className="h-5 w-5 text-yellow-600" />
              <p className="text-sm">
                Messages will be sent with 5-10 second delays between each to avoid
                rate limiting. This job may take several minutes to complete.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreviewModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateJob} disabled={createLoading}>
              {createLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Start Sending
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
