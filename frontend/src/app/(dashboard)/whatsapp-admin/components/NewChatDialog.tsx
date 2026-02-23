"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Loader2, User, Phone, MessageCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CustomerService, Customer as ServiceCustomer, getCustomerFullName } from "@/services/customer-service";

interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  lead_status?: string;
}

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectCustomer: (customer: SelectedCustomer) => void;
  existingPhones?: Set<string>;
}

export function NewChatDialog({
  open,
  onOpenChange,
  onSelectCustomer,
  existingPhones = new Set(),
}: NewChatDialogProps) {
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<ServiceCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const searchCustomers = useCallback(async (query: string) => {
    if (query.length < 2) {
      setCustomers([]);
      setHasSearched(false);
      return;
    }

    setLoading(true);
    try {
      const response = await CustomerService.list({
        search: query,
        page_size: 20,
      });
      // Map customers with full name
      setCustomers(response.items || []);
      setHasSearched(true);
    } catch (error) {
      console.error("Failed to search customers:", error);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      searchCustomers(search);
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [search, searchCustomers]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setCustomers([]);
      setHasSearched(false);
    }
  }, [open]);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const hasExistingConversation = (phone?: string) => {
    if (!phone) return false;
    const normalized = phone.replace(/\D/g, "");
    return existingPhones.has(normalized) || existingPhones.has(phone);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#111b21] border-[#313d45] text-[#e9edef]">
        <DialogHeader>
          <DialogTitle className="text-[#e9edef]">New Chat</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8696a0]" />
            <Input
              placeholder="Search by name or phone number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-[#202c33] border-0 text-[#d1d7db] placeholder:text-[#8696a0] focus-visible:ring-1 focus-visible:ring-[#00a884]"
              autoFocus
            />
          </div>

          {/* Results */}
          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-[#00a884]" />
              </div>
            ) : !hasSearched ? (
              <div className="text-center py-8 text-[#8696a0]">
                <User className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">
                  Search for a customer by name or phone number
                </p>
              </div>
            ) : customers.length === 0 ? (
              <div className="text-center py-8 text-[#8696a0]">
                <p className="text-sm">No customers found</p>
              </div>
            ) : (
              <div className="space-y-1">
                {customers.map((customer) => {
                  const customerName = getCustomerFullName(customer);
                  const hasConversation = hasExistingConversation(customer.phone);
                  return (
                    <button
                      key={customer.id}
                      onClick={() => {
                        if (customer.phone) {
                          onSelectCustomer({
                            id: customer.id,
                            name: customerName,
                            phone: customer.phone,
                          });
                          onOpenChange(false);
                        }
                      }}
                      disabled={!customer.phone}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-lg transition-colors",
                        "hover:bg-[#202c33]",
                        !customer.phone && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <Avatar className="h-12 w-12 bg-[#6b7c85]">
                        <AvatarFallback className="bg-[#6b7c85] text-[#d1d7db] text-sm font-medium">
                          {getInitials(customerName)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[#e9edef] truncate">
                            {customerName}
                          </span>
                          {hasConversation && (
                            <MessageCircle className="h-4 w-4 text-[#00a884] flex-shrink-0" />
                          )}
                        </div>
                        {customer.phone ? (
                          <p className="text-sm text-[#8696a0] flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {customer.phone}
                          </p>
                        ) : (
                          <p className="text-sm text-red-400">No phone number</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
