import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard } from './components/AuthGuard';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { LinuxDOCallback } from './pages/LinuxDOCallback';
import { Projects } from './pages/Projects';
import { ProjectWorkspace } from './pages/ProjectWorkspace';
import { ColorSchemes } from './pages/ColorSchemes';
import { Usage } from './pages/Usage';
import { Settings } from './pages/Settings';
import { Generate } from './pages/Generate';
import { AdminSettings } from './pages/AdminSettings';
import { AdminUsers } from './pages/AdminUsers';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/linuxdo/callback" element={<LinuxDOCallback />} />

        {/* Protected Routes */}
        <Route element={<AuthGuard />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectWorkspace />} />
            <Route path="/color-schemes" element={<ColorSchemes />} />
            <Route path="/usage" element={<Usage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/generate" element={<Generate />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
            <Route path="/admin/users" element={<AdminUsers />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
