import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchRuns, fetchPendingApprovals, fetchPlants, triggerRun, retriggerDataCollection } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import KpiTile from '../components/KpiTile.jsx';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function MultiDateSelect({ dates, selectedDates, onChange }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = dates.filter(d => d.includes(search));

  function toggle(date) {
    if (selectedDates.includes(date)) {
      onChange(selectedDates.filter(d => d !== date));
    } else {
      onChange([...selectedDates, date]);
    }
  }

  function removeTag(date) {
    onChange(selectedDates.filter(d => d !== date));
  }

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: '280px' }}>
      <div
        className="input"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', cursor: 'text', minHeight: '36px', alignItems: 'center', padding: '0.25rem 0.5rem' }}
        onClick={() => setOpen(true)}
      >
        {selectedDates.map(d => (
          <span key={d} style={{ background: '#0070f3', color: '#fff', borderRadius: '0.25rem', padding: '0.1rem 0.4rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            {d}
            <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={e => { e.stopPropagation(); removeTag(d); }}>×</span>
          </span>
        ))}
        <input
          style={{ border: 'none', outline: 'none', flex: 1, minWidth: '80px', fontSize: '0.875rem', background: 'transparent' }}
          placeholder={selectedDates.length === 0 ? 'All dates' : ''}
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #dee2e6', borderRadius: '0.375rem', zIndex: 100, maxHeight: '200px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem', color: '#6c757d' }}>No dates found</div>
          ) : (
            <>
              <div
                onClick={() => { onChange([]); setOpen(false); }}
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.875rem', cursor: 'pointer', borderBottom: '1px solid #dee2e6', color: '#0070f3', fontWeight: 500 }}
                onMouseEnter={e => e.currentTarget.style.background = '#f8f9fa'}
                onMouseLeave={e => e.currentTarget.style.background = '#fff'}
              >
                All Dates
              </div>
              {filtered.map(d => (
              <div
                key={d}
                onClick={() => toggle(d)}
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.875rem', cursor: 'pointer', background: selectedDates.includes(d) ? '#e7f1ff' : '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                onMouseEnter={e => e.currentTarget.style.background = selectedDates.includes(d) ? '#d0e4ff' : '#f8f9fa'}
                onMouseLeave={e => e.currentTarget.style.background = selectedDates.includes(d) ? '#e7f1ff' : '#fff'}
              >
                <input type="checkbox" readOnly checked={selectedDates.includes(d)} style={{ cursor: 'pointer' }} />
                {d}
              </div>
            ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [runs, setRuns]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [triggerDate, setTriggerDate] = useState(todayIso());
  const [triggering, setTriggering]   = useState(false);
  const [triggerMsg, setTriggerMsg]   = useState(null);
  const [retriggering, setRetriggering] = useState(null);
  const [pendingUrgent, setPendingUrgent] = useState(0);

  // Plant filter state
  const [plants, setPlants]           = useState([]);
  const [plantsLoading, setPlantsLoading] = useState(false);
  const [selectedPlant, setSelectedPlant] = useState('');

  // Multi-date filter state
  const [selectedDates, setSelectedDates] = useState([]);

  const [lastUpdated, setLastUpdated] = useState(null);

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
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load plants from S/4HANA on mount
  useEffect(() => {
    setPlantsLoading(true);
    fetchPlants()
      .then(data => setPlants(data))
      .catch(() => setPlants([]))
      .finally(() => setPlantsLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // KPIs — Total Runs always shows ALL plants regardless of filter
  const latest = runs[0];
  const totalTanks       = latest?.tankCount ?? 0;
  const awaitingApproval = runs.filter(r => r.status === 'AWAITING_APPROVAL').length;
  const failedRuns       = runs.filter(r => r.status === 'FAILED').length;

  // Unique sorted run dates for multi-select
  const availableDates = [...new Set(runs.map(r => r.runDate))].sort((a, b) => b.localeCompare(a));

  // Filtered runs for table only
  const filteredRuns = runs.filter(r => {
    const matchesPlant = !selectedPlant || r.plant === selectedPlant || !r.plant;
    const matchesDate  = selectedDates.length === 0 || selectedDates.includes(r.runDate);
    return matchesPlant && matchesDate;
  });

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
      {lastUpdated && (
        <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem' }}>
          Last updated: {lastUpdated.toLocaleString()}
        </div>
      )}

      {/* Plant display filter */}
      <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <label style={{ fontWeight: 500, fontSize: '0.9rem' }}>Filter by Plant:</label>
        <select
          className="input"
          style={{ width: '220px' }}
          value={selectedPlant}
          onChange={e => setSelectedPlant(e.target.value)}
          disabled={plantsLoading}
        >
          <option value="">All Plants</option>
          {plants.map(p => (
            <option key={p.Plant} value={p.Plant}>
              {p.Plant}{p.PlantName ? ` – ${p.PlantName}` : ''}
            </option>
          ))}
        </select>
        {plantsLoading && <span style={{ fontSize: '0.82rem', color: '#666' }}>Loading plants…</span>}
      </div>

      {/* KPI tiles — Total Runs always all plants */}
      <div className="kpi-grid">
        <KpiTile label="Total Runs"        value={runs.length}      onClick={() => navigate('/')} />
        <KpiTile label="Latest Tanks"      value={totalTanks}       onClick={() => navigate('/configuration')} />
        <KpiTile label="Urgent Variances"  value={pendingUrgent}    className={pendingUrgent > 0 ? 'urgent' : ''}  onClick={() => navigate('/approvals')} />
        <KpiTile label="Awaiting Approval" value={pendingUrgent}    className={pendingUrgent > 0 ? 'flag' : ''} onClick={() => navigate('/approvals')} />
        <KpiTile label="Failed Runs"       value={failedRuns}       className={failedRuns > 0 ? 'urgent' : ''}  onClick={() => navigate('/')} />
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
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span>Recent Reconciliation Runs</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 400, fontSize: '0.875rem' }}>
            <label style={{ color: '#495057', whiteSpace: 'nowrap' }}>Filter by Date:</label>
            <MultiDateSelect
              dates={availableDates}
              selectedDates={selectedDates}
              onChange={setSelectedDates}
            />
            {selectedDates.length > 0 ? (
              <button className="btn btn-outline" style={{ fontSize: '0.78rem', padding: '0.2rem 0.5rem' }} onClick={() => setSelectedDates([])}>
                All Dates
              </button>
            ) : null}
          </div>
          {selectedPlant && (
            <span style={{ fontSize: '0.82rem', fontWeight: 400, color: '#666' }}>
              — plant: {selectedPlant} ({filteredRuns.length} of {runs.length})
            </span>
          )}
        </div>
        {loading ? (
          <div className="loading">Loading runs…</div>
        ) : filteredRuns.length === 0 ? (
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
              {filteredRuns.map(run => (
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
