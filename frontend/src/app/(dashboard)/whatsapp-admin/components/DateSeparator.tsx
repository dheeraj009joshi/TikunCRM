"use client";

interface DateSeparatorProps {
  date: string;
}

export function DateSeparator({ date }: DateSeparatorProps) {
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) {
      return "Today";
    }
    if (d.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    }
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div className="flex items-center justify-center my-4">
      <div className="bg-[#e1f2fa] dark:bg-[#182229] text-[#54656f] dark:text-[#8696a0] text-xs px-3 py-1 rounded-lg shadow-sm">
        {formatDate(date)}
      </div>
    </div>
  );
}
