"use client"

import { useAuthStore, UserRole } from "@/stores/auth-store"
import { useMemo } from "react"

export type Permission =
    // Lead permissions
    | "view_all_leads"
    | "view_dealership_leads"
    | "view_own_leads"
    | "create_lead"
    | "update_lead"
    | "delete_lead"
    | "assign_lead_to_dealership"
    | "assign_lead_to_salesperson"
    // User permissions
    | "view_all_users"
    | "view_dealership_users"
    | "create_user"
    | "update_user"
    | "delete_user"
    // Dealership permissions
    | "view_all_dealerships"
    | "view_own_dealership"
    | "create_dealership"
    | "update_dealership"
    | "delete_dealership"
    // Activity permissions
    | "view_all_activities"
    | "view_dealership_activities"
    | "view_own_activities"
    // Schedule permissions
    | "manage_dealership_schedules"
    | "view_own_schedule"
    // Communication permissions
    | "send_email"
    | "send_sms"
    | "log_call"
    // Integration permissions
    | "manage_integrations"
    // Report permissions
    | "view_system_reports"
    | "view_dealership_reports"

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
    super_admin: [
        "view_all_leads",
        "view_dealership_leads",
        "view_own_leads",
        "create_lead",
        "update_lead",
        "delete_lead",
        "assign_lead_to_dealership",
        "assign_lead_to_salesperson",
        "view_all_users",
        "view_dealership_users",
        "create_user",
        "update_user",
        "delete_user",
        "view_all_dealerships",
        "view_own_dealership",
        "create_dealership",
        "update_dealership",
        "delete_dealership",
        "view_all_activities",
        "view_dealership_activities",
        "view_own_activities",
        "manage_dealership_schedules",
        "view_own_schedule",
        "send_email",
        "send_sms",
        "log_call",
        "manage_integrations",
        "view_system_reports",
        "view_dealership_reports",
    ],
    dealership_owner: [
        "view_dealership_leads",
        "create_lead",
        "update_lead",
        "assign_lead_to_salesperson",
        "view_dealership_users",
        "create_user",
        "update_user",
        "delete_user",
        "view_own_dealership",
        "update_dealership",
        "view_dealership_activities",
        "manage_dealership_schedules",
        "send_email",
        "send_sms",
        "log_call",
        "manage_integrations",
        "view_dealership_reports",
    ],
    dealership_admin: [
        "view_dealership_leads",
        "create_lead",
        "update_lead",
        "assign_lead_to_salesperson",
        "view_dealership_users",
        "create_user",
        "update_user",
        "view_own_dealership",
        "update_dealership",
        "view_dealership_activities",
        "manage_dealership_schedules",
        "send_email",
        "send_sms",
        "log_call",
        "view_dealership_reports",
    ],
    salesperson: [
        "view_own_leads",
        "create_lead",  // Salesperson can create leads (auto-assigned to them)
        "update_lead",
        "view_own_activities",
        "view_own_schedule",
        "send_email",
        "send_sms",
        "log_call",
    ],
}

export function useRole() {
    const { user, isAuthenticated } = useAuthStore()

    const role = user?.role || null

    const isSuperAdmin = role === "super_admin"
    const isDealershipOwner = role === "dealership_owner"
    const isDealershipAdmin = role === "dealership_admin"
    const isDealershipLevel = role === "dealership_owner" || role === "dealership_admin"
    const isSalesperson = role === "salesperson"

    const permissions = useMemo(() => {
        if (!role) return []
        return ROLE_PERMISSIONS[role] || []
    }, [role])

    const hasPermission = (permission: Permission): boolean => {
        return permissions.includes(permission)
    }

    const canViewAllLeads = hasPermission("view_all_leads")
    const canViewDealershipLeads = hasPermission("view_dealership_leads")
    const canAssignToDealership = hasPermission("assign_lead_to_dealership")
    const canAssignToSalesperson = hasPermission("assign_lead_to_salesperson")
    const canManageUsers = hasPermission("create_user")
    const canManageDealerships = hasPermission("create_dealership")
    const canViewSystemReports = hasPermission("view_system_reports")

    return {
        user,
        role,
        isAuthenticated,
        isSuperAdmin,
        isDealershipOwner,
        isDealershipAdmin,
        isDealershipLevel,
        isSalesperson,
        permissions,
        hasPermission,
        // Convenience checks
        canViewAllLeads,
        canViewDealershipLeads,
        canAssignToDealership,
        canAssignToSalesperson,
        canManageUsers,
        canManageDealerships,
        canViewSystemReports,
    }
}

// Role display names
export const ROLE_DISPLAY_NAMES: Record<UserRole, string> = {
    super_admin: "Super Admin",
    dealership_owner: "Dealership Owner",
    dealership_admin: "Dealership Admin",
    salesperson: "Salesperson",
}

// Get display name for a role (accepts UserRole or string from API)
export function getRoleDisplayName(role: UserRole | string): string {
    return ROLE_DISPLAY_NAMES[role as UserRole] ?? String(role)
}
