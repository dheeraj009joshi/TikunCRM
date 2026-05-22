import apiClient from "@/lib/api-client";
import { UserRole } from "@/stores/auth-store";

export interface UserBrief {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    role: UserRole;
    is_active: boolean;
    dealership_id?: string;
}

export interface UserWithStats extends UserBrief {
    total_leads: number;
    active_leads: number;
    converted_leads: number;
    conversion_rate: number;
}

export interface TeamListResponse {
    items: UserWithStats[];
    total: number;
    dealership_id?: string;
    dealership_name?: string;
}

export interface CreateUserData {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    phone?: string;
    role: UserRole;
    dealership_id?: string;
}

export interface UpdateUserData {
    first_name?: string;
    last_name?: string;
    phone?: string;
    avatar_url?: string;
    is_active?: boolean;
}

export const TeamService = {
    // List all users with optional filters
    async listUsers(params: {
        dealership_id?: string;
        role?: UserRole;
        is_active?: boolean;
    } = {}): Promise<UserBrief[]> {
        const response = await apiClient.get("/users/", { params });
        return response.data;
    },

    // Get team with statistics - for Dealership Admin
    async getTeamWithStats(dealershipId?: string): Promise<TeamListResponse> {
        const params = dealershipId ? { dealership_id: dealershipId } : {};
        const response = await apiClient.get("/users/team", { params });
        return response.data;
    },

    // Get salespersons for assignment dropdown
    async getSalespersons(dealershipId?: string): Promise<UserBrief[]> {
        const params = dealershipId ? { dealership_id: dealershipId } : {};
        const response = await apiClient.get("/users/salespersons", { params });
        return response.data;
    },

    // Get single user
    async getUser(userId: string): Promise<UserBrief> {
        const response = await apiClient.get(`/users/${userId}`);
        return response.data;
    },

    // Create new user (team member)
    async createUser(data: CreateUserData): Promise<UserBrief> {
        const { phone, ...rest } = data;
        const payload: Record<string, unknown> = { ...rest };
        const trimmed = phone?.trim();
        if (trimmed) payload.phone = trimmed;
        const response = await apiClient.post("/users/", payload);
        return response.data;
    },

    // Update user
    async updateUser(userId: string, data: UpdateUserData): Promise<UserBrief> {
        const response = await apiClient.patch(`/users/${userId}`, data);
        return response.data;
    },

    // Toggle user active status
    async toggleUserStatus(userId: string, isActive: boolean): Promise<UserBrief> {
        const response = await apiClient.patch(`/users/${userId}`, { is_active: isActive });
        return response.data;
    },

    async listBdcAgents(): Promise<UserBrief[]> {
        const response = await apiClient.get("/users/bdc-agents");
        return response.data;
    },

    async getUserDealershipAccess(userId: string): Promise<{ user_id: string; dealerships: { id: string; name: string }[] }> {
        const response = await apiClient.get(`/users/${userId}/dealership-access`);
        return response.data;
    },

    async setUserDealershipAccess(userId: string, dealershipIds: string[]): Promise<void> {
        await apiClient.put(`/users/${userId}/dealership-access`, {
            dealership_ids: dealershipIds,
        });
    },
};
