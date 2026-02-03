import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

// Get API URL from environment variable, default to production backend
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://leedsapi.tikuntech.com/api/v1";

const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        "Content-Type": "application/json",
    },
});

// Track if we're currently refreshing to avoid multiple refresh attempts
let isRefreshing = false;
let failedQueue: Array<{
    resolve: (value?: any) => void;
    reject: (error?: any) => void;
}> = [];

const processQueue = (error: AxiosError | null, token: string | null = null) => {
    failedQueue.forEach((prom) => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token);
        }
    });
    failedQueue = [];
};

// Request interceptor for adding the auth token
apiClient.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem("auth_token");
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor for handling common errors (e.g., 401/403 Unauthorized)
apiClient.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

        // Handle 403 "Not authenticated" as well (FastAPI's HTTPBearer returns 403)
        const isAuthError = error.response?.status === 401 || 
            (error.response?.status === 403 && 
             (error.response?.data as any)?.detail === "Not authenticated");

        // If error is 401/403 auth error and we haven't already tried to refresh
        if (isAuthError && !originalRequest._retry) {
            // Don't try to refresh if this is the refresh endpoint itself
            if (originalRequest.url?.includes("/auth/refresh")) {
                // Refresh failed, clear tokens and redirect to login
                localStorage.removeItem("auth_token");
                localStorage.removeItem("refresh_token");
                if (typeof window !== "undefined") {
                    window.location.href = "/login";
                }
                return Promise.reject(error);
            }

            if (isRefreshing) {
                // If already refreshing, queue this request
                return new Promise((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                })
                    .then((token) => {
                        if (originalRequest.headers) {
                            originalRequest.headers.Authorization = `Bearer ${token}`;
                        }
                        return apiClient(originalRequest);
                    })
                    .catch((err) => {
                        return Promise.reject(err);
                    });
            }

            originalRequest._retry = true;
            isRefreshing = true;

            const refreshToken = localStorage.getItem("refresh_token");

            if (!refreshToken) {
                // No refresh token, clear and redirect to login
                localStorage.removeItem("auth_token");
                processQueue(error, null);
                isRefreshing = false;
                if (typeof window !== "undefined") {
                    window.location.href = "/login";
                }
                return Promise.reject(error);
            }

            try {
                // Try to refresh the token
                const response = await axios.post(
                    `${API_BASE_URL}/auth/refresh`,
                    { refresh_token: refreshToken }
                );

                const { access_token, refresh_token: newRefreshToken } = response.data;

                // Update tokens in localStorage
                localStorage.setItem("auth_token", access_token);
                if (newRefreshToken) {
                    localStorage.setItem("refresh_token", newRefreshToken);
                }

                // Update auth store if available
                if (typeof window !== "undefined") {
                    const { useAuthStore } = await import("@/stores/auth-store");
                    useAuthStore.getState().setTokens(access_token, newRefreshToken || refreshToken);
                }

                // Update the original request with new token
                if (originalRequest.headers) {
                    originalRequest.headers.Authorization = `Bearer ${access_token}`;
                }

                // Process queued requests
                processQueue(null, access_token);
                isRefreshing = false;

                // Retry the original request
                return apiClient(originalRequest);
            } catch (refreshError) {
                // Refresh failed, clear tokens and redirect to login
                processQueue(refreshError as AxiosError, null);
                isRefreshing = false;
                localStorage.removeItem("auth_token");
                localStorage.removeItem("refresh_token");
                if (typeof window !== "undefined") {
                    window.location.href = "/login";
                }
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);

export default apiClient;
