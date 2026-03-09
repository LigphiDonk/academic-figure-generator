import { useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { LogOut, LayoutDashboard, Palette, Activity, Settings, Zap, Shield, Users, Menu, X, Github, ExternalLink, Star } from 'lucide-react';
import { Button } from './ui/button';

const REPO_URL = 'https://github.com/LigphiDonk/academic-figure-generator';

type NavItem = {
    name: string;
    path: string;
    icon: typeof LayoutDashboard;
};

type SidebarContentProps = {
    displayName: string;
    handleLogout: () => void;
    initials: string;
    locationPathname: string;
    navItems: NavItem[];
    setSidebarOpen: (open: boolean) => void;
    user: ReturnType<typeof useAuthStore.getState>['user'];
};

function SidebarContent({
    displayName,
    handleLogout,
    initials,
    locationPathname,
    navItems,
    setSidebarOpen,
    user,
}: SidebarContentProps) {
    return (
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
                    const isActive = locationPathname.startsWith(item.path);
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
                    <a
                        href={REPO_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group mb-3 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-3 transition-colors hover:border-primary/35 hover:bg-primary/10"
                    >
                        <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Github className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <span>GitHub 仓库</span>
                                <Star className="h-3.5 w-3.5 text-primary" />
                            </div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                觉得好用的话，点进来给项目加个 Star。
                            </p>
                        </div>
                        <ExternalLink className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                    </a>
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
}

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

    return (
        <div className="min-h-screen flex bg-muted/30">
            {/* Desktop Sidebar */}
            <aside className="hidden md:flex flex-col w-[260px] flex-shrink-0 fixed inset-y-0 left-0 z-20 bg-muted/50 border-r border-border/60">
                <SidebarContent
                    displayName={displayName}
                    handleLogout={handleLogout}
                    initials={initials}
                    locationPathname={location.pathname}
                    navItems={navItems}
                    setSidebarOpen={setSidebarOpen}
                    user={user}
                />
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
                <SidebarContent
                    displayName={displayName}
                    handleLogout={handleLogout}
                    initials={initials}
                    locationPathname={location.pathname}
                    navItems={navItems}
                    setSidebarOpen={setSidebarOpen}
                    user={user}
                />
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
