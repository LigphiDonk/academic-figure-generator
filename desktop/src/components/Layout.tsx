import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Activity, ExternalLink, FolderKanban, Github, Menu, Palette, Settings, Sparkles, Star, Workflow, X } from 'lucide-react';
import { useSettingsStore } from '../store/settingsStore';
import { openRepositoryUrl } from '../lib/runtime';
import { cn } from '../lib/utils';

const navItems = [
  { label: '项目列表', to: '/projects', icon: FolderKanban },
  { label: '直接生成', to: '/generate', icon: Sparkles },
  { label: '配色方案', to: '/color-schemes', icon: Palette },
  { label: '用量统计', to: '/usage', icon: Activity },
  { label: '设置', to: '/settings', icon: Settings },
];

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const settings = useSettingsStore((state) => state.publicSettings);

  const Sidebar = (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/50 px-5 py-5">
        <Link to="/projects" className="flex items-center gap-3" onClick={() => setSidebarOpen(false)}>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-300/60">
            <Workflow className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-medium text-slate-500">Academic Figure Generator</div>
            <div className="text-base font-semibold text-slate-900">Desktop Workspace</div>
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition',
                isActive ? 'bg-slate-900 text-white shadow-lg shadow-slate-300/70' : 'text-slate-600 hover:bg-white/80 hover:text-slate-950',
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/50 px-5 py-5 text-sm text-slate-500">
        <div className="font-medium text-slate-900">默认配置</div>
        <div className="mt-2">配色：{settings?.defaultColorScheme ?? 'okabe-ito'}</div>
        <div>分辨率：{settings?.defaultResolution ?? '2K'}</div>
        <div>比例：{settings?.defaultAspectRatio ?? '4:3'}</div>
        <button
          type="button"
          onClick={() => {
            void openRepositoryUrl();
          }}
          className="mt-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
        >
          <Github className="h-4 w-4 text-slate-900" />
          查看仓库并点个 Star
          <ExternalLink className="ml-auto h-4 w-4 text-slate-400" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f7f2e8_0%,_#ffffff_28%,_#f8fafc_100%)] text-slate-900">
      <aside className="fixed inset-y-0 left-0 hidden w-[290px] border-r border-white/60 bg-white/70 backdrop-blur-xl md:block">
        {Sidebar}
      </aside>

      {sidebarOpen ? <div className="fixed inset-0 z-30 bg-slate-950/25 md:hidden" onClick={() => setSidebarOpen(false)} /> : null}

      <aside className={cn('fixed inset-y-0 left-0 z-40 w-[290px] border-r border-white/60 bg-white/90 backdrop-blur-xl transition-transform md:hidden', sidebarOpen ? 'translate-x-0' : '-translate-x-full')}>
        <button type="button" className="absolute right-3 top-3 rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={() => setSidebarOpen(false)}>
          <X className="h-4 w-4" />
        </button>
        {Sidebar}
      </aside>

      <div className="md:ml-[290px]">
        <header className="sticky top-0 z-20 border-b border-white/60 bg-white/65 backdrop-blur-xl">
          <div className="flex items-center justify-between px-5 py-4 md:px-8">
            <div className="flex items-center gap-3">
              <button type="button" className="rounded-full border border-slate-200 bg-white p-2 text-slate-700 md:hidden" onClick={() => setSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </button>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Tauri-ready desktop</div>
                <div className="text-base font-semibold text-slate-900">本地科研配图工作台</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void openRepositoryUrl();
                }}
                className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-950 sm:flex"
              >
                <Github className="h-3.5 w-3.5" />
                GitHub
                <Star className="h-3.5 w-3.5 text-amber-500" />
              </button>
              <div className="rounded-full border border-white/60 bg-white/80 px-3 py-1.5 text-xs text-slate-500 shadow-sm">Desktop Dev Branch</div>
            </div>
          </div>
        </header>

        <main className="px-5 py-8 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
