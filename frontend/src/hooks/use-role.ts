"use client"

import { useAuthStore, UserRole } from "@/stores/auth-store"
import { useMemo } from "react"

export type Permission =
    // Lead permissions
    | "view_all_leads"
    | "view_dealership_leads"
    | "view_own_leads"
    | "view_group_leads"
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
    // Dealership / org permissions
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
    // Partner store permissions
    | "manage_partner_stores"
    | "connect_lead_to_partner"

const _MANAGER_PERMISSIONS: Permission[] = [
    "view_all_leads",
    "view_dealership_leads",
    "create_lead",
    "update_lead",
    "assign_lead_to_salesperson",
    "connect_lead_to_partner",
    "manage_partner_stores",
    "view_all_users",
    "view_dealership_users",
    "create_user",
    "update_user",
    "delete_user",
    "view_own_dealership",
    "update_dealership",
    "view_all_activities",
    "view_dealership_activities",
    "manage_dealership_schedules",
    "send_email",
    "send_sms",
    "log_call",
    "manage_integrations",
    "view_system_reports",
    "view_dealership_reports",
]

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
    super_admin: [
        ..._MANAGER_PERMISSIONS,
        "view_own_leads",
        "delete_lead",
        "assign_lead_to_dealership",
        "view_all_dealerships",
        "create_dealership",
        "delete_dealership",
        "view_own_activities",
        "view_own_schedule",
        "manage_partner_stores",
    ],
    dealership_owner: _MANAGER_PERMISSIONS,
    dealership_admin: _MANAGER_PERMISSIONS,
    salesperson: [
        "view_own_leads",
        "create_lead",
        "update_lead",
        "view_own_activities",
        "view_own_schedule",
        "send_email",
        "send_sms",
        "log_call",
    ],
    bdc: [
        "view_group_leads",
        "view_dealership_leads",
        "create_lead",
        "update_lead",
        "assign_lead_to_salesperson",
        "connect_lead_to_partner",
        "view_own_activities",
        "view_own_schedule",
        "send_email",
        "send_sms",
        "log_call",
        "view_dealership_reports",
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
    const isBdc = role === "bdc"

    const permissions = useMemo(() => {
        if (!role) return []
        return ROLE_PERMISSIONS[role] || []
    }, [role])

    const hasPermission = (permission: Permission): boolean => {
        return permissions.includes(permission)
    }

    const canViewAllLeads = hasPermission("view_all_leads")
    const canViewGroupLeads = hasPermission("view_group_leads")
    const canViewDealershipLeads = hasPermission("view_dealership_leads")
    const canAssignToDealership = hasPermission("assign_lead_to_dealership")
    const canAssignToSalesperson = hasPermission("assign_lead_to_salesperson")
    const canManageUsers = hasPermission("create_user")
    const canManageDealerships = hasPermission("create_dealership")
    const canManagePartnerStores = hasPermission("manage_partner_stores")
    const canConnectToPartner = hasPermission("connect_lead_to_partner")
    const canViewSystemReports = hasPermission("view_system_reports")
    const canViewDealershipReports = hasPermission("view_dealership_reports")
    const isManagerOrAbove = isSuperAdmin || isDealershipOwner || isDealershipAdmin

    return {
        user,
        role,
        isAuthenticated,
        isSuperAdmin,
        isDealershipOwner,
        isDealershipAdmin,
        isDealershipLevel,
        isManagerOrAbove,
        isSalesperson,
        isBdc,
        permissions,
        hasPermission,
        // Convenience checks
        canViewAllLeads,
        canViewGroupLeads,
        canViewDealershipLeads,
        canAssignToDealership,
        canAssignToSalesperson,
        canManageUsers,
        canManageDealerships,
        canManagePartnerStores,
        canConnectToPartner,
        canViewSystemReports,
        canViewDealershipReports,
    }
}

// Role display names
export const ROLE_DISPLAY_NAMES: Record<UserRole, string> = {
    super_admin: "Admin",
    dealership_owner: "Manager",
    dealership_admin: "Manager",
    salesperson: "Salesperson",
    bdc: "BDC Agent",
}

// Get display name for a role (accepts UserRole or string from API)
export function getRoleDisplayName(role: UserRole | string): string {
    return ROLE_DISPLAY_NAMES[role as UserRole] ?? String(role)
}
