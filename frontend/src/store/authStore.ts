import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
    id: number;
    email: string;
    display_name: string;
    is_active?: boolean;
    is_admin?: boolean;
    default_color_scheme?: string | null;
    default_resolution?: string | null;
    default_aspect_ratio?: string | null;
    prompt_ai_provider?: 'anthropic' | 'openai-compatible';
    prompt_ai_api_key_set?: boolean;
    prompt_ai_model?: string | null;
    nanobanana_api_key_set?: boolean;
    nanobanana_model?: string | null;
    paddleocr_api_key_set?: boolean;
    prompt_ai_api_base_url?: string | null;
    nanobanana_api_base_url?: string | null;
    paddleocr_server_url?: string | null;
    prompt_ai_tokens_quota?: number;
    nanobanana_images_quota?: number;
    linuxdo_id?: number | null;
    linuxdo_username?: string | null;
    linuxdo_avatar_url?: string | null;
    created_at?: string;
}

interface AuthState {
    token: string | null;
    refreshToken: string | null;
    user: User | null;
    setAuth: (token: string, refreshToken: string, user: User) => void;
    updateUser: (user: Partial<User>) => void;
    logout: () => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            token: null,
            refreshToken: null,
            user: null,
            setAuth: (token, refreshToken, user) => set({ token, refreshToken, user }),
            updateUser: (updates) => set((state) => ({
                user: state.user ? { ...state.user, ...updates } : null
            })),
            logout: () => set({ token: null, refreshToken: null, user: null }),
        }),
        {
            name: 'auth-storage',
        }
    )
);
