import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchRuns, fetchPendingApprovals } from '../api.js';

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen]               = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread]           = useState(0);
  const [lastSeen, setLastSeen]       = useState(() => {
    return localStorage.getItem('tank_recon_last_seen') || '';
  });
  const panelRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [runs, pending] = await Promise.all([
        fetchRuns({ top: 10 }),
        fetchPendingApprovals()
      ]);

      // Build pending count per run
      const pendingByRun = {};
      pending.forEach(t => {
        pendingByRun[t.run_ID] = (pendingByRun[t.run_ID] || 0) + 1;
      });

      const notes = runs.map(r => ({
        id:           r.ID,
        runDate:      r.runDate,
        status:       r.status,
        tankCount:    r.tankCount || 0,
        okCount:      r.okCount   || 0,
        flagCount:    r.flagCount || 0,
        urgentCount:  r.urgentCount || 0,
        pendingCount: pendingByRun[r.ID] || 0,
        triggeredAt:  r.triggeredAt,
      })).filter(r => r.status === 'COMPLETED' || r.status === 'FAILED');

      setNotifications(notes);
      // Unread = runs with still-pending approvals or new runs since last seen
      const newCount = notes.filter(n => n.triggeredAt > lastSeen || n.pendingCount > 0).length;
      setUnread(pending.length); // show actual pending approval count
    } catch (_) {}
  }, [lastSeen]);

  useEffect(() => { load(); }, [load]);

  // Poll every 30 seconds for new runs
  useEffect(() => {
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  // Close panel when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleOpen() {
    setOpen(o => !o);
    if (!open) {
      const now = new Date().toISOString();
      setLastSeen(now);
      localStorage.setItem('tank_recon_last_seen', now);
      setUnread(0);
    }
  }

  function statusEmoji(r) {
    if (r.status === 'FAILED') return '⛔';
    if (r.pendingCount > 0)    return '🔴';
    if (r.urgentCount > 0)     return '🟡';
    if (r.flagCount > 0)       return '🟡';
    return '🟢';
  }

  function statusColor(r) {
    if (r.status === 'FAILED') return '#bb0000';
    if (r.pendingCount > 0)    return '#bb0000';
    if (r.urgentCount > 0)     return '#e76e00';
    return '#188425';
  }

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={handleOpen}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          position: 'relative', padding: '0.25rem 0.5rem', fontSize: '1.3rem',
          color: '#fff', display: 'flex', alignItems: 'center'
        }}
        title="Reconciliation Notifications"
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: '-2px', right: '-2px',
            background: '#bb0000', color: '#fff', borderRadius: '50%',
            fontSize: '0.65rem', minWidth: '16px', height: '16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, padding: '0 3px'
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Notification panel */}
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%', width: '360px',
          background: '#fff', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          zIndex: 1000, overflow: 'hidden', border: '1px solid #dde'
        }}>
          {/* Header */}
          <div style={{
            background: '#003b6e', color: '#fff',
            padding: '0.75rem 1rem', fontWeight: 700, fontSize: '0.95rem',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <span>🔔 Reconciliation Alerts</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#ccd' }}>
              {notifications.length} run{notifications.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Notification list */}
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: '#888', fontSize: '0.9rem' }}>
                No completed runs yet
              </div>
            ) : notifications.map((n, i) => (
              <div key={n.id}
                onClick={() => {
                  setOpen(false);
                  if (n.urgentCount > 0) {
                    navigate('/approvals');
                  } else {
                    navigate(`/runs/${n.id}`);
                  }
                }}
                style={{
                  padding: '0.75rem 1rem',
                  borderBottom: i < notifications.length - 1 ? '1px solid #f0f0f0' : 'none',
                  background: n.triggeredAt > lastSeen && i < unread ? '#fffbf0' : '#fff',
                  cursor: 'pointer'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f5f8ff'}
                onMouseLeave={e => e.currentTarget.style.background = n.triggeredAt > lastSeen && i < unread ? '#fffbf0' : '#fff'}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9rem', color: statusColor(n) }}>
                    {statusEmoji(n)} Run {n.runDate}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#888', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    {n.triggeredAt ? new Date(n.triggeredAt).toLocaleTimeString() : ''}
                    <span style={{ color: '#0070f2' }}>›</span>
                  </span>
                </div>
                <div style={{ fontSize: '0.82rem', color: '#444', lineHeight: 1.6 }}>
                  <span style={{ marginRight: '0.75rem' }}>🛢 {n.tankCount} tanks</span>
                  {n.okCount > 0 && <span style={{ marginRight: '0.5rem', color: '#188425' }}>✓ {n.okCount} OK</span>}
                  {n.flagCount > 0 && <span style={{ marginRight: '0.5rem', color: '#e76e00' }}>⚑ {n.flagCount} FLAG</span>}
                  {n.urgentCount > 0 && <span style={{ color: '#bb0000' }}>⚡ {n.urgentCount} URGENT</span>}
                </div>
                {n.pendingCount > 0 && (
                  <div style={{
                    marginTop: '0.4rem', fontSize: '0.78rem', color: '#bb0000',
                    background: '#fff0f0', padding: '0.25rem 0.5rem', borderRadius: '4px'
                  }}>
                    ⚠️ {n.pendingCount} tank{n.pendingCount > 1 ? 's' : ''} pending approval → click to review
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{
            padding: '0.5rem 1rem', background: '#f8f9fa', borderTop: '1px solid #eee',
            fontSize: '0.75rem', color: '#888', textAlign: 'center'
          }}>
            Updates every 30 seconds
          </div>
        </div>
      )}
    </div>
  );
}
