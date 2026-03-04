import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../lib/api';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';

export function LinuxDOCallback() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const setAuth = useAuthStore((state) => state.setAuth);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const accessToken = searchParams.get('access_token');
        const refreshToken = searchParams.get('refresh_token');

        if (!accessToken || !refreshToken) {
            setError('缺少登录凭证，请重新登录。');
            setLoading(false);
            return;
        }

        // Fetch user profile with the received token
        api.get('/auth/me', {
            headers: { Authorization: `Bearer ${accessToken}` },
        })
            .then((res) => {
                setAuth(accessToken, refreshToken, res.data);
                navigate('/projects', { replace: true });
            })
            .catch((err) => {
                console.error('Failed to fetch user profile:', err);
                setError('登录失败，无法获取用户信息。请重试。');
                setLoading(false);
            });
    }, [searchParams, navigate, setAuth]);

    if (loading && !error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white">
                <div className="text-center space-y-4">
                    <svg
                        className="animate-spin h-8 w-8 text-gray-600 mx-auto"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                    >
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <p className="text-sm text-gray-500">正在完成登录...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-white px-6">
            <div className="w-full max-w-sm space-y-6">
                <Alert variant="destructive" className="border-red-200 bg-red-50 text-red-700 rounded-xl">
                    <AlertDescription className="text-sm">{error}</AlertDescription>
                </Alert>
                <Button
                    onClick={() => navigate('/login', { replace: true })}
                    className="w-full h-11 rounded-xl text-sm font-semibold"
                    style={{ background: '#111827', color: '#ffffff' }}
                >
                    返回登录
                </Button>
            </div>
        </div>
    );
}
