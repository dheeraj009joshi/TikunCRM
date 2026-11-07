import axios, { AxiosError } from "axios";
import { API_BASE_URL } from "@/lib/api-client";

export const PARTNER_TOKEN_KEY = "partner_token";

export const partnerClient = axios.create({
    baseURL: API_BASE_URL,
    headers: { "Content-Type": "application/json" },
    timeout: 30_000,
});

partnerClient.interceptors.request.use((config) => {
    if (typeof window !== "undefined") {
        const token = localStorage.getItem(PARTNER_TOKEN_KEY);
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
    }
    return config;
});

partnerClient.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
        if (error.response?.status === 401 && typeof window !== "undefined") {
            localStorage.removeItem(PARTNER_TOKEN_KEY);
            if (!window.location.pathname.startsWith("/partner/login")) {
                window.location.href = "/partner/login";
            }
        }
        return Promise.reject(error);
    }
);
