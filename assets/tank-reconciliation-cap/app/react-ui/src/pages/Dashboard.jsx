import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchRuns, fetchPendingApprovals, triggerRun, retriggerDataCollection } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import KpiTile from '../components/KpiTile.jsx';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [triggerDate, setTriggerDate] = useState(todayIso());
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState(null);
  const [retriggering, setRetriggering] = useState(null);
  const [pendingUrgent, setPendingUrgent] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, pending] = await Promise.all([
        fetchRuns({ top: 30 }),
        fetchPendingApprovals()
      ]);
      setRuns(data);
      setPendingUrgent(pending.length);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // KPIs
  const latest = runs[0];
  const totalTanks      = latest?.tankCount ?? 0;
  const awaitingApproval = runs.filter(r => r.status === 'AWAITING_APPROVAL').length;
  const failedRuns      = runs.filter(r => r.status === 'FAILED').length;

  // R11: Re-trigger data collection for a FAILED or PENDING run
  async function handleRetrigger(runId, runDate) {
    setRetriggering(runId);
    try {
      await retriggerDataCollection(runId);
      setTriggerMsg({ type: 'success', text: `Data collection re-triggered for run ${runDate}.` });
      await load();
    } catch (err) {
      setTriggerMsg({ type: 'error', text: `Re-trigger failed: ${err.message}` });
    } finally {
      setRetriggering(null);
    }
  }

  async function handleTrigger(e) {
    e.preventDefault();
    setTriggering(true);
    setTriggerMsg(null);
    try {
      const result = await triggerRun(triggerDate);
      setTriggerMsg({ type: 'success', text: `Run ${result.runId?.slice(0, 8)}… triggered for ${triggerDate}` });
      await load();
    } catch (err) {
      setTriggerMsg({ type: 'error', text: err.message });
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Reconciliation Dashboard</h1>

      {/* KPI tiles */}
      <div className="kpi-grid">
        <KpiTile label="Total Runs"        value={runs.length}       onClick={() => navigate('/')} />
        <KpiTile label="Latest Tanks"      value={totalTanks}        onClick={() => navigate('/configuration')} />
        <KpiTile label="Urgent Variances"  value={pendingUrgent}     className={pendingUrgent > 0 ? 'urgent' : ''}  onClick={() => navigate('/approvals')} />
        <KpiTile label="Awaiting Approval" value={awaitingApproval}  className={awaitingApproval > 0 ? 'flag' : ''} onClick={() => navigate('/approvals')} />
        <KpiTile label="Failed Runs"       value={failedRuns}        className={failedRuns > 0 ? 'urgent' : ''}  onClick={() => navigate('/')} />
      </div>

      {/* Trigger new run */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-header">Trigger New Reconciliation Run</div>
        <div className="card-body">
          <form onSubmit={handleTrigger}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="run-date">Run Date</label>
                <input
                  id="run-date"
                  type="date"
                  className="input"
                  value={triggerDate}
                  onChange={e => setTriggerDate(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={triggering}>
                {triggering ? 'Triggering…' : '⚡ Trigger Run'}
              </button>
              <button type="button" className="btn btn-outline" onClick={load}>↻ Refresh</button>
            </div>
            {triggerMsg && (
              <div className={triggerMsg.type === 'success' ? 'badge badge-ok' : 'error-banner'}
                   style={{ display: 'block', padding: '0.5rem 0.75rem', borderRadius: '0.375rem' }}>
                {triggerMsg.text}
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Runs table */}
      {error && <div className="error-banner">Failed to load runs: {error}</div>}

      <div className="card">
        <div className="card-header">Recent Reconciliation Runs</div>
        {loading ? (
          <div className="loading">Loading runs…</div>
        ) : runs.length === 0 ? (
          <div className="empty-state">No reconciliation runs found. Trigger your first run above.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Run Date</th>
                <th>Status</th>
                <th>Tanks</th>
                <th>Urgent</th>
                <th>Triggered By</th>
                <th>Triggered At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <tr
                  key={run.ID}
                  onClick={() => navigate(`/runs/${run.ID}`)}
                  className={run.urgentCount > 0 ? 'urgent-row' : ''}
                >
                  <td><strong>{run.runDate}</strong></td>
                  <td><StatusBadge value={run.status} /></td>
                  <td>{run.tankCount ?? '–'}</td>
                  <td>{run.urgentCount > 0
                    ? <span className="badge badge-urgent">{run.urgentCount}</span>
                    : run.urgentCount ?? '–'}</td>
                  <td>{run.triggeredBy || '–'}</td>
                  <td>{run.triggeredAt ? new Date(run.triggeredAt).toLocaleString() : '–'}</td>
                  <td style={{ display: 'flex', gap: '0.35rem' }}>
                    <button
                      className="btn btn-outline"
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                      onClick={e => { e.stopPropagation(); navigate(`/runs/${run.ID}`); }}>
                      View
                    </button>
                    {/* R11: Re-trigger only for FAILED or PENDING runs */}
                    {(run.status === 'FAILED' || run.status === 'PENDING') && (
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                        disabled={retriggering === run.ID}
                        onClick={e => { e.stopPropagation(); handleRetrigger(run.ID, run.runDate); }}>
                        {retriggering === run.ID ? '…' : '↺ Re-trigger'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
