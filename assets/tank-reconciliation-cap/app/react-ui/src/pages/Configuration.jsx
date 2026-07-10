import React, { useEffect, useState, useCallback } from 'react';
import { fetchTankConfigurations, updateTankConfiguration } from '../api.js';

export default function Configuration() {
  const [configs, setConfigs]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [editId, setEditId]     = useState(null);
  const [draft, setDraft]       = useState({});
  const [saving, setSaving]     = useState(false);
  const [saveMsg, setSaveMsg]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConfigs(await fetchTankConfigurations());
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
    setSaveMsg(null);
  }

  async function saveEdit() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await updateTankConfiguration(draft.tankId, {
        tankName:          draft.tankName,
        materialId:        draft.materialId,
        plant:             draft.plant,
        toleranceOkPct:    parseFloat(draft.toleranceOkPct)   || 0,
        toleranceFlagPct:  parseFloat(draft.toleranceFlagPct) || 0,
        atgEndpoint:       draft.atgEndpoint   || '',
        active:            !!draft.active,
        terminalId:        draft.terminalId    || 'DEFAULT',
        terminalName:      draft.terminalName  || ''
      });
      setSaveMsg({ type: 'success', text: `Saved ${draft.tankId}.` });
      setEditId(null);
      await load();
    } catch (e) {
      setSaveMsg({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  }

  function set(field, value) {
    setDraft(d => ({ ...d, [field]: value }));
  }

  return (
    <div>
      <h1 className="page-title">Tank Configuration</h1>

      {error && <div className="error-banner">{error}</div>}
      {saveMsg && !editId && (
        <div className={saveMsg.type === 'success' ? 'badge badge-ok' : 'error-banner'}
             style={{ display: 'block', padding: '0.5rem 0.75rem', marginBottom: '1rem', borderRadius: '0.375rem' }}>
          {saveMsg.text}
        </div>
      )}

      {loading ? (
        <div className="loading">Loading…</div>
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
                <th>Material ID</th>
                <th>Plant</th>
                <th>OK Tolerance %</th>
                <th>Flag Tolerance %</th>
                <th>ATG Endpoint</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {configs.map(cfg => editId === cfg.tankId ? (
                <tr key={cfg.tankId}>
                  <td><strong>{cfg.tankId}</strong></td>
                  <td>
                    <input className="input" style={{ width: '120px' }}
                      value={draft.tankName || ''} onChange={e => set('tankName', e.target.value)} />
                  </td>
                  <td>
                    <input className="input" style={{ width: '90px' }}
                      value={draft.terminalId || ''} onChange={e => set('terminalId', e.target.value)}
                      placeholder="Terminal ID" />
                  </td>
                  <td>
                    <input className="input" style={{ width: '90px' }}
                      value={draft.materialId || ''} onChange={e => set('materialId', e.target.value)} />
                  </td>
                  <td>
                    <input className="input" style={{ width: '70px' }}
                      value={draft.plant || ''} onChange={e => set('plant', e.target.value)} />
                  </td>
                  <td>
                    <input className="input" type="number" step="0.01" style={{ width: '70px' }}
                      value={draft.toleranceOkPct ?? ''} onChange={e => set('toleranceOkPct', e.target.value)} />
                    <span style={{ marginLeft: '0.25rem', fontSize: '0.8rem' }}>%</span>
                  </td>
                  <td>
                    <input className="input" type="number" step="0.01" style={{ width: '70px' }}
                      value={draft.toleranceFlagPct ?? ''} onChange={e => set('toleranceFlagPct', e.target.value)} />
                    <span style={{ marginLeft: '0.25rem', fontSize: '0.8rem' }}>%</span>
                  </td>
                  <td>
                    <input className="input" style={{ width: '140px' }}
                      value={draft.atgEndpoint || ''} onChange={e => set('atgEndpoint', e.target.value)} />
                  </td>
                  <td>
                    <input type="checkbox" checked={!!draft.active}
                      onChange={e => set('active', e.target.checked)} />
                  </td>
                  <td style={{ display: 'flex', gap: '0.35rem', flexDirection: 'column' }}>
                    {saveMsg && (
                      <span style={{ fontSize: '0.72rem', color: saveMsg.type === 'error' ? '#dc3545' : '#28a745' }}>
                        {saveMsg.text}
                      </span>
                    )}
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button className="btn btn-primary" style={{ fontSize: '0.75rem' }} disabled={saving} onClick={saveEdit}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button className="btn btn-outline" style={{ fontSize: '0.75rem' }} onClick={cancelEdit}>
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={cfg.tankId}>
                  <td><strong>{cfg.tankId}</strong></td>
                  <td>{cfg.tankName || '–'}</td>
                  <td>
                    <span style={{ fontSize: '0.8rem' }} title={cfg.terminalName || ''}>
                      {cfg.terminalId || 'DEFAULT'}
                    </span>
                  </td>
                  <td>{cfg.materialId || '–'}</td>
                  <td>{cfg.plant || '–'}</td>
                  <td>{cfg.toleranceOkPct != null ? `${cfg.toleranceOkPct}%` : '–'}</td>
                  <td>{cfg.toleranceFlagPct != null ? `${cfg.toleranceFlagPct}%` : '–'}</td>
                  <td style={{ fontSize: '0.78rem', color: '#6c757d', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {cfg.atgEndpoint || '–'}
                  </td>
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
