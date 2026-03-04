import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Alert, AlertDescription } from '../components/ui/alert';

export function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [oauthConfigured, setOauthConfigured] = useState<boolean | null>(null);
    const setAuth = useAuthStore((state) => state.setAuth);
    const navigate = useNavigate();

    // Check if LinuxDO OAuth is configured
    useEffect(() => {
        api.get('/auth/linuxdo/status')
            .then((res) => setOauthConfigured(res.data.configured))
            .catch(() => setOauthConfigured(false));
    }, []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            const response = await api.post('/auth/login', { email, password });
            const { access_token, refresh_token } = response.data;

            // Fetch user profile
            const userResponse = await api.get('/auth/me', {
                headers: { Authorization: `Bearer ${access_token}` }
            });

            setAuth(access_token, refresh_token, userResponse.data);
            navigate('/projects');
        } catch (err: any) {
            setError(err.response?.data?.detail || '登录失败，请检查您的邮箱和密码。');
        } finally {
            setIsLoading(false);
        }
    };

    const handleLinuxDOLogin = () => {
        window.location.href = '/api/v1/auth/linuxdo/authorize';
    };

    return (
        <div className="min-h-screen flex">
            {/* Left decorative panel */}
            <div
                className="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12 overflow-hidden"
                style={{
                    background: 'linear-gradient(135deg, #0a0f1e 0%, #0d1b3e 30%, #0f2460 55%, #1a2f72 75%, #0e1a4a 100%)',
                }}
            >
                {/* Dot grid pattern overlay */}
                <div
                    className="absolute inset-0 opacity-20"
                    style={{
                        backgroundImage: 'radial-gradient(circle, #6b9fff 1px, transparent 1px)',
                        backgroundSize: '32px 32px',
                    }}
                />

                {/* Soft glow blobs */}
                <div
                    className="absolute top-1/4 left-1/3 w-72 h-72 rounded-full opacity-20 blur-3xl pointer-events-none"
                    style={{ background: 'radial-gradient(circle, #3b82f6, transparent)' }}
                />
                <div
                    className="absolute bottom-1/4 right-1/4 w-56 h-56 rounded-full opacity-15 blur-3xl pointer-events-none"
                    style={{ background: 'radial-gradient(circle, #818cf8, transparent)' }}
                />

                {/* Top: Logo + App name */}
                <div className="relative z-10 flex items-center gap-3">
                    <img
                        src="/logo.jpg"
                        alt="Logo"
                        className="w-10 h-10 rounded-xl object-cover"
                        style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.12)' }}
                    />
                    <span className="text-white font-semibold text-base tracking-tight">
                        科研配图生成器
                    </span>
                </div>

                {/* Center: tagline */}
                <div className="relative z-10 space-y-5">
                    <h2
                        className="text-4xl font-bold leading-tight text-white"
                        style={{ letterSpacing: '-0.02em' }}
                    >
                        让学术图表<br />
                        <span style={{ color: '#93c5fd' }}>精准传达</span><br />
                        您的研究成果
                    </h2>
                    <p className="text-base leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
                        智能生成符合顶级期刊规范的<br />
                        专业学术配图，一键导出，即刻投稿。
                    </p>
                </div>

                {/* Bottom: subtle footer */}
                <div className="relative z-10">
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
                        © 2025 科研配图生成器. All rights reserved.
                    </p>
                </div>
            </div>

            {/* Right form panel */}
            <div className="flex-1 flex items-center justify-center bg-white px-6 py-12">
                <div className="w-full max-w-sm">
                    {/* Mobile-only logo */}
                    <div className="flex justify-center mb-8 lg:hidden">
                        <img src="/logo.jpg" alt="Logo" className="w-12 h-12 rounded-xl object-cover" />
                    </div>

                    {/* Heading */}
                    <div className="mb-8">
                        <h1
                            className="text-3xl font-bold text-gray-900 mb-2"
                            style={{ letterSpacing: '-0.025em' }}
                        >
                            欢迎回来
                        </h1>
                        <p className="text-sm text-gray-500">
                            {oauthConfigured ? '使用 Linux DO 账号登录' : '请输入您的账号信息以继续'}
                        </p>
                    </div>

                    {/* Error alert */}
                    {error && (
                        <div className="mb-6">
                            <Alert variant="destructive" className="border-red-200 bg-red-50 text-red-700 rounded-xl">
                                <AlertDescription className="text-sm">{error}</AlertDescription>
                            </Alert>
                        </div>
                    )}

                    {/* Loading state while checking OAuth config */}
                    {oauthConfigured === null && (
                        <div className="flex items-center justify-center py-12">
                            <svg
                                className="animate-spin h-6 w-6 text-gray-400"
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                            >
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                        </div>
                    )}

                    {/* OAuth configured: show Linux DO login button */}
                    {oauthConfigured === true && (
                        <div className="space-y-5">
                            <Button
                                onClick={handleLinuxDOLogin}
                                className="w-full h-12 rounded-xl text-sm font-semibold tracking-wide transition-all duration-200 flex items-center justify-center gap-3"
                                style={{
                                    background: '#111827',
                                    color: '#ffffff',
                                    border: 'none',
                                }}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
                                </svg>
                                使用 Linux DO 登录
                            </Button>
                        </div>
                    )}

                    {/* OAuth NOT configured: show email/password form for admin bootstrap */}
                    {oauthConfigured === false && (
                        <>
                            <form onSubmit={handleLogin} className="space-y-5">
                                <div className="space-y-1.5">
                                    <Label
                                        htmlFor="email"
                                        className="text-sm font-medium text-gray-700"
                                    >
                                        邮箱地址
                                    </Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="you@example.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        className="h-11 px-4 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 placeholder:text-gray-400 focus:bg-white focus:border-gray-400 focus:ring-0 transition-colors duration-200"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <Label
                                        htmlFor="password"
                                        className="text-sm font-medium text-gray-700"
                                    >
                                        密码
                                    </Label>
                                    <Input
                                        id="password"
                                        type="password"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        className="h-11 px-4 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 placeholder:text-gray-400 focus:bg-white focus:border-gray-400 focus:ring-0 transition-colors duration-200"
                                    />
                                </div>

                                <Button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full h-11 rounded-xl text-sm font-semibold tracking-wide transition-all duration-200"
                                    style={{
                                        background: isLoading ? '#374151' : '#111827',
                                        color: '#ffffff',
                                        border: 'none',
                                    }}
                                >
                                    {isLoading ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <svg
                                                className="animate-spin h-4 w-4 text-white"
                                                xmlns="http://www.w3.org/2000/svg"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                            >
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                            </svg>
                                            登录中...
                                        </span>
                                    ) : (
                                        '管理员登录'
                                    )}
                                </Button>
                            </form>

                            <p className="mt-6 text-center text-xs text-gray-400">
                                管理员首次登录后，请在系统管理中配置 Linux DO OAuth
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
