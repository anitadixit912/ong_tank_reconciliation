import React, { useEffect, useState, useCallback } from 'react';
import { fetchTankConfigurations, updateTankConfiguration } from '../api.js';

export default function Configuration() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTankConfigurations();
      setConfigs(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function startEdit(cfg) {
    setEditId(cfg.tankId);
    setDraft({ ...cfg });
    setSaveMsg(null);
  }

  function cancelEdit() {
    setEditId(null);
    setDraft({});
  }

  async function saveEdit() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await updateTankConfiguration(draft.tankId, {
        tankName: draft.tankName,
        materialNumber: draft.materialNumber,
        plant: draft.plant,
        storageLocation: draft.storageLocation,
        flagThresholdPct: parseFloat(draft.flagThresholdPct),
        urgentThresholdPct: parseFloat(draft.urgentThresholdPct),
        maximumCapacityLiters: parseFloat(draft.maximumCapacityLiters),
        active: draft.active,
        // R13: terminal site
        terminalId: draft.terminalId || 'DEFAULT',
        terminalName: draft.terminalName || ''
      });
      setSaveMsg({ type: 'success', text: `Configuration for ${draft.tankId} saved.` });
      setEditId(null);
      await load();
    } catch (e) {
      setSaveMsg({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  }

  function handleDraft(field, value) {
    setDraft(d => ({ ...d, [field]: value }));
  }

  return (
    <div>
      <h1 className="page-title">Tank Configuration</h1>
      <p style={{ color: '#6c757d', fontSize: '0.875rem', marginBottom: '1rem' }}>
        Configure per-tank variance thresholds, S/4HANA material/plant assignments, and terminal site (R13).
      </p>

      {error && <div className="error-banner">{error}</div>}
      {saveMsg && !editId && (
        <div className={saveMsg.type === 'success' ? 'badge badge-ok' : 'error-banner'}
             style={{ display: 'block', padding: '0.5rem 0.75rem', marginBottom: '1rem', borderRadius: '0.375rem' }}>
          {saveMsg.text}
        </div>
      )}

      {loading ? (
        <div className="loading">Loading configurations…</div>
      ) : (
        <div className="card">
          <div className="card-header">
            Tank Configurations
            <button className="btn btn-outline" style={{ fontSize: '0.75rem' }} onClick={load}>↻ Refresh</button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tank ID</th>
                <th>Name</th>
                <th>Terminal</th>
                <th>Material No.</th>
                <th>Plant</th>
                <th>Storage Loc.</th>
                <th>Flag %</th>
                <th>Urgent %</th>
                <th>Max Cap. (L)</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {configs.map(cfg => (
                editId === cfg.tankId ? (
                  <tr key={cfg.tankId}>
                    <td><strong>{cfg.tankId}</strong></td>
                    <td>
                      <input className="input" style={{ width: '120px' }}
                             value={draft.tankName || ''} onChange={e => handleDraft('tankName', e.target.value)} />
                    </td>
                    <td>
                      <input className="input" style={{ width: '100px' }}
                             value={draft.materialNumber || ''} onChange={e => handleDraft('materialNumber', e.target.value)} />
                    </td>
                    <td>
                      <input className="input" style={{ width: '70px' }}
                             value={draft.plant || ''} onChange={e => handleDraft('plant', e.target.value)} />
                    </td>
                    <td>
                      <input className="input" style={{ width: '70px' }}
                             value={draft.storageLocation || ''} onChange={e => handleDraft('storageLocation', e.target.value)} />
                    </td>
                    <td>
                      <input className="input" type="number" step="0.01" style={{ width: '70px' }}
                             value={draft.flagThresholdPct ?? ''} onChange={e => handleDraft('flagThresholdPct', e.target.value)} />
                      <span style={{ marginLeft: '0.25rem', fontSize: '0.8rem' }}>%</span>
                    </td>
                    <td>
                      <input className="input" type="number" step="0.01" style={{ width: '70px' }}
                             value={draft.urgentThresholdPct ?? ''} onChange={e => handleDraft('urgentThresholdPct', e.target.value)} />
                      <span style={{ marginLeft: '0.25rem', fontSize: '0.8rem' }}>%</span>
                    </td>
                    <td>
                      <input className="input" type="number" style={{ width: '100px' }}
                             value={draft.maximumCapacityLiters ?? ''} onChange={e => handleDraft('maximumCapacityLiters', e.target.value)} />
                    </td>
                    <td>
                      <input type="checkbox" checked={!!draft.active} onChange={e => handleDraft('active', e.target.checked)} />
                    </td>
                    <td style={{ display: 'flex', gap: '0.35rem' }}>
                      {saveMsg && editId && (
                        <span style={{ fontSize: '0.75rem', color: saveMsg.type === 'error' ? '#dc3545' : '#28a745' }}>
                          {saveMsg.text}
                        </span>
                      )}
                      <button className="btn btn-success" style={{ fontSize: '0.75rem' }} disabled={saving} onClick={saveEdit}>
                        Save
                      </button>
                      <button className="btn btn-secondary" style={{ fontSize: '0.75rem' }} onClick={cancelEdit}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={cfg.tankId}>
                    <td><strong>{cfg.tankId}</strong></td>
                    <td>{cfg.tankName || '–'}</td>
                    <td>
                      <span title={cfg.terminalName || ''} style={{ fontSize: '0.8rem', color: '#495057' }}>
                        {cfg.terminalId || 'DEFAULT'}
                      </span>
                    </td>
                    <td>{cfg.materialNumber || '–'}</td>
                    <td>{cfg.plant || '–'}</td>
                    <td>{cfg.storageLocation || '–'}</td>
                    <td>{cfg.flagThresholdPct != null ? `${cfg.flagThresholdPct}%` : '–'}</td>
                    <td>{cfg.urgentThresholdPct != null ? `${cfg.urgentThresholdPct}%` : '–'}</td>
                    <td>{cfg.maximumCapacityLiters?.toLocaleString() ?? '–'}</td>
                    <td>
                      <span className={`badge ${cfg.active ? 'badge-ok' : 'badge-secondary'}`}>
                        {cfg.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-outline" style={{ fontSize: '0.75rem' }} onClick={() => startEdit(cfg)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
