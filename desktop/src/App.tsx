import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Projects } from './pages/Projects';
import { ProjectWorkspace } from './pages/ProjectWorkspace';
import { ColorSchemes } from './pages/ColorSchemes';
import { Usage } from './pages/Usage';
import { Settings } from './pages/Settings';
import { Generate } from './pages/Generate';
import { Setup } from './pages/Setup';
import { useSettingsStore } from './store/settingsStore';

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,_#f7f2e8_0%,_#ffffff_50%,_#f8fafc_100%)]">
      <div className="rounded-3xl border border-white/70 bg-white/85 px-6 py-4 text-sm text-slate-600 shadow-xl">
        正在加载本地桌面工作区...
      </div>
    </div>
  );
}

function App() {
  const isLoaded = useSettingsStore((state) => state.isLoaded);
  const load = useSettingsStore((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isLoaded) return <LoadingScreen />;

  return (
    <HashRouter>
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectWorkspace />} />
          <Route path="/generate" element={<Generate />} />
          <Route path="/color-schemes" element={<ColorSchemes />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
