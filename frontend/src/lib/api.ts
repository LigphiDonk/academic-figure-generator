import axios, { AxiosHeaders } from 'axios';
import { useAuthStore } from '../store/authStore';

export const api = axios.create({
    baseURL: '/api/v1',
});

function setAuthHeader(token: string | null) {
    const headers: any = api.defaults.headers.common as any;
    if (token) {
        if (typeof headers.set === 'function') {
            headers.set('Authorization', `Bearer ${token}`);
        } else {
            headers.Authorization = `Bearer ${token}`;
        }
        return;
    }

    if (typeof headers.delete === 'function') {
        headers.delete('Authorization');
    } else {
        delete headers.Authorization;
    }
}

// Keep axios default auth header in sync with zustand store (covers cases where
// per-request header mutation doesn't stick due to AxiosHeaders internals).
setAuthHeader(useAuthStore.getState().token);
useAuthStore.subscribe((state, prev) => {
    if (state.token !== prev.token) setAuthHeader(state.token);
});

api.interceptors.request.use(
    (config) => {
        const token = useAuthStore.getState().token;
        if (token) {
            config.headers ??= new AxiosHeaders();
            // Axios v1 may use AxiosHeaders; support both styles.
            const headers: any = config.headers as any;
            if (typeof headers.set === 'function') {
                headers.set('Authorization', `Bearer ${token}`);
            } else {
                headers.Authorization = `Bearer ${token}`;
            }
        }

        // If we send FormData, let the browser/axios set the multipart boundary.
        // Also ensure we don't carry over a JSON content-type from previous defaults.
        const headersAny: any = config.headers as any;
        const isFormData = typeof FormData !== 'undefined' && config.data instanceof FormData;
        if (isFormData) {
            if (typeof headersAny?.delete === 'function') {
                headersAny.delete('Content-Type');
            } else if (headersAny) {
                delete headersAny['Content-Type'];
                delete headersAny['content-type'];
            }
        } else {
            // For JSON bodies, explicitly set content-type for consistency.
            const isPlainObject =
                config.data != null &&
                typeof config.data === 'object' &&
                !(config.data instanceof ArrayBuffer) &&
                !(config.data instanceof Blob) &&
                !(config.data instanceof URLSearchParams);
            if (isPlainObject) {
                if (typeof headersAny?.set === 'function') {
                    headersAny.set('Content-Type', 'application/json');
                } else if (headersAny) {
                    headersAny['Content-Type'] = 'application/json';
                }
            }
        }
        return config;
    },
    (error) => Promise.reject(error)
);

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // Handle 401 Unauthorized for token refresh
        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;

            try {
                const refreshToken = useAuthStore.getState().refreshToken;
                if (!refreshToken) {
                    throw new Error('No refresh token available');
                }

                // Use a separate axios instance to avoid interceptor loops
                const response = await axios.post('/api/v1/auth/refresh', {
                    refresh_token: refreshToken
                });

                const { access_token, refresh_token: new_refresh_token } = response.data;
                const user = useAuthStore.getState().user;

                if (access_token && new_refresh_token && user) {
                    useAuthStore.getState().setAuth(access_token, new_refresh_token, user);
                    originalRequest.headers ??= new AxiosHeaders();
                    const headers: any = originalRequest.headers as any;
                    if (typeof headers.set === 'function') {
                        headers.set('Authorization', `Bearer ${access_token}`);
                    } else {
                        headers.Authorization = `Bearer ${access_token}`;
                    }
                    return api(originalRequest);
                }
            } catch (refreshError) {
                // Refresh failed, logout user
                useAuthStore.getState().logout();
                window.location.href = '/login';
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);
