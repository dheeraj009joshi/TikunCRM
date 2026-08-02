"use client";

import { useEffect, useState } from "react";
import { useDealershipTimezone } from "@/hooks/use-dealership-timezone";
import { formatDateInDealershipTimezone, getTimezoneAbbreviation, parseAsUTC } from "@/utils/timezone";

interface DealershipTimeProps {
    date: Date | string | null | undefined;
    /** Appointment/lead dealership — required for super admins without a home dealership */
    dealershipId?: string | null;
    className?: string;
    showTimezoneAbbr?: boolean;
    dateOnly?: boolean;
    timeOnly?: boolean;
}

/**
 * Displays a date/time in the dealership's configured timezone.
 * Used specifically for appointments which should display in dealership business hours.
 *
 * For other timestamps (lead activity, notifications), use LocalTime instead.
 */
export function DealershipTime({
    date,
    dealershipId,
    className,
    showTimezoneAbbr = false,
    dateOnly = false,
    timeOnly = false,
}: DealershipTimeProps) {
    const { dealershipTimezone, isLoading } = useDealershipTimezone(dealershipId);
    const [formatted, setFormatted] = useState<string>("—");
    const [tzAbbr, setTzAbbr] = useState<string>("");

    useEffect(() => {
        if (isLoading || !date) {
            setFormatted("—");
            return;
        }

        try {
            const d = parseAsUTC(date);
            if (isNaN(d.getTime())) {
                setFormatted("—");
                return;
            }

            const result = formatDateInDealershipTimezone(date, dealershipTimezone, {
                dateOnly,
                timeOnly,
            });
            setFormatted(result);

            if (showTimezoneAbbr) {
                setTzAbbr(getTimezoneAbbreviation(dealershipTimezone));
            }
        } catch (e) {
            console.error("[DealershipTime] Error:", e);
            setFormatted("—");
        }
    }, [date, dealershipTimezone, isLoading, dateOnly, timeOnly, showTimezoneAbbr]);

    if (showTimezoneAbbr && tzAbbr) {
        return (
            <span className={className}>
                {formatted} <span className="text-muted-foreground text-xs">({tzAbbr})</span>
            </span>
        );
    }

    return <span className={className}>{formatted}</span>;
}

/**
 * Displays only the date portion in dealership timezone.
 */
export function DealershipDate({ date, dealershipId, className, showTimezoneAbbr }: DealershipTimeProps) {
    return (
        <DealershipTime
            date={date}
            dealershipId={dealershipId}
            className={className}
            showTimezoneAbbr={showTimezoneAbbr}
            dateOnly
        />
    );
}

/**
 * Displays only the time portion in dealership timezone.
 */
export function DealershipTimeOnly({ date, dealershipId, className, showTimezoneAbbr }: DealershipTimeProps) {
    return (
        <DealershipTime
            date={date}
            dealershipId={dealershipId}
            className={className}
            showTimezoneAbbr={showTimezoneAbbr}
            timeOnly
        />
    );
}
