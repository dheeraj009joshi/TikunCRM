import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type UserRole = 'super_admin' | 'dealership_owner' | 'dealership_admin' | 'salesperson';

export interface User {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    role: UserRole;
    dealership_id: string | null;
    is_active: boolean;
    email_config_verified?: boolean;
    must_change_password?: boolean;
}

interface AuthState {
    user: User | null;
    token: string | null;
    refreshToken: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    setAuth: (user: User, token: string, refreshToken?: string) => void;
    setTokens: (token: string, refreshToken: string) => void;
    logout: () => void;
    updateUser: (user: Partial<User>) => void;
    setLoading: (isLoading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            user: null,
            token: null,
            refreshToken: null,
            isAuthenticated: false,
            isLoading: false,
            setAuth: (user, token, refreshToken) => {
                localStorage.setItem('auth_token', token);
                if (refreshToken) {
                    localStorage.setItem('refresh_token', refreshToken);
                }
                set({ user, token, refreshToken: refreshToken || null, isAuthenticated: true, isLoading: false });
            },
            setTokens: (token, refreshToken) => {
                localStorage.setItem('auth_token', token);
                localStorage.setItem('refresh_token', refreshToken);
                set({ token, refreshToken });
            },
            logout: () => {
                localStorage.removeItem('auth_token');
                localStorage.removeItem('refresh_token');
                set({ user: null, token: null, refreshToken: null, isAuthenticated: false, isLoading: false });
            },
            updateUser: (userData) =>
                set((state) => ({
                    user: state.user ? { ...state.user, ...userData } : null
                })),
            setLoading: (isLoading) => set({ isLoading }),
        }),
        {
            name: 'auth-storage',
            storage: createJSONStorage(() => localStorage),
        }
    )
);
