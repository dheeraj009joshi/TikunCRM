"""
Role-Based Access Control (RBAC) System
"""
from enum import Enum
from typing import Set


class UserRole(str, Enum):
    """User roles in the system"""
    SUPER_ADMIN = "super_admin"
    DEALERSHIP_OWNER = "dealership_owner"  # Can add admins within their dealership
    DEALERSHIP_ADMIN = "dealership_admin"  # Can only add salespersons
    SALESPERSON = "salesperson"


class Permission(str, Enum):
    """System permissions"""
    # Lead permissions
    VIEW_ALL_LEADS = "view_all_leads"
    VIEW_DEALERSHIP_LEADS = "view_dealership_leads"
    VIEW_OWN_LEADS = "view_own_leads"
    CREATE_LEAD = "create_lead"
    UPDATE_LEAD = "update_lead"
    DELETE_LEAD = "delete_lead"
    ASSIGN_LEAD_TO_DEALERSHIP = "assign_lead_to_dealership"
    ASSIGN_LEAD_TO_SALESPERSON = "assign_lead_to_salesperson"
    
    # User permissions
    VIEW_ALL_USERS = "view_all_users"
    VIEW_DEALERSHIP_USERS = "view_dealership_users"
    CREATE_USER = "create_user"
    UPDATE_USER = "update_user"
    DELETE_USER = "delete_user"
    
    # Dealership permissions
    VIEW_ALL_DEALERSHIPS = "view_all_dealerships"
    VIEW_OWN_DEALERSHIP = "view_own_dealership"
    CREATE_DEALERSHIP = "create_dealership"
    UPDATE_DEALERSHIP = "update_dealership"
    DELETE_DEALERSHIP = "delete_dealership"
    
    # Activity permissions
    VIEW_ALL_ACTIVITIES = "view_all_activities"
    VIEW_DEALERSHIP_ACTIVITIES = "view_dealership_activities"
    VIEW_OWN_ACTIVITIES = "view_own_activities"
    
    # Schedule permissions
    MANAGE_DEALERSHIP_SCHEDULES = "manage_dealership_schedules"
    VIEW_OWN_SCHEDULE = "view_own_schedule"
    
    # Communication permissions
    SEND_EMAIL = "send_email"
    SEND_SMS = "send_sms"
    LOG_CALL = "log_call"
    
    # Integration permissions
    MANAGE_INTEGRATIONS = "manage_integrations"
    
    # Report permissions
    VIEW_SYSTEM_REPORTS = "view_system_reports"
    VIEW_DEALERSHIP_REPORTS = "view_dealership_reports"


# Role to permissions mapping
ROLE_PERMISSIONS: dict[UserRole, Set[Permission]] = {
    UserRole.SUPER_ADMIN: set(Permission),  # All permissions
    
    UserRole.DEALERSHIP_OWNER: {
        # Lead permissions
        Permission.VIEW_DEALERSHIP_LEADS,
        Permission.CREATE_LEAD,
        Permission.UPDATE_LEAD,
        Permission.ASSIGN_LEAD_TO_SALESPERSON,
        
        # User permissions - can create admins and salespersons
        Permission.VIEW_DEALERSHIP_USERS,
        Permission.CREATE_USER,
        Permission.UPDATE_USER,
        Permission.DELETE_USER,
        
        # Dealership permissions - full control of own dealership
        Permission.VIEW_OWN_DEALERSHIP,
        Permission.UPDATE_DEALERSHIP,
        
        # Activity permissions
        Permission.VIEW_DEALERSHIP_ACTIVITIES,
        
        # Schedule permissions
        Permission.MANAGE_DEALERSHIP_SCHEDULES,
        
        # Communication permissions
        Permission.SEND_EMAIL,
        Permission.SEND_SMS,
        Permission.LOG_CALL,
        
        # Integration permissions
        Permission.MANAGE_INTEGRATIONS,
        
        # Report permissions
        Permission.VIEW_DEALERSHIP_REPORTS,
    },
    
    UserRole.DEALERSHIP_ADMIN: {
        # Lead permissions
        Permission.VIEW_DEALERSHIP_LEADS,
        Permission.CREATE_LEAD,
        Permission.UPDATE_LEAD,
        Permission.ASSIGN_LEAD_TO_SALESPERSON,
        
        # User permissions - can only add salespersons
        Permission.VIEW_DEALERSHIP_USERS,
        Permission.CREATE_USER,
        Permission.UPDATE_USER,
        
        # Dealership permissions
        Permission.VIEW_OWN_DEALERSHIP,
        Permission.UPDATE_DEALERSHIP,
        
        # Activity permissions
        Permission.VIEW_DEALERSHIP_ACTIVITIES,
        
        # Schedule permissions
        Permission.MANAGE_DEALERSHIP_SCHEDULES,
        
        # Communication permissions
        Permission.SEND_EMAIL,
        Permission.SEND_SMS,
        Permission.LOG_CALL,
        
        # Report permissions
        Permission.VIEW_DEALERSHIP_REPORTS,
    },
    
    UserRole.SALESPERSON: {
        # Lead permissions
        Permission.VIEW_OWN_LEADS,
        Permission.CREATE_LEAD,  # Salesperson can create leads
        Permission.UPDATE_LEAD,
        
        # Activity permissions
        Permission.VIEW_OWN_ACTIVITIES,
        
        # Schedule permissions
        Permission.VIEW_OWN_SCHEDULE,
        
        # Communication permissions
        Permission.SEND_EMAIL,
        Permission.SEND_SMS,
        Permission.LOG_CALL,
    },
}


def has_permission(role: UserRole, permission: Permission) -> bool:
    """Check if a role has a specific permission"""
    return permission in ROLE_PERMISSIONS.get(role, set())


def get_permissions(role: UserRole) -> Set[Permission]:
    """Get all permissions for a role"""
    return ROLE_PERMISSIONS.get(role, set())


def is_super_admin(role: UserRole) -> bool:
    """Check if role is super admin"""
    return role == UserRole.SUPER_ADMIN


def is_dealership_owner(role: UserRole) -> bool:
    """Check if role is dealership owner"""
    return role == UserRole.DEALERSHIP_OWNER


def is_dealership_admin(role: UserRole) -> bool:
    """Check if role is dealership admin"""
    return role == UserRole.DEALERSHIP_ADMIN


def is_dealership_level(role: UserRole) -> bool:
    """Check if role is dealership owner or admin"""
    return role in (UserRole.DEALERSHIP_OWNER, UserRole.DEALERSHIP_ADMIN)


def is_salesperson(role: UserRole) -> bool:
    """Check if role is salesperson"""
    return role == UserRole.SALESPERSON
