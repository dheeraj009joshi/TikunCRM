"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Phone, User, Loader2 } from "lucide-react";

export interface PendingLeadDetails {
  callLogId: string;
  leadId: string | null;
  phoneNumber: string;
}

interface LeadDetailsModalProps {
  info: PendingLeadDetails | null;
  onSave: (data: { firstName: string; lastName: string; email?: string }) => Promise<void>;
  onSkip: () => void;
}

export function LeadDetailsModal({ info, onSave, onSkip }: LeadDetailsModalProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!info) return null;

  const handleSave = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter first and last name");
      return;
    }
    setError(null);

    setIsSaving(true);
    try {
      await onSave({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() || undefined,
      });

      // Reset form
      setFirstName("");
      setLastName("");
      setEmail("");
    } catch (err) {
      console.error("Failed to save lead details:", err);
      setError("Failed to save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkip = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setError(null);
    onSkip();
  };

  return (
    <Dialog open={!!info} onOpenChange={(open) => !open && handleSkip()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Add Caller Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <Phone className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{info.phoneNumber}</span>
          </div>
          
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <p className="text-sm text-muted-foreground">
            You just spoke with a new caller. Add their details to create a lead in the CRM.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                placeholder="John"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={isSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name *</Label>
              <Input
                id="lastName"
                placeholder="Doe"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email (optional)</Label>
            <Input
              id="email"
              type="email"
              placeholder="john@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSaving}
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleSkip} disabled={isSaving}>
            Skip for now
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Lead"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
