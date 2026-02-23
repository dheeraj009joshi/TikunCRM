"use client";

import { ArrowLeft, Phone, Video, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface ChatHeaderProps {
  name: string;
  phone: string;
  onBack?: () => void;
  showBackButton?: boolean;
}

export function ChatHeader({
  name,
  phone,
  onBack,
  showBackButton = false,
}: ChatHeaderProps) {
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-[#e9edef] dark:border-[#313d45]">
      {showBackButton && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 lg:hidden"
          onClick={onBack}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
      )}

      <Avatar className="h-10 w-10 bg-[#dfe5e7] dark:bg-[#6b7c85]">
        <AvatarFallback className="bg-[#dfe5e7] dark:bg-[#6b7c85] text-[#54656f] dark:text-[#d1d7db] text-sm font-medium">
          {getInitials(name || phone)}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-[#111b21] dark:text-[#e9edef] truncate">
          {name || phone}
        </h3>
        {name && (
          <p className="text-xs text-[#667781] dark:text-[#8696a0]">{phone}</p>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-[#54656f] dark:text-[#aebac1] hover:bg-[#e9edef] dark:hover:bg-[#374045]"
        >
          <Video className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-[#54656f] dark:text-[#aebac1] hover:bg-[#e9edef] dark:hover:bg-[#374045]"
        >
          <Phone className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-[#54656f] dark:text-[#aebac1] hover:bg-[#e9edef] dark:hover:bg-[#374045]"
        >
          <MoreVertical className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
