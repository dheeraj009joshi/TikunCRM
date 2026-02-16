"use client";

import React, { createContext, useCallback, useContext, useState } from "react";

export interface CallLeadTarget {
  phone: string;
  leadId: string;
  leadName: string;
}

interface CallLeadContextValue {
  callLead: CallLeadTarget | null;
  setCallLead: (lead: CallLeadTarget | null) => void;
  clearCallLead: () => void;
}

const CallLeadContext = createContext<CallLeadContextValue | null>(null);

export function CallLeadProvider({ children }: { children: React.ReactNode }) {
  const [callLead, setCallLeadState] = useState<CallLeadTarget | null>(null);

  const setCallLead = useCallback((lead: CallLeadTarget | null) => {
    setCallLeadState(lead);
  }, []);

  const clearCallLead = useCallback(() => {
    setCallLeadState(null);
  }, []);

  return (
    <CallLeadContext.Provider value={{ callLead, setCallLead, clearCallLead }}>
      {children}
    </CallLeadContext.Provider>
  );
}

export function useCallLead() {
  const ctx = useContext(CallLeadContext);
  if (!ctx) {
    throw new Error("useCallLead must be used within CallLeadProvider");
  }
  return ctx;
}

export function useCallLeadOptional() {
  return useContext(CallLeadContext);
}
