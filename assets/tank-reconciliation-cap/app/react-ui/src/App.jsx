import React from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import Dashboard     from './pages/Dashboard.jsx';
import TankDetail    from './pages/TankDetail.jsx';
import ApprovalQueue from './pages/ApprovalQueue.jsx';
import AuditTrail    from './pages/AuditTrail.jsx';
import Configuration from './pages/Configuration.jsx';
import TrendChart    from './pages/TrendChart.jsx';
import AiChat        from './pages/AiChat.jsx';
import { AuthProvider, useAuth } from './AuthContext.jsx';

function ProtectedRoute({ children, requireSupervisor, requireAdmin }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading…</div>;
  if (requireAdmin && !user?.isAdmin)
    return <div className="error-banner" style={{ margin: '2rem' }}>⛔ Access denied — Administrator role required.</div>;
  if (requireSupervisor && !user?.isSupervisor)
    return <div className="error-banner" style={{ margin: '2rem' }}>⛔ Access denied — Supervisor role required.</div>;
  return children;
}

function AppShell() {
  const { user } = useAuth();

  const NAV_ITEMS = [
    { to: '/',              label: '🏠 Dashboard',       end: true,  show: true },
    { to: '/approvals',     label: '✅ Approval Queue',              show: user?.isSupervisor },
    { to: '/audit',         label: '📋 Audit Trail',                show: true },
    { to: '/trends',        label: '📈 Variance Trends',            show: true },
    { to: '/configuration', label: '⚙️  Configuration',            show: user?.isAdmin },
    { to: '/chat',          label: '💬 AI Assistant',               show: true },
  ];

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <nav className="nav-sidebar">
        <div className="nav-logo">🛢 TankRecon</div>
        {NAV_ITEMS.filter(n => n.show).map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            {label}
          </NavLink>
        ))}
        <div style={{ marginTop: 'auto', padding: '1rem 1.25rem', fontSize: '0.7rem', color: '#adb5bd' }}>
          {user ? `👤 ${user.id}` : ''}
        </div>
        <div style={{ padding: '0 1.25rem 1rem', fontSize: '0.7rem', color: '#adb5bd' }}>
          Tank Reconciliation v1.0
        </div>
      </nav>

      {/* Main content */}
      <div className="app-main">
        <div className="app-topbar">
          <span>⛽ Hydrocarbon Tank Stock Reconciliation Cockpit</span>
        </div>
        <div className="shell-content">
          <Routes>
            <Route path="/"                element={<Dashboard />} />
            <Route path="/runs/:runId"     element={<TankDetail />} />
            <Route path="/approvals"       element={
              <ProtectedRoute requireSupervisor>
                <ApprovalQueue />
              </ProtectedRoute>
            } />
            <Route path="/audit"           element={<AuditTrail />} />
            <Route path="/trends"          element={<TrendChart />} />
            <Route path="/configuration"   element={
              <ProtectedRoute requireAdmin>
                <Configuration />
              </ProtectedRoute>
            } />
            <Route path="/chat"            element={<AiChat />} />
            <Route path="*"               element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
