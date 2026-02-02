"use client"

import * as React from "react"
import Link from "next/link"
import { 
    Mail, 
    User, 
    Building2, 
    Bell, 
    Shield, 
    Palette,
    ChevronRight,
    FileText,
    Send
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useRole } from "@/hooks/use-role"

interface SettingSection {
    title: string
    description: string
    href: string
    icon: React.ComponentType<{ className?: string }>
    adminOnly?: boolean
    highlight?: boolean
}

const settingsSections: SettingSection[] = [
    {
        title: "My Email Configuration",
        description: "Configure your Hostinger email to send emails from the CRM",
        href: "/settings/email-config",
        icon: Send,
        highlight: true,
    },
    {
        title: "Email Templates",
        description: "Create and manage reusable email templates",
        href: "/settings/email-templates",
        icon: FileText,
    },
    {
        title: "Profile",
        description: "Manage your personal information and preferences",
        href: "/settings/profile",
        icon: User,
    },
    {
        title: "Notifications",
        description: "Configure how you receive notifications",
        href: "/settings/notifications",
        icon: Bell,
    },
    {
        title: "Appearance",
        description: "Customize the look and feel of the application",
        href: "/settings/appearance",
        icon: Palette,
    },
    {
        title: "Dealership Settings",
        description: "Manage your dealership configuration",
        href: "/settings/dealership",
        icon: Building2,
        adminOnly: true,
    },
    {
        title: "Security",
        description: "Password, two-factor authentication, and sessions",
        href: "/settings/security",
        icon: Shield,
    },
]

export default function SettingsPage() {
    const { isSuperAdmin, isDealershipAdmin, isDealershipOwner, isDealershipLevel } = useRole()
    const isAdmin = isSuperAdmin || isDealershipLevel
    
    const filteredSections = settingsSections.filter(section => {
        if (section.adminOnly && !isAdmin) return false
        return true
    })

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Settings</h1>
                <p className="text-muted-foreground">
                    Manage your account settings and preferences
                </p>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredSections.map((section) => (
                    <Link key={section.href} href={section.href}>
                        <Card className={`h-full hover:bg-muted/50 transition-colors cursor-pointer ${section.highlight ? 'border-primary/50 bg-primary/5' : ''}`}>
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${section.highlight ? 'bg-primary text-primary-foreground' : 'bg-primary/10'}`}>
                                            <section.icon className={`h-5 w-5 ${section.highlight ? '' : 'text-primary'}`} />
                                        </div>
                                        <div>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                {section.title}
                                                {section.highlight && (
                                                    <Badge variant="secondary" className="text-xs">Required</Badge>
                                                )}
                                            </CardTitle>
                                        </div>
                                    </div>
                                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                                </div>
                            </CardHeader>
                            <CardContent>
                                <CardDescription>{section.description}</CardDescription>
                            </CardContent>
                        </Card>
                    </Link>
                ))}
            </div>
        </div>
    )
}
