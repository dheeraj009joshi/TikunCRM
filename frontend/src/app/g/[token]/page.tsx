"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import {
    Loader2,
    UserCheck,
    Phone,
    Mail,
    MapPin,
    Car,
    DollarSign,
    Repeat,
    FileText,
    ShieldAlert,
    Calendar,
} from "lucide-react"
import { GuestService, type GuestPublicProfile } from "@/services/guest-service"

function scoreColor(score: number): string {
    if (score >= 70) return "text-emerald-600"
    if (score >= 40) return "text-amber-600"
    return "text-rose-600"
}

function ScoreRing({ score }: { score: number }) {
    const pct = Math.max(0, Math.min(100, score))
    const radius = 42
    const circumference = 2 * Math.PI * radius
    const offset = circumference - (pct / 100) * circumference
    return (
        <div className="relative h-32 w-32">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="9" className="stroke-gray-200" />
                <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    strokeWidth="9"
                    strokeLinecap="round"
                    className={`${scoreColor(score)} transition-all duration-700`}
                    stroke="currentColor"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-3xl font-bold ${scoreColor(score)}`}>{Math.round(score)}</span>
                <span className="text-[10px] uppercase text-gray-400">Trust Score</span>
            </div>
        </div>
    )
}

function Row({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value?: string | number | null }) {
    if (value == null || value === "") return null
    return (
        <div className="flex items-center gap-3 py-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100">
                <Icon className="h-4 w-4 text-gray-500" />
            </div>
            <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
                <p className="text-sm font-medium text-gray-900 break-words">{value}</p>
            </div>
        </div>
    )
}

export default function PublicGuestPage() {
    const params = useParams()
    const token = params.token as string
    const [profile, setProfile] = React.useState<GuestPublicProfile | null>(null)
    const [isLoading, setIsLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)

    React.useEffect(() => {
        GuestService.getPublic(token)
            .then(setProfile)
            .catch((e) => setError(e instanceof Error ? e.message : "Failed to load profile"))
            .finally(() => setIsLoading(false))
    }, [token])

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-50">
                <Loader2 className="h-7 w-7 animate-spin text-gray-400" />
            </div>
        )
    }

    if (error || !profile) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 px-6 text-center">
                <ShieldAlert className="h-10 w-10 text-gray-300" />
                <h1 className="text-lg font-semibold text-gray-800">Profile unavailable</h1>
                <p className="text-sm text-gray-500">{error || "This link is no longer active."}</p>
            </div>
        )
    }

    const location = [profile.city, profile.state, profile.postal_code].filter(Boolean).join(", ")
    const appointmentLabel = profile.appointment_at
        ? new Date(profile.appointment_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : null

    return (
        <div className="min-h-screen bg-gray-50 pb-10">
            {/* Header */}
            <div className="bg-gradient-to-br from-primary to-primary/80 px-6 pb-8 pt-10 text-white">
                <div className="mx-auto max-w-md">
                    <div className="flex items-center gap-2 text-white/80">
                        <UserCheck className="h-5 w-5" />
                        <span className="text-sm font-medium">Guest Profile</span>
                    </div>
                    <h1 className="mt-2 text-2xl font-bold">{profile.full_name || "Guest"}</h1>
                    {profile.dealership_name && (
                        <p className="text-sm text-white/80">{profile.dealership_name}</p>
                    )}
                </div>
            </div>

            <div className="mx-auto -mt-6 max-w-md space-y-4 px-4">
                {/* Score */}
                {profile.eligibility && profile.eligibility.items.length > 0 && (
                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-4">
                            <ScoreRing score={profile.eligibility.total_score} />
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-gray-800">Eligibility</p>
                                <p className="text-xs text-gray-500">
                                    {Number(profile.eligibility.raw_points).toFixed(0)} of{" "}
                                    {Number(profile.eligibility.max_points).toFixed(0)} points met
                                </p>
                            </div>
                        </div>
                        <div className="mt-3 space-y-1.5 border-t pt-3">
                            {profile.eligibility.items.map((item) => (
                                <div key={item.criterion_id} className="flex items-center justify-between text-sm">
                                    <span className="text-gray-600">{item.label}</span>
                                    <span className={item.is_met ? "font-medium text-emerald-600" : "text-gray-400"}>
                                        {item.is_met ? `+${Number(item.points).toFixed(0)}` : "—"}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Appointment */}
                {appointmentLabel && (
                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                        <Row icon={Calendar} label="Appointment" value={appointmentLabel} />
                    </div>
                )}

                {/* Contact & details */}
                <div className="divide-y rounded-2xl bg-white px-5 py-2 shadow-sm">
                    <Row icon={Phone} label="Phone" value={profile.phone} />
                    <Row icon={Mail} label="Email" value={profile.email} />
                    <Row icon={MapPin} label="Address" value={[profile.address, location].filter(Boolean).join(" · ")} />
                    <Row icon={Car} label="Vehicle of interest" value={profile.vehicle_of_interest} />
                    <Row
                        icon={DollarSign}
                        label="Down payment"
                        value={profile.down_payment != null ? `$${Number(profile.down_payment).toLocaleString()}` : null}
                    />
                    <Row icon={Repeat} label="Trade-in" value={profile.trade_in} />
                </div>

                {/* Documents */}
                {profile.documents.length > 0 && (
                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
                            <FileText className="h-4 w-4" /> Documents on file
                        </div>
                        <div className="space-y-1.5">
                            {profile.documents.map((d) => (
                                <div key={d.id} className="flex items-center justify-between text-sm">
                                    <span className="text-gray-600">{d.category_name}</span>
                                    <span className="max-w-[60%] truncate text-gray-400">{d.file_name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Notes */}
                {profile.notes && (
                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                        <p className="mb-1 text-sm font-semibold text-gray-800">Notes</p>
                        <p className="text-sm text-gray-600 whitespace-pre-wrap">{profile.notes}</p>
                    </div>
                )}

                <p className="px-2 pt-2 text-center text-[11px] text-gray-400">
                    Shared securely via TikunCRM. Do not forward this link.
                </p>
            </div>
        </div>
    )
}
