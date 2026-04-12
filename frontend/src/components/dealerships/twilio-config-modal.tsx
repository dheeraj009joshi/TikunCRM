"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    DealershipService,
    DealershipTwilioConfig,
    DealershipTwilioConfigUpdate,
} from "@/services/dealership-service";
import { API_BASE_URL } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";

const webhookBase = `${API_BASE_URL}/webhooks/twilio`;

interface TwilioConfigModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    dealershipId: string | null;
    dealershipName: string;
    onSaved?: () => void;
}

export function TwilioConfigModal({
    open,
    onOpenChange,
    dealershipId,
    dealershipName,
    onSaved,
}: TwilioConfigModalProps) {
    const { toast } = useToast();
    const [loading, setLoading] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [accountSid, setAccountSid] = React.useState("");
    const [authToken, setAuthToken] = React.useState("");
    const [smsEnabled, setSmsEnabled] = React.useState(false);
    const [smsFrom, setSmsFrom] = React.useState("");
    const [waEnabled, setWaEnabled] = React.useState(false);
    const [waFrom, setWaFrom] = React.useState("");
    const [voiceEnabled, setVoiceEnabled] = React.useState(false);
    const [twimlAppSid, setTwimlAppSid] = React.useState("");
    const [apiKeySid, setApiKeySid] = React.useState("");
    const [apiKeySecret, setApiKeySecret] = React.useState("");
    const [callerId, setCallerId] = React.useState("");
    const [authTokenSet, setAuthTokenSet] = React.useState(false);
    const [apiSecretSet, setApiSecretSet] = React.useState(false);

    const applyConfig = React.useCallback((c: DealershipTwilioConfig) => {
        setAccountSid(c.account_sid || "");
        setSmsEnabled(c.sms_enabled);
        setSmsFrom(c.sms_from_number || "");
        setWaEnabled(c.whatsapp_enabled);
        setWaFrom(c.whatsapp_from_number || "");
        setVoiceEnabled(c.voice_enabled);
        setTwimlAppSid(c.twilio_twiml_app_sid || "");
        setApiKeySid(c.twilio_api_key_sid || "");
        setCallerId(c.voice_caller_id_number || "");
        setAuthTokenSet(c.auth_token_set);
        setApiSecretSet(c.api_key_secret_set);
        setAuthToken("");
        setApiKeySecret("");
    }, []);

    React.useEffect(() => {
        if (!open || !dealershipId) return;
        setLoading(true);
        DealershipService.getTwilioConfig(dealershipId)
            .then(applyConfig)
            .catch((e) => {
                console.error(e);
                toast({
                    title: "Could not load Twilio config",
                    variant: "destructive",
                });
            })
            .finally(() => setLoading(false));
    }, [open, dealershipId, applyConfig, toast]);

    const handleSave = async () => {
        if (!dealershipId) return;
        setSaving(true);
        try {
            const payload: DealershipTwilioConfigUpdate = {
                account_sid: accountSid || null,
                sms_enabled: smsEnabled,
                sms_from_number: smsFrom || null,
                whatsapp_enabled: waEnabled,
                whatsapp_from_number: waFrom || null,
                voice_enabled: voiceEnabled,
                twilio_twiml_app_sid: twimlAppSid || null,
                twilio_api_key_sid: apiKeySid || null,
                voice_caller_id_number: callerId || null,
            };
            if (authToken.trim()) payload.auth_token = authToken.trim();
            if (apiKeySecret.trim()) payload.twilio_api_key_secret = apiKeySecret.trim();

            const updated = await DealershipService.patchTwilioConfig(dealershipId, payload);
            applyConfig(updated);
            toast({ title: "Twilio settings saved" });
            onSaved?.();
            onOpenChange(false);
        } catch (e) {
            console.error(e);
            toast({
                title: "Save failed",
                description: "Check values and try again.",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Twilio · {dealershipName}</DialogTitle>
                    <DialogDescription>
                        Per-dealership Twilio Account SID, Auth Token, and channel numbers. Falls back to
                        server environment when a field is empty. Secrets are stored encrypted.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="space-y-6 text-sm">
                        <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs font-mono break-all">
                            <p className="text-muted-foreground font-sans font-medium mb-2">
                                Webhook URLs (configure in each Twilio Console)
                            </p>
                            <div>SMS: {webhookBase}/sms/incoming</div>
                            <div>SMS status: {webhookBase}/sms/status</div>
                            <div>WhatsApp: {webhookBase}/whatsapp/incoming</div>
                            <div>WhatsApp status: {webhookBase}/whatsapp/status</div>
                            <div>Voice incoming: {`${API_BASE_URL}/voice/webhook/incoming`}</div>
                        </div>

                        <div className="grid gap-3">
                            <div>
                                <Label htmlFor="acct">Account SID</Label>
                                <Input
                                    id="acct"
                                    value={accountSid}
                                    onChange={(e) => setAccountSid(e.target.value)}
                                    placeholder="ACxxxxxxxx"
                                    className="mt-1"
                                />
                            </div>
                            <div>
                                <Label htmlFor="auth">Auth Token {authTokenSet && "(set — enter new to replace)"}</Label>
                                <Input
                                    id="auth"
                                    type="password"
                                    value={authToken}
                                    onChange={(e) => setAuthToken(e.target.value)}
                                    placeholder={authTokenSet ? "••••••••" : "Your auth token"}
                                    className="mt-1"
                                />
                            </div>
                        </div>

                        <div className="border rounded-lg p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="sms-on">SMS</Label>
                                <Switch id="sms-on" checked={smsEnabled} onCheckedChange={setSmsEnabled} />
                            </div>
                            <div>
                                <Label htmlFor="sms-from">SMS from number</Label>
                                <Input
                                    id="sms-from"
                                    value={smsFrom}
                                    onChange={(e) => setSmsFrom(e.target.value)}
                                    placeholder="+15551234567"
                                    className="mt-1"
                                />
                            </div>
                        </div>

                        <div className="border rounded-lg p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="wa-on">WhatsApp</Label>
                                <Switch id="wa-on" checked={waEnabled} onCheckedChange={setWaEnabled} />
                            </div>
                            <div>
                                <Label htmlFor="wa-from">WhatsApp from number</Label>
                                <Input
                                    id="wa-from"
                                    value={waFrom}
                                    onChange={(e) => setWaFrom(e.target.value)}
                                    placeholder="+15551234567"
                                    className="mt-1"
                                />
                            </div>
                        </div>

                        <div className="border rounded-lg p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="vo-on">Voice (WebRTC)</Label>
                                <Switch id="vo-on" checked={voiceEnabled} onCheckedChange={setVoiceEnabled} />
                            </div>
                            <div>
                                <Label htmlFor="twiml">TwiML App SID</Label>
                                <Input
                                    id="twiml"
                                    value={twimlAppSid}
                                    onChange={(e) => setTwimlAppSid(e.target.value)}
                                    className="mt-1"
                                />
                            </div>
                            <div>
                                <Label htmlFor="apik">API Key SID</Label>
                                <Input
                                    id="apik"
                                    value={apiKeySid}
                                    onChange={(e) => setApiKeySid(e.target.value)}
                                    className="mt-1"
                                />
                            </div>
                            <div>
                                <Label htmlFor="apiks">
                                    API Key Secret {apiSecretSet && "(set — enter new to replace)"}
                                </Label>
                                <Input
                                    id="apiks"
                                    type="password"
                                    value={apiKeySecret}
                                    onChange={(e) => setApiKeySecret(e.target.value)}
                                    placeholder={apiSecretSet ? "••••••••" : ""}
                                    className="mt-1"
                                />
                            </div>
                            <div>
                                <Label htmlFor="cid">Caller ID / voice number</Label>
                                <Input
                                    id="cid"
                                    value={callerId}
                                    onChange={(e) => setCallerId(e.target.value)}
                                    placeholder="+15551234567"
                                    className="mt-1"
                                />
                            </div>
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={handleSave} disabled={saving || loading || !dealershipId}>
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
