import { useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { LogOut, LayoutDashboard, Palette, Activity, Settings, Zap, Shield, Users, Menu, X } from 'lucide-react';
import { Button } from './ui/button';

export function Layout() {
    const logout = useAuthStore((state) => state.logout);
    const user = useAuthStore((state) => state.user);
    const navigate = useNavigate();
    const location = useLocation();
    const [sidebarOpen, setSidebarOpen] = useState(false);

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
        ...(user?.is_admin ? [
            { name: '系统管理', path: '/admin/settings', icon: Shield },
            { name: '用户管理', path: '/admin/users', icon: Users },
        ] : []),
    ];

    const displayName = user?.linuxdo_username || user?.display_name || user?.email || '';
    const initials = displayName
        ? displayName.slice(0, 2).toUpperCase()
        : 'U';

    const SidebarContent = () => (
        <div className="flex flex-col h-full">
            {/* Logo + App Name */}
            <div className="px-4 py-5 flex items-center space-x-3">
                <Link
                    to="/projects"
                    className="flex items-center space-x-3 group"
                    onClick={() => setSidebarOpen(false)}
                >
                    <img src="/logo.jpg" alt="Logo" className="w-8 h-8 rounded-lg flex-shrink-0" />
                    <span className="font-semibold text-sm text-foreground leading-tight group-hover:text-primary transition-colors">
                        科研配图生成器
                    </span>
                </Link>
            </div>

            {/* Divider */}
            <div className="mx-3 mb-2 h-px bg-border/60" />

            {/* Nav Items */}
            <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
                {navItems.map((item) => {
                    const isActive = location.pathname.startsWith(item.path);
                    return (
                        <Link
                            key={item.path}
                            to={item.path}
                            onClick={() => setSidebarOpen(false)}
                            className={`
                                flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium
                                transition-all duration-150 group relative
                                ${isActive
                                    ? 'bg-background text-foreground shadow-sm border border-border/50'
                                    : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                                }
                            `}
                        >
                            {isActive && (
                                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-full" />
                            )}
                            <item.icon
                                className={`w-4 h-4 flex-shrink-0 transition-colors ${
                                    isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                                }`}
                            />
                            <span>{item.name}</span>
                        </Link>
                    );
                })}
            </nav>

            {/* User Section */}
            <div className="mt-auto">
                <div className="mx-3 mb-3 h-px bg-border/60" />
                <div className="px-3 pb-4 space-y-1">
                    {/* User Identity */}
                    <div className="flex items-center space-x-3 px-2 py-2 rounded-lg">
                        {/* Avatar */}
                        {user?.linuxdo_avatar_url ? (
                            <img
                                src={user.linuxdo_avatar_url}
                                alt="avatar"
                                className="w-7 h-7 rounded-full flex-shrink-0 object-cover"
                            />
                        ) : (
                            <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                                <span className="text-xs font-semibold text-primary leading-none">
                                    {initials}
                                </span>
                            </div>
                        )}
                        <span className="text-sm font-medium text-foreground truncate flex-1 min-w-0">
                            {displayName}
                        </span>
                    </div>
                    {/* Logout */}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleLogout}
                        className="w-full justify-start px-2 text-muted-foreground hover:text-destructive hover:bg-destructive/5 text-sm font-medium"
                    >
                        <LogOut className="w-4 h-4 mr-3 flex-shrink-0" />
                        退出登录
                    </Button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen flex bg-muted/30">
            {/* Desktop Sidebar */}
            <aside className="hidden md:flex flex-col w-[260px] flex-shrink-0 fixed inset-y-0 left-0 z-20 bg-muted/50 border-r border-border/60">
                <SidebarContent />
            </aside>

            {/* Mobile Overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Mobile Sidebar Drawer */}
            <aside
                className={`
                    fixed inset-y-0 left-0 z-40 w-[260px] flex flex-col
                    bg-muted/95 backdrop-blur border-r border-border/60
                    transform transition-transform duration-200 ease-in-out
                    md:hidden
                    ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                `}
            >
                {/* Mobile close button */}
                <button
                    className="absolute top-4 right-3 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors"
                    onClick={() => setSidebarOpen(false)}
                    aria-label="Close sidebar"
                >
                    <X className="w-4 h-4" />
                </button>
                <SidebarContent />
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col md:ml-[260px] min-w-0">
                {/* Mobile Top Bar */}
                <div className="md:hidden flex items-center px-4 h-14 border-b border-border/60 bg-background sticky top-0 z-10">
                    <button
                        className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mr-3"
                        onClick={() => setSidebarOpen(true)}
                        aria-label="Open sidebar"
                    >
                        <Menu className="w-5 h-5" />
                    </button>
                    <Link to="/projects" className="flex items-center space-x-2">
                        <img src="/logo.jpg" alt="Logo" className="w-6 h-6 rounded" />
                        <span className="font-semibold text-sm text-foreground">科研配图生成器</span>
                    </Link>
                </div>

                {/* Page Content */}
                <main className="flex-1 px-6 py-8 md:px-8 bg-background min-h-screen">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
