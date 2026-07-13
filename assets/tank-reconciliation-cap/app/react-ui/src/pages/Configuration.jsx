import React, { useEffect, useState, useCallback, useRef } from 'react';
import { fetchTankConfigurations, updateTankConfiguration, fetchPlants } from '../api.js';

// ── PlantPicker: searchable live dropdown from S/4HANA ─────────────────────
function PlantPicker({ value, onChange }) {
  const [open, setOpen]       = useState(false);
  const [plants, setPlants]   = useState([]);
  const [search, setSearch]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const ref = useRef(null);

  async function openPicker() {
    if (!open) {
      setOpen(true);
      if (!plants.length) {
        setLoading(true);
        setError(null);
        try {
          const data = await fetchPlants();
          setPlants(data);
        } catch (e) {
          setError('Could not load plants from S/4HANA');
        } finally {
          setLoading(false);
        }
      }
    } else {
      setOpen(false);
    }
  }

  // Close on outside click
  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const filtered = plants.filter(p =>
    !search || p.Plant.toLowerCase().includes(search.toLowerCase()) ||
    (p.PlantName || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
        <input
          className="input"
          style={{ width: '80px' }}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder="Plant"
        />
        <button
          type="button"
          className="btn btn-outline"
          style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
          title="Browse plants from S/4HANA"
          onClick={openPicker}
        >⊞</button>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 1000,
          background: '#fff', border: '1px solid #ccc', borderRadius: '0.375rem',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', minWidth: '260px', maxHeight: '280px',
          overflow: 'hidden', display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
            <input
              className="input"
              style={{ width: '100%', fontSize: '0.85rem' }}
              autoFocus
              placeholder="Search plants…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading && <div style={{ padding: '0.75rem', color: '#666', fontSize: '0.85rem' }}>Loading plants…</div>}
            {error   && <div style={{ padding: '0.75rem', color: '#dc3545', fontSize: '0.85rem' }}>{error}</div>}
            {!loading && !error && filtered.length === 0 && (
              <div style={{ padding: '0.75rem', color: '#999', fontSize: '0.85rem' }}>No plants found</div>
            )}
            {filtered.map(p => (
              <div
                key={p.Plant}
                style={{
                  padding: '0.5rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem',
                  background: value === p.Plant ? '#e8f4ff' : 'transparent',
                  borderBottom: '1px solid #f5f5f5'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f0f8ff'}
                onMouseLeave={e => e.currentTarget.style.background = value === p.Plant ? '#e8f4ff' : 'transparent'}
                onClick={() => { onChange(p.Plant); setOpen(false); setSearch(''); }}
              >
                <strong>{p.Plant}</strong>
                {p.PlantName ? <span style={{ color: '#666', marginLeft: '0.5rem' }}>{p.PlantName}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
                    <PlantPicker value={draft.plant || ''} onChange={v => set('plant', v)} />
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
