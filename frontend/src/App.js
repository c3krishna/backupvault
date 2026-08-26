// frontend/src/App.js
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WSProvider, useWS } from './context/WSContext';
import { ThemeProvider, useTheme, THEMES } from './context/ThemeContext';
import { ToastContainer } from './components/UI';
import Sidebar from './components/Sidebar';

import { LoginPage, RegisterPage } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Targets from './pages/Targets';
import Jobs from './pages/Jobs';
import Destinations from './pages/Destinations';
import SFTPExplorer from './pages/SFTPExplorer';
import { HistoryPage, LiveLogsPage } from './pages/History';
import BackupStrategy from './pages/BackupStrategy';
import S3Browser from './pages/S3Browser';
import OCIBrowser from './pages/OCIBrowser';
import CloudRegions from './pages/CloudRegions';
import RestoreDB from './pages/RestoreDB';
import NFSServers from './pages/NFSServers';
import MonitoringDashboard from './pages/MonitoringDashboard';
import ActivityCenter from './pages/ActivityCenter';
import IncrementalBackup from './pages/IncrementalBackup';
import QueryExecution from './pages/QueryExecution';
import ReportRunner   from './pages/ReportRunner';
import { StoragePage, PrimaryDCPage, SecondaryDCPage, SettingsPage, UsersPage } from './pages/Storage';

import './index.css';

// ── THEME SWITCHER BAR ────────────────────────────────────────────────────────
function ThemeSwitcher() {
  const { theme, setTheme, saving } = useTheme();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
    }}>
      {saving && (
        <span style={{ fontSize: 10, color: 'var(--bv-txt3)', marginRight: 4 }}>
          <i className="ti ti-loader" style={{ animation: 'bvspin .7s linear infinite', fontSize: 11 }}/> saving...
        </span>
      )}
      {Object.entries(THEMES).map(([key, t]) => {
        const active = theme === key;
        return (
          <button key={key} onClick={() => setTheme(key)} title={`Switch to ${t.label} theme`}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 11px', borderRadius: 20,
              border: active ? '1px solid var(--bv-blue)' : '1px solid var(--bv-bd)',
              background: active ? 'var(--bv-blue-dim)' : 'transparent',
              color: active ? 'var(--bv-blue)' : 'var(--bv-txt2)',
              fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              fontWeight: active ? 600 : 400,
              transition: 'all .15s',
            }}>
            <i className={`ti ti-${t.icon}`} style={{ fontSize: 13 }}/>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── REQUIRE AUTH ──────────────────────────────────────────────────────────────
function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace/>;
}

// ── MAIN LAYOUT ───────────────────────────────────────────────────────────────
function Layout() {
  const { connected } = useWS();

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      background: 'var(--bv-bg)', color: 'var(--bv-txt)',
    }}>
      <Sidebar wsConnected={connected}/>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Top bar — theme switcher only (no page content here) */}
        <div style={{
          borderBottom: '1px solid var(--bv-bd)',
          background: 'var(--bv-bg2)',
          padding: '5px 16px 5px 56px', // 56px left = hamburger button width on mobile
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          flexShrink: 0, gap: 12,
        }}>
          <span style={{ fontSize: 11, color: 'var(--bv-txt3)' }}>
            <i className="ti ti-palette" style={{ fontSize: 12, marginRight: 4 }}/>
            Theme
          </span>
          <ThemeSwitcher/>
        </div>

        {/* Page content — column so every route stretches to full width */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Routes>
            <Route path="/dashboard"    element={<Dashboard/>}/>
            <Route path="/targets"      element={<Targets/>}/>
            <Route path="/nfs-servers"   element={<NFSServers/>}/>
            <Route path="/monitoring"     element={<MonitoringDashboard/>}/>
            <Route path="/activity"      element={<ActivityCenter/>}/>
            <Route path="/jobs"         element={<Jobs/>}/>
            <Route path="/incremental"  element={<IncrementalBackup/>}/>
            <Route path="/destinations" element={<Destinations/>}/>
            <Route path="/primary-dc"   element={<PrimaryDCPage/>}/>
            <Route path="/secondary"    element={<SecondaryDCPage/>}/>
            <Route path="/remote"       element={<SFTPExplorer/>}/>
            <Route path="/aws-s3"       element={<S3Browser/>}/>
            <Route path="/oci-storage"   element={<OCIBrowser/>}/>
            <Route path="/cloud-regions"  element={<CloudRegions/>}/>
            <Route path="/restore"         element={<RestoreDB/>}/>
            <Route path="/history"      element={<HistoryPage/>}/>
            <Route path="/live-logs"    element={<LiveLogsPage/>}/>
            <Route path="/users"        element={<UsersPage/>}/>
            <Route path="/settings"     element={<SettingsPage/>}/>
            <Route path="/strategy"     element={<BackupStrategy/>}/>
            <Route path="/query"        element={<QueryExecution/>}/>
            <Route path="/reports"      element={<ReportRunner/>}/>
            <Route path="*"             element={<Navigate to="/dashboard" replace/>}/>
          </Routes>
        </div>
      </div>
    </div>
  );
}

// ── AUTHENTICATED APP (WS + Layout) ──────────────────────────────────────────
function AuthenticatedApp() {
  return (
    <WSProvider>
      <Layout/>
    </WSProvider>
  );
}

// ── APP ROOT — ThemeProvider wraps everything ─────────────────────────────────
// applyFromLogin is called from AuthProvider when login response includes preferences
function AppWithTheme() {
  const { applyFromLogin } = useTheme();
  const onPreferences = useCallback((prefs) => {
    applyFromLogin(prefs);
  }, [applyFromLogin]);

  return (
    <AuthProvider onPreferences={onPreferences}>
      <BrowserRouter>
        <Routes>
          <Route path="/login"    element={<LoginPage/>}/>
          <Route path="/register" element={<RegisterPage/>}/>
          <Route path="/*" element={
            <RequireAuth>
              <AuthenticatedApp/>
            </RequireAuth>
          }/>
        </Routes>
        <ToastContainer/>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppWithTheme/>
    </ThemeProvider>
  );
}
