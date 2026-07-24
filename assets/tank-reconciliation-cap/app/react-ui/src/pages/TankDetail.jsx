import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchRun } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import DeltaBar from '../components/DeltaBar.jsx';

export default function TankDetail() {
  const { runId } = useParams();
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('tanks');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRun(runId);
      setRun(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="loading">Loading run details…</div>;
  if (error)   return <div className="error-banner">{error}</div>;
  if (!run)    return <div className="empty-state">Run not found.</div>;

  const tanks = run.tankResults || [];
  const auditEntries = run.auditEntries || [];

  return (
    <div>
      <div style={{ marginBottom: '0.75rem' }}>
        <Link to="/" style={{ color: '#0070f3', textDecoration: 'none', fontSize: '0.875rem' }}>
          ← Dashboard
        </Link>
      </div>

      <h1 className="page-title">Run: {run.runDate}</h1>

      {/* Run header */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
            <div>
              <div className="form-label">Status</div>
              <StatusBadge value={run.status} />
            </div>
            <div>
              <div className="form-label">Triggered By</div>
              <div>{run.triggeredBy || '–'}</div>
            </div>
            <div>
              <div className="form-label">Triggered At</div>
              <div>{run.triggeredAt ? new Date(run.triggeredAt).toLocaleString() : '–'}</div>
            </div>
            <div>
              <div className="form-label">Tank Count</div>
              <div>{run.tankCount ?? '–'}</div>
            </div>
            <div>
              <div className="form-label">Urgent Variances</div>
              <div>{run.urgentCount > 0
                ? <span className="badge badge-urgent">{run.urgentCount}</span>
                : run.urgentCount ?? '–'}</div>
            </div>
            {run.reportUrl && (
              <div>
                <div className="form-label">Report</div>
                <a href={run.reportUrl} target="_blank" rel="noreferrer"
                   className="btn btn-outline" style={{ display: 'inline-flex', fontSize: '0.75rem' }}>
                  📄 PDF
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        {['tanks', 'audit'].map(tab => (
          <button key={tab} className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}>
            {tab === 'tanks' ? `Tank Results (${tanks.length})` : `Audit Log (${auditEntries.length})`}
          </button>
        ))}
      </div>

      {activeTab === 'tanks' && (
        tanks.length === 0 ? <div className="empty-state">No tank results for this run.</div> : (
          <div className="card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tank ID</th>
                  <th>Name</th>
                  <th>Plant</th>
                  <th>SLOC</th>
                  <th>Dip Date/Time</th>
                  <th>Book Stock ({tanks[0]?.uom || 'TO'})</th>
                  <th>Physical ({tanks[0]?.uom || 'TO'})</th>
                  <th>Delta ({tanks[0]?.uom || 'TO'})</th>
                  <th>UoM</th>
                  <th>Delta %</th>
                  <th>Classification</th>
                  <th>Posting Status</th>
                  <th>Material Doc</th>
                </tr>
              </thead>
              <tbody>
                {tanks.map(t => (
                  <tr key={t.ID} className={t.classification === 'URGENT' ? 'urgent-row' : ''}>
                    <td><strong>{t.tankId}</strong></td>
                    <td>{t.tankName || '–'}</td>
                    <td>{t.plant || '–'}</td>
                    <td>{t.storageLocation || '–'}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                      {t.dipTimestamp
                        ? t.dipTimestamp.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5:$6')
                        : '–'}
                    </td>
                    <td>{t.bookStock?.toLocaleString() ?? '–'}</td>
                    <td>{t.netVolumePhysical?.toLocaleString() ?? '–'}</td>
                    <td>
                      <span className={Math.abs(t.delta || 0) > 0 ? (t.classification === 'URGENT' ? 'delta-urgent' : t.classification === 'FLAG' ? 'delta-flag' : 'delta-ok') : ''}>
                        {t.delta != null ? (t.delta >= 0 ? '+' : '') + t.delta.toFixed(2) : '–'}
                      </span>
                    </td>
                    <td><strong>{t.uom || 'TO'}</strong></td>
                    <td>
                      <DeltaBar pct={t.deltaPercent} />
                    </td>
                    <td><StatusBadge value={t.classification} /></td>
                    <td>
                      <StatusBadge value={t.postingStatus} />
                      {t.postingStatus === 'FAILED' && (t.classification === 'GREEN' || t.classification === 'AMBER') && (
                        <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.2rem' }}>
                          IS-OIL config pending
                        </div>
                      )}
                    </td>
                    <td>{t.materialDocumentId
                      ? <a href={`https://10.236.250.15:44301/sap/bc/ui2/flp?sap-client=650&sap-language=EN#MaterialDocument-displayFactSheet?MaterialDocument=${t.materialDocumentId}&MaterialDocumentYear=${new Date().getFullYear()}`}
                           target="_blank" rel="noreferrer" style={{ color: '#0070f3' }}>
                          📄 {t.materialDocumentId}
                        </a>
                      : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {activeTab === 'audit' && (
        auditEntries.length === 0 ? <div className="empty-state">No audit entries.</div> : (
          <div className="card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Milestone</th>
                  <th>Step</th>
                  <th>Tank</th>
                  <th>Outcome</th>
                  <th>Message</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.map(e => (
                  <tr key={e.ID}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                      {e.timestamp ? new Date(e.timestamp).toLocaleString() : '–'}
                    </td>
                    <td><strong>{e.milestone}</strong></td>
                    <td>{e.step}</td>
                    <td>{e.tankId || '–'}</td>
                    <td><StatusBadge value={e.outcome} /></td>
                    <td style={{ fontSize: '0.8rem' }}>{e.message}</td>
                    <td>{e.actor || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
