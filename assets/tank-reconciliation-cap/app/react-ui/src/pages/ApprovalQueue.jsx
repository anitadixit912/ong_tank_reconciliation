import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fetchPendingApprovals, approvePosting, rejectPosting } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import DeltaBar from '../components/DeltaBar.jsx';

export default function ApprovalQueue() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [comment, setComment] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [acting, setActing] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);

  const REASON_CODES = [
    { code: '',   label: '-- Select Reason Code --' },
    { code: '01', label: '01 — Measurement' },
    { code: '02', label: '02 — Transport Gain' },
    { code: '03', label: '03 — Transport Losses' },
    { code: '04', label: '04 — Customer not available' },
    { code: '05', label: '05 — Insufficient quantity delivered' },
    { code: '06', label: '06 — Lost quantity' },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPendingApprovals();
      setItems(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openPanel(item) {
    setSelected(item);
    setComment('');
    setReasonCode('');
    setActionMsg(null);
  }

  async function act(decision) {
    if (!selected) return;
    if (decision === 'reject' && !comment.trim()) {
      setActionMsg({ type: 'error', text: 'A comment is mandatory when rejecting.' });
      return;
    }
    // Build full comment with reason code
    const fullComment = reasonCode
      ? `[${reasonCode}] ${comment}`.trim()
      : comment;
    setActing(true);
    setActionMsg(null);
    try {
      if (decision === 'approve') {
        await approvePosting(selected.ID, fullComment);
        setActionMsg({ type: 'success', text: `Tank ${selected.tankId} approved.` });
      } else {
        await rejectPosting(selected.ID, fullComment);
        setActionMsg({ type: 'success', text: `Tank ${selected.tankId} posting rejected.` });
      }
      await load();
      setSelected(null);
    } catch (e) {
      setActionMsg({ type: 'error', text: e.message });
    } finally {
      setActing(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Approval Queue</h1>

      {error && <div className="error-banner">Failed to load: {error}</div>}

      {actionMsg && !selected && (
        <div className={actionMsg.type === 'success' ? 'badge badge-ok' : 'error-banner'}
             style={{ display: 'block', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', marginBottom: '1rem' }}>
          {actionMsg.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        {/* List */}
        <div style={{ flex: 1 }}>
          <div className="card">
            <div className="card-header">
              Pending URGENT Approvals
              <button className="btn btn-outline" style={{ fontSize: '0.75rem' }} onClick={load}>↻ Refresh</button>
            </div>
            {loading ? (
              <div className="loading">Loading…</div>
            ) : items.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                🎉 No pending approvals — all URGENT variances are resolved.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Run Date</th>
                    <th>Tank ID</th>
                    <th>Tank Name</th>
                    <th>Delta ({items[0]?.uom || 'TO'})</th>
                    <th>Delta %</th>
                    <th>Book Stock ({items[0]?.uom || 'TO'})</th>
                    <th>Physical ({items[0]?.uom || 'TO'})</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.ID} className="urgent-row">
                      <td>
                        <Link to={`/runs/${item.run_ID}`} style={{ color: '#0070f3', textDecoration: 'none' }}>
                          {item.run?.runDate || item.run_ID?.slice(0, 8) + '…'}
                        </Link>
                      </td>
                      <td><strong>{item.tankId}</strong></td>
                      <td>{item.tankName || '–'}</td>
                      <td>
                        <span className="delta-urgent">
                          {item.delta != null ? (item.delta >= 0 ? '+' : '') + item.delta.toFixed(2) : '–'}
                        </span>
                      </td>
                      <td><DeltaBar pct={item.deltaPercent} /></td>
                      <td>{item.bookStock?.toLocaleString() ?? '–'}</td>
                      <td>{item.netVolumePhysical?.toLocaleString() ?? '–'}</td>
                      <td>
                        <button className="btn btn-primary" style={{ fontSize: '0.75rem' }}
                                onClick={() => openPanel(item)}>
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Approval panel */}
        {selected && (
          <div className="card" style={{ width: '340px', flexShrink: 0 }}>
            <div className="card-header">
              Review: {selected.tankId}
              <button className="btn btn-secondary" style={{ fontSize: '0.75rem' }} onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <div className="form-label">Tank Name</div>
                <div>{selected.tankName || '–'}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <div className="form-label">Book Stock</div>
                  <div>{selected.bookStock?.toLocaleString() ?? '–'} {selected.uom || 'TO'}</div>
                </div>
                <div>
                  <div className="form-label">Physical</div>
                  <div>{selected.netVolumePhysical?.toLocaleString() ?? '–'} {selected.uom || 'TO'}</div>
                </div>
                <div>
                  <div className="form-label">Delta</div>
                  <span className="delta-urgent">
                    {selected.delta != null ? (selected.delta >= 0 ? '+' : '') + selected.delta.toFixed(2) : '–'} {selected.uom || 'TO'}
                  </span>
                </div>
                <div>
                  <div className="form-label">Delta %</div>
                  <span className="delta-urgent">{selected.deltaPercent?.toFixed(2) ?? '–'}%</span>
                </div>
              </div>

              <div>
                <label className="form-label">Reason Code</label>
                <select
                  className="input"
                  value={reasonCode}
                  onChange={e => setReasonCode(e.target.value)}
                  style={{ width: '100%' }}
                >
                  {REASON_CODES.map(r => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label" htmlFor="approval-comment">
                  Comment {acting === 'reject' && <span style={{ color: '#dc3545' }}>*</span>}
                </label>
                <textarea
                  id="approval-comment"
                  className="textarea"
                  placeholder="Enter your approval/rejection comment…"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                />
              </div>

              {actionMsg && (
                <div className={actionMsg.type === 'success' ? 'badge badge-ok' : 'error-banner'}
                     style={{ display: 'block', padding: '0.4rem 0.6rem' }}>
                  {actionMsg.text}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-success" style={{ flex: 1 }}
                        disabled={acting} onClick={() => act('approve')}>
                  ✓ Approve
                </button>
                <button className="btn btn-danger" style={{ flex: 1 }}
                        disabled={acting} onClick={() => act('reject')}>
                  ✗ Reject
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
