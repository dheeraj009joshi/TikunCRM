import { HoursBreakdown } from "@/services/time-tracking-service"

export function num(value: number | string | null | undefined): number {
    if (value == null || value === "") return 0
    const n = typeof value === "number" ? value : Number(value)
    return Number.isFinite(n) ? n : 0
}

export function formatMoney(value: number | string | null | undefined): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
    }).format(num(value))
}

export function formatHours(value: number | string | null | undefined): string {
    const totalMinutes = Math.round(num(value) * 60)
    const hrs = Math.floor(Math.abs(totalMinutes) / 60)
    const mins = Math.abs(totalMinutes) % 60
    if (hrs === 0 && mins === 0) return "0h 00m"
    return `${hrs}h ${String(mins).padStart(2, "0")}m`
}

export function formatElapsed(totalSeconds: number): string {
    const secs = Math.max(0, Math.floor(totalSeconds))
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":")
}

export function emptyBreakdown(): HoursBreakdown {
    return {
        regular_hours: 0,
        overtime_hours: 0,
        total_hours: 0,
        regular_pay: 0,
        overtime_pay: 0,
        estimated_pay: 0,
    }
}
