import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { LogOut, LayoutDashboard, Palette, Activity, Settings, Zap, Shield } from 'lucide-react';
import { Button } from './ui/button';

export function Layout() {
    const logout = useAuthStore((state) => state.logout);
    const user = useAuthStore((state) => state.user);
    const navigate = useNavigate();
    const location = useLocation();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const navItems = [
        { name: '项目列表', path: '/projects', icon: LayoutDashboard },
        { name: '配色管理', path: '/color-schemes', icon: Palette },
        { name: '用量看板', path: '/usage', icon: Activity },
        { name: '设置', path: '/settings', icon: Settings },
        { name: '快捷生成', path: '/generate', icon: Zap },
        ...(user?.is_admin ? [{ name: '系统管理', path: '/admin/settings', icon: Shield }] : []),
    ];

    return (
        <div className="min-h-screen flex flex-col bg-background">
            <header className="border-b sticky top-0 z-10 bg-background">
                <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center space-x-8">
                        <Link to="/projects" className="font-bold text-xl flex items-center space-x-2">
                            <img src="/logo.jpg" alt="Logo" className="w-7 h-7 rounded" />
                            <span className="text-primary">科研配图生成器</span>
                        </Link>
                        <nav className="hidden md:flex space-x-4">
                            {navItems.map((item) => (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${location.pathname.startsWith(item.path)
                                        ? 'bg-secondary/20 text-secondary-foreground'
                                        : 'text-muted-foreground hover:bg-secondary/10 hover:text-foreground'
                                        }`}
                                >
                                    <item.icon className="w-4 h-4" />
                                    <span>{item.name}</span>
                                </Link>
                            ))}
                        </nav>
                    </div>

                    <div className="flex items-center space-x-4">
                        <div className="text-sm font-medium text-muted-foreground">
                            {user?.display_name || user?.email}
                        </div>
                        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-destructive">
                            <LogOut className="w-4 h-4 mr-2" />
                            退出登录
                        </Button>
                    </div>
                </div>
            </header>

            <main className="flex-1 container mx-auto px-4 py-8">
                <Outlet />
            </main>
        </div>
    );
}
