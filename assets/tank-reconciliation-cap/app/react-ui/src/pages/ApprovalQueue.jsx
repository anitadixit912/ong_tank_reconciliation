import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fetchPendingApprovals, approvePosting, rejectPosting, fetchReasonCodes, fetchOpenNominations } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import DeltaBar from '../components/DeltaBar.jsx';

const ITEM_STATUS_MAP = {
  '1': 'Planned', '2': 'Scheduled', '3': 'Accepted',
  '4': 'Confirmed', '5': 'Partially Complete'
};

function NominationsModal({ nominations, onClose }) {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{
        background: '#fff', borderRadius: '8px', padding: '1.5rem',
        width: '90%', maxWidth: '900px', maxHeight: '80vh',
        display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>📋 Open TSW Nominations for USMOB ({nominations.length})</h2>
          <button className="btn btn-secondary" onClick={onClose}>✕ Close</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Nomination #</th>
                <th>Item</th>
                <th>Material</th>
                <th>Quantity</th>
                <th>UoM</th>
                <th>Scheduled Date</th>
                <th>Type</th>
                <th>Item Status</th>
                <th>Header Status</th>
              </tr>
            </thead>
            <tbody>
              {nominations.map((n, i) => (
                <tr key={i}>
                  <td><strong>{n.Nominationnumber?.replace(/^0+/, '')}</strong></td>
                  <td>{n.Itemnumber?.replace(/^0+/, '')}</td>
                  <td>{n.Demandmaterial || '–'}</td>
                  <td style={{ textAlign: 'right' }}>{parseFloat(n.Nominatedqty || 0).toLocaleString()}</td>
                  <td>{n.Quantityunit}</td>
                  <td>{n.Scheduleddate}</td>
                  <td>{n.Itemtype === 'O' ? '📤 Origin' : n.Itemtype === 'D' ? '📥 Destination' : n.Itemtype}</td>
                  <td>{ITEM_STATUS_MAP[n.Itemstatus] || n.Itemstatus}</td>
                  <td>{n.Nomstatus === '1' ? '🟢 Open' : n.Nomstatus === '2' ? '🟡 Transmitted' : '🔴 Closed'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function ApprovalQueue() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [comment, setComment] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [acting, setActing] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const [reasonCodes, setReasonCodes] = useState([]);
  const [nominations, setNominations] = useState([]);
  const [showNominations, setShowNominations] = useState(false);

  useEffect(() => {
    fetchOpenNominations().then(noms => setNominations(noms)).catch(() => setNominations([]));
  }, []);

  useEffect(() => {
    fetchReasonCodes().then(codes => {
      // Deduplicate by Grund (show each reason code once, prefer 701)
      const seen = new Set();
      const deduped = codes.filter(c => {
        if (seen.has(c.Grund)) return false;
        seen.add(c.Grund);
        return true;
      });
      setReasonCodes([{ Grund: '', Grtxt: '-- Select Reason Code --' }, ...deduped]);
    }).catch(() => {
      setReasonCodes([{ Grund: '', Grtxt: '-- Select Reason Code --' }]);
    });
  }, []);

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
    if (decision === 'approve' && selected.classification === 'RED' && !reasonCode) {
      setActionMsg({ type: 'error', text: 'A reason code is mandatory for RED variance approval.' });
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
                  {reasonCodes.map(r => (
                    <option key={r.Grund} value={r.Grund}>
                      {r.Grund ? r.Grund + ' — ' + r.Grtxt : r.Grtxt}
                    </option>
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

              {/* Open Nominations for this tank's material */}
              {nominations.length > 0 && (() => {
                const tankNoms = nominations.filter(n =>
                  n.Demandmaterial === selected.materialId ||
                  n.Locationid === 'USMOB'
                );
                if (tankNoms.length === 0) return null;
                const preview = tankNoms.slice(0, 3);
                return (
                  <div style={{ marginTop: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <div className="form-label" style={{ fontWeight: 600 }}>
                        📋 Open TSW Nominations ({tankNoms.length})
                      </div>
                      <button className="btn btn-outline" style={{ fontSize: '0.7rem' }}
                              onClick={() => setShowNominations(true)}>
                        View All
                      </button>
                    </div>
                    <table style={{ width: '100%', fontSize: '0.72rem', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f0f4ff' }}>
                          <th style={{ padding: '3px 5px', textAlign: 'left' }}>Nom #</th>
                          <th style={{ padding: '3px 5px', textAlign: 'left' }}>Material</th>
                          <th style={{ padding: '3px 5px', textAlign: 'right' }}>Qty</th>
                          <th style={{ padding: '3px 5px', textAlign: 'left' }}>Date</th>
                          <th style={{ padding: '3px 5px', textAlign: 'left' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((n, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '3px 5px' }}>{n.Nominationnumber?.replace(/^0+/, '')}</td>
                            <td style={{ padding: '3px 5px' }}>{n.Demandmaterial || '–'}</td>
                            <td style={{ padding: '3px 5px', textAlign: 'right' }}>{parseFloat(n.Nominatedqty || 0).toLocaleString()} {n.Quantityunit}</td>
                            <td style={{ padding: '3px 5px' }}>{n.Scheduleddate}</td>
                            <td style={{ padding: '3px 5px' }}>{ITEM_STATUS_MAP[n.Itemstatus] || n.Itemstatus}</td>
                          </tr>
                        ))}
                        {tankNoms.length > 3 && (
                          <tr>
                            <td colSpan="5" style={{ padding: '3px 5px', color: '#888', fontSize: '0.7rem' }}>
                              ... and {tankNoms.length - 3} more — click View All
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Nominations Modal */}
      {showNominations && (
        <NominationsModal
          nominations={nominations}
          onClose={() => setShowNominations(false)}
        />
      )}
    </div>
  );
}
