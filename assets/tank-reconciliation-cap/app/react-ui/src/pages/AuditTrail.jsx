import React, { useEffect, useState, useCallback } from 'react';
import { fetchAuditLog } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const MILESTONES = ['', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
const OUTCOMES   = ['', 'ACHIEVED', 'FAILED'];

export default function AuditTrail() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterMilestone, setFilterMilestone] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('');
  const [filterTank, setFilterTank] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (filterMilestone) params['$filter'] = `milestone eq '${filterMilestone}'`;
      const data = await fetchAuditLog(params);
      setEntries(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterMilestone]);

  useEffect(() => { load(); }, [load]);

  // client-side filter on outcome / tank
  const filtered = entries.filter(e => {
    if (filterOutcome && e.outcome !== filterOutcome) return false;
    if (filterTank && !(e.tankId || '').toLowerCase().includes(filterTank.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <h1 className="page-title">Audit Trail</h1>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-body">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Milestone</label>
              <select className="input" value={filterMilestone}
                      onChange={e => setFilterMilestone(e.target.value)}>
                {MILESTONES.map(m => <option key={m} value={m}>{m || 'All'}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Outcome</label>
              <select className="input" value={filterOutcome}
                      onChange={e => setFilterOutcome(e.target.value)}>
                {OUTCOMES.map(o => <option key={o} value={o}>{o || 'All'}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Tank ID</label>
              <input className="input" placeholder="e.g. TK-01"
                     value={filterTank} onChange={e => setFilterTank(e.target.value)} />
            </div>
            <button className="btn btn-outline" onClick={load}>↻ Refresh</button>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="card-header">
          Audit Entries
          <span style={{ fontSize: '0.75rem', color: '#6c757d', fontWeight: 400 }}>
            Showing {filtered.length} of {entries.length}
          </span>
        </div>
        {loading ? (
          <div className="loading">Loading audit log…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">No entries matching current filters.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Milestone</th>
                <th>Step</th>
                <th>Tank</th>
                <th>Outcome</th>
                <th>Actor</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.ID}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                    {e.timestamp ? new Date(e.timestamp).toLocaleString() : '–'}
                  </td>
                  <td>
                    <span className="badge badge-pending">{e.milestone}</span>
                  </td>
                  <td>{e.step}</td>
                  <td>{e.tankId || '–'}</td>
                  <td><StatusBadge value={e.outcome} /></td>
                  <td>{e.actor || '–'}</td>
                  <td style={{ fontSize: '0.8rem', color: '#495057' }}>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
