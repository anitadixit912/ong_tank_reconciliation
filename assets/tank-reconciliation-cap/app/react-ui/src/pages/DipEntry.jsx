import React, { useEffect, useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  fetchTankConfigurations,
  fetchDipReadings,
  saveDipReading,
  saveDipToSAP,
  batchSaveDipsToSAP,
  parseDipFromPrompt
} from '../api.js';

const DIP_UNITS   = ['MM', 'CM', 'L', 'HL', 'BBL', 'M3'];
const DIP_TYPES   = [{ code: 'I', label: 'Innage (depth from bottom)' }, { code: 'U', label: 'Ullage (empty space from top)' }];
const INPUT_METHODS = { MANUAL: '✏️ Manual', EXCEL: '📊 Excel', AI_PROMPT: '🤖 AI Prompt' };

const STATUS_BADGE = {
  DRAFT:        { label: 'Draft',        cls: 'badge-pending' },
  SUBMITTED:    { label: 'Submitted',    cls: 'badge-flag' },
  POSTED:       { label: 'Posted',       cls: 'badge-ok' },
  FAILED:       { label: 'Failed',       cls: 'badge-urgent' },
  PENDING_ABAP: { label: 'Pending ABAP', cls: 'badge-flag' },
};

const EXCEL_COL_ALIASES = {
  tankId:          ['tankid','socnr','storage_object','storageobject','tank_id','tank id','socnr_number'],
  tankName:        ['tankname','tank_name','tank name','description'],
  measurementDate: ['measurementdate','measurement_date','date','mesdat','mdate','dip_date'],
  measurementTime: ['measurementtime','measurement_time','time','mestim','mtime','dip_time'],
  dipType:         ['diptype','dip_type','dipltyp','type'],
  dipValue:        ['dipvalue','dip_value','dipqty','value','dip_reading','reading'],
  dipUnit:         ['dipunit','dip_unit','dipqun','unit','uom'],
  waterHeight:     ['waterheight','water_height','wathgt','water_level'],
  temperature:     ['temperature','temp','temcel','celsius'],
  density:         ['density','densty'],
  dipEvent:        ['dipevent','dip_event','socev','event'],
  notes:           ['notes','note','comment','remarks'],
};

function normaliseHeader(h) {
  return String(h || '').toLowerCase().replace(/[\s_\-\.]+/g, '_').trim();
}

function mapExcelRow(headers, row) {
  const out = {};
  headers.forEach((h, i) => {
    const norm = normaliseHeader(h);
    for (const [field, aliases] of Object.entries(EXCEL_COL_ALIASES)) {
      if (aliases.includes(norm)) { out[field] = row[i] != null ? String(row[i]).trim() : ''; break; }
    }
  });
  return out;
}

function validateRow(row) {
  const errors = [];
  if (!row.tankId)          errors.push('tankId required');
  if (!row.measurementDate) errors.push('measurementDate required');
  if (!row.dipType || !['I','U'].includes(row.dipType.toUpperCase())) errors.push('dipType must be I or U');
  if (!row.dipValue || isNaN(parseFloat(row.dipValue))) errors.push('dipValue must be numeric');
  if (!row.dipUnit || !DIP_UNITS.includes(row.dipUnit.toUpperCase())) errors.push('dipUnit must be one of ' + DIP_UNITS.join(', '));
  return errors;
}

function emptyForm() {
  return {
    tankId: '', tankName: '',
    measurementDate: new Date().toISOString().slice(0, 10),
    measurementTime: '',
    dipType: 'I', dipValue: '', dipUnit: 'MM',
    waterHeight: '', waterHeightUnit: 'MM',
    temperature: '', density: '',
    dipEvent: '', notes: '', inputMethod: 'MANUAL'
  };
}

export default function DipEntry() {
  const [tab, setTab]               = useState('manual');
  const [tanks, setTanks]           = useState([]);
  const [history, setHistory]       = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [form, setForm]             = useState(emptyForm());
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState(null);

  // Excel tab state
  const [excelRows, setExcelRows]   = useState([]);
  const [excelErrors, setExcelErrors] = useState([]);
  const [dragOver, setDragOver]     = useState(false);
  const [batchPosting, setBatchPosting] = useState(false);
  const [batchResult, setBatchResult]   = useState(null);
  const fileInputRef = useRef(null);

  // AI Prompt tab state
  const [aiText, setAiText]         = useState('');
  const [aiExtracting, setAiExtracting] = useState(false);
  const [aiError, setAiError]       = useState(null);
  const [aiConfidence, setAiConfidence] = useState(null);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try { setHistory(await fetchDipReadings({ top: 50 })); }
    catch (e) { console.error('fetchDipReadings', e); }
    finally { setHistLoading(false); }
  }, []);

  useEffect(() => {
    fetchTankConfigurations().then(setTanks).catch(console.error);
    loadHistory();
  }, [loadHistory]);

  function handleTankSelect(e) {
    const id = e.target.value;
    const t  = tanks.find(x => x.tankId === id);
    setForm(f => ({ ...f, tankId: id, tankName: t ? t.tankName : '' }));
  }

  function setField(name) {
    return e => setForm(f => ({ ...f, [name]: e.target.value }));
  }

  async function handleSaveDraft() {
    setSaving(true); setSaveMsg(null);
    try {
      const res = await saveDipReading({ ...form, inputMethod: tab === 'ai' ? 'AI_PROMPT' : 'MANUAL' });
      setSaveMsg({ type: 'ok', text: 'Draft saved (ID: ' + res.id.slice(0, 8) + '…)' });
      setForm(emptyForm());
      loadHistory();
    } catch (e) {
      setSaveMsg({ type: 'err', text: e.message });
    } finally { setSaving(false); }
  }

  async function handleSaveAndPost() {
    setSaving(true); setSaveMsg(null);
    try {
      const saved = await saveDipReading({ ...form, inputMethod: tab === 'ai' ? 'AI_PROMPT' : 'MANUAL' });
      const post  = await saveDipToSAP(saved.id);
      setSaveMsg({
        type: post.success ? 'ok' : 'warn',
        text: post.success
          ? 'Posted to SAP IS-Oil successfully.'
          : 'Saved in CAP, SAP posting: ' + post.message
      });
      setForm(emptyForm());
      loadHistory();
    } catch (e) {
      setSaveMsg({ type: 'err', text: e.message });
    } finally { setSaving(false); }
  }

  // ── Excel upload ────────────────────────────────────────────────────────────
  function parseExcelFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb      = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const ws      = wb.Sheets[wb.SheetNames[0]];
        const raw     = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (raw.length < 2) { setExcelErrors(['File appears empty']); return; }
        const headers = raw[0];
        const rows    = raw.slice(1).filter(r => r.some(c => c !== '')).map((r, i) => {
          const mapped = mapExcelRow(headers, r);
          mapped._row  = i + 2;
          mapped._errs = validateRow(mapped);
          return mapped;
        });
        setExcelRows(rows);
        setExcelErrors([]);
        setBatchResult(null);
      } catch (err) {
        setExcelErrors(['Failed to parse file: ' + err.message]);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleFileDrop(e) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (f) parseExcelFile(f);
  }

  async function handleBatchPost() {
    const valid = excelRows.filter(r => r._errs.length === 0);
    if (!valid.length) return;
    setBatchPosting(true); setBatchResult(null);
    try {
      const savedIds = [];
      for (const row of valid) {
        const res = await saveDipReading({ ...row, dipType: (row.dipType || 'I').toUpperCase(), dipUnit: (row.dipUnit || 'MM').toUpperCase(), inputMethod: 'EXCEL' });
        savedIds.push(res.id);
      }
      const result = await batchSaveDipsToSAP(savedIds);
      setBatchResult(result);
      loadHistory();
    } catch (e) {
      setBatchResult({ error: e.message });
    } finally { setBatchPosting(false); }
  }

  // ── AI Prompt ───────────────────────────────────────────────────────────────
  async function handleAiExtract() {
    if (!aiText.trim()) return;
    setAiExtracting(true); setAiError(null); setAiConfidence(null);
    try {
      const res = await parseDipFromPrompt(aiText, 'dip-entry');
      setAiConfidence(res.confidence);
      setForm(f => ({
        ...f,
        tankId:          res.tankId          || f.tankId,
        measurementDate: res.measurementDate || f.measurementDate,
        measurementTime: res.measurementTime || f.measurementTime,
        dipType:         res.dipType         || f.dipType,
        dipValue:        res.dipValue        || f.dipValue,
        dipUnit:         res.dipUnit         || f.dipUnit,
        waterHeight:     res.waterHeight     || f.waterHeight,
        temperature:     res.temperature     || f.temperature,
        density:         res.density         || f.density,
        dipEvent:        res.dipEvent        || f.dipEvent,
        inputMethod:     'AI_PROMPT'
      }));
      // If tank found, sync tankName
      if (res.tankId) {
        const t = tanks.find(x => x.tankId === res.tankId);
        if (t) setForm(f => ({ ...f, tankName: t.tankName }));
      }
      setTab('manual');
    } catch (e) {
      setAiError(e.message);
    } finally { setAiExtracting(false); }
  }

  // ── Post from history ───────────────────────────────────────────────────────
  async function handlePostFromHistory(id) {
    try {
      const res = await saveDipToSAP(id);
      setSaveMsg({ type: res.success ? 'ok' : 'warn', text: res.message });
      loadHistory();
    } catch (e) {
      setSaveMsg({ type: 'err', text: e.message });
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '1.5rem' }}>
      <h1 className="page-title">💧 Dip Entry</h1>
      <p style={{ color: '#6c757d', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Create dip readings manually, via Excel upload, or using AI natural language extraction.
        Readings are saved in CAP and optionally posted live to SAP IS-Oil via OGS_S4.
      </p>

      {saveMsg && (
        <div className={saveMsg.type === 'ok' ? 'success-banner' : saveMsg.type === 'warn' ? 'info-banner' : 'error-banner'}
             style={{ marginBottom: '1rem' }}>
          {saveMsg.type === 'ok' ? '✅' : saveMsg.type === 'warn' ? '⚠️' : '❌'} {saveMsg.text}
        </div>
      )}

      {/* ── Tab selector ── */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '0', borderBottom: '2px solid #dee2e6' }}>
        {[
          { id: 'manual', label: '✏️ Manual Entry' },
          { id: 'excel',  label: '📊 Excel Upload' },
          { id: 'ai',     label: '🤖 AI Prompt'    },
        ].map(t => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '0.6rem 1.25rem',
              border: 'none', background: 'none', cursor: 'pointer',
              borderBottom: tab === t.id ? '3px solid #0070f3' : '3px solid transparent',
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? '#0070f3' : '#495057',
              fontSize: '0.9rem', marginBottom: '-2px'
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Manual Entry Tab ── */}
      {tab === 'manual' && (
        <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <div className="card-header">
            {form.inputMethod === 'AI_PROMPT' ? '🤖 AI-extracted values — review and confirm' : 'Dip Reading Form'}
          </div>
          <div className="card-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Tank / Storage Object *</label>
                <select className="input" value={form.tankId} onChange={handleTankSelect}>
                  <option value="">— select tank —</option>
                  {tanks.map(t => (
                    <option key={t.tankId} value={t.tankId}>
                      {t.tankId.replace(/^0+/, '') || t.tankId} — {t.tankName} ({t.plant})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Tank Name</label>
                <input className="input" value={form.tankName} onChange={setField('tankName')} placeholder="Auto-filled from tank selection" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Measurement Date *</label>
                <input type="date" className="input" value={form.measurementDate} onChange={setField('measurementDate')} />
              </div>
              <div className="form-group">
                <label className="form-label">Measurement Time (HHMMSS)</label>
                <input className="input" value={form.measurementTime} onChange={setField('measurementTime')}
                  placeholder="e.g. 143000" maxLength={6} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Dip Type *</label>
                <div style={{ display: 'flex', gap: '1.5rem', paddingTop: '0.5rem' }}>
                  {DIP_TYPES.map(d => (
                    <label key={d.code} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                      <input type="radio" name="dipType" value={d.code}
                        checked={form.dipType === d.code} onChange={setField('dipType')} />
                      <strong>{d.code}</strong> — {d.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Dip Value *</label>
                <input type="number" step="0.001" className="input" value={form.dipValue} onChange={setField('dipValue')}
                  placeholder="Physical measurement" />
              </div>
              <div className="form-group">
                <label className="form-label">Unit *</label>
                <select className="input" value={form.dipUnit} onChange={setField('dipUnit')}>
                  {DIP_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Water Height (optional)</label>
                <input type="number" step="0.001" className="input" value={form.waterHeight} onChange={setField('waterHeight')}
                  placeholder="Free water level" />
              </div>
              <div className="form-group">
                <label className="form-label">Water Height Unit</label>
                <select className="input" value={form.waterHeightUnit} onChange={setField('waterHeightUnit')}>
                  {DIP_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Temperature °C (QCI)</label>
                <input type="number" step="0.01" className="input" value={form.temperature} onChange={setField('temperature')}
                  placeholder="For ASTM/VCF correction" />
              </div>
              <div className="form-group">
                <label className="form-label">Density kg/m³ (QCI)</label>
                <input type="number" step="0.0001" className="input" value={form.density} onChange={setField('density')}
                  placeholder="For ASTM/VCF correction" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Dip Event</label>
                <input className="input" value={form.dipEvent} onChange={setField('dipEvent')}
                  placeholder="e.g. Post-discharge, End-of-day" maxLength={50} />
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <input className="input" value={form.notes} onChange={setField('notes')} placeholder="Optional notes" maxLength={200} />
              </div>
            </div>

            {aiConfidence && (
              <div className="info-banner" style={{ marginBottom: '1rem' }}>
                🤖 AI extraction confidence: <strong>{aiConfidence}</strong> — review all fields before posting.
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={saving}>
                {saving ? 'Saving…' : '💾 Save Draft'}
              </button>
              <button className="btn btn-primary" onClick={handleSaveAndPost} disabled={saving || !form.tankId || !form.dipValue}>
                {saving ? 'Posting…' : '🚀 Save & Post to SAP'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setForm(emptyForm()); setSaveMsg(null); setAiConfidence(null); }}>
                🔄 Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Excel Upload Tab ── */}
      {tab === 'excel' && (
        <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <div className="card-header">Excel / CSV Upload</div>
          <div className="card-body">
            <p style={{ fontSize: '0.85rem', color: '#6c757d', marginBottom: '1rem' }}>
              Supported formats: <strong>.xlsx</strong>, <strong>.xls</strong>, <strong>.csv</strong>.<br/>
              Required columns: <code>SOCNR/tankId</code>, <code>Date</code>, <code>DipType (I/U)</code>, <code>DipQty/dipValue</code>, <code>DipQun/dipUnit</code>.<br/>
              Optional: <code>Time</code>, <code>WaterHeight</code>, <code>Temperature</code>, <code>Density</code>, <code>DipEvent</code>, <code>Notes</code>.
            </p>

            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed ' + (dragOver ? '#0070f3' : '#ced4da'),
                borderRadius: '8px', padding: '2.5rem', textAlign: 'center', cursor: 'pointer',
                background: dragOver ? '#f0f7ff' : '#fafafa', marginBottom: '1rem',
                transition: 'all 0.15s'
              }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📂</div>
              <div style={{ color: '#495057' }}>Drag &amp; drop file here, or click to browse</div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                onChange={handleFileDrop} />
            </div>

            {excelErrors.length > 0 && (
              <div className="error-banner" style={{ marginBottom: '1rem' }}>
                {excelErrors.map((e, i) => <div key={i}>❌ {e}</div>)}
              </div>
            )}

            {excelRows.length > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.9rem' }}>
                    <strong>{excelRows.length}</strong> rows found —{' '}
                    <span style={{ color: '#28a745' }}>{excelRows.filter(r => r._errs.length === 0).length} valid</span>,{' '}
                    <span style={{ color: '#dc3545' }}>{excelRows.filter(r => r._errs.length > 0).length} invalid</span>
                  </span>
                  <button className="btn btn-primary" onClick={handleBatchPost}
                    disabled={batchPosting || excelRows.filter(r => r._errs.length === 0).length === 0}>
                    {batchPosting ? 'Posting…' : '🚀 Post All Valid to SAP'}
                  </button>
                </div>

                {batchResult && (
                  <div className={batchResult.error ? 'error-banner' : 'success-banner'} style={{ marginBottom: '1rem' }}>
                    {batchResult.error
                      ? '❌ ' + batchResult.error
                      : `✅ Submitted: ${batchResult.submitted} | Failed: ${batchResult.failed}${batchResult.messages ? ' — ' + batchResult.messages : ''}`
                    }
                  </div>
                )}

                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Row</th><th>Tank ID</th><th>Date</th><th>Type</th>
                        <th>Value</th><th>Unit</th><th>Temp</th><th>Density</th>
                        <th>Event</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {excelRows.map((r, i) => (
                        <tr key={i} style={{ background: r._errs.length > 0 ? '#fff5f5' : undefined }}>
                          <td>{r._row}</td>
                          <td>{r.tankId || <span style={{ color: '#dc3545' }}>missing</span>}</td>
                          <td>{r.measurementDate || '–'}</td>
                          <td>{r.dipType || '–'}</td>
                          <td style={{ textAlign: 'right' }}>{r.dipValue || '–'}</td>
                          <td>{r.dipUnit || '–'}</td>
                          <td>{r.temperature || '–'}</td>
                          <td>{r.density || '–'}</td>
                          <td>{r.dipEvent || '–'}</td>
                          <td>
                            {r._errs.length === 0
                              ? <span className="badge badge-ok">✓ Valid</span>
                              : <span className="badge badge-urgent" title={r._errs.join('; ')}>⚠ {r._errs.length} error{r._errs.length > 1 ? 's' : ''}</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── AI Prompt Tab ── */}
      {tab === 'ai' && (
        <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <div className="card-header">🤖 AI Natural Language Extraction</div>
          <div className="card-body">
            <p style={{ fontSize: '0.85rem', color: '#6c757d', marginBottom: '1rem' }}>
              Describe the dip reading in natural language. The AI (SAP AI Core — <code>aicore</code> destination) will extract the structured parameters
              and pre-fill the Manual Entry form for your review before saving.
            </p>
            <div style={{ background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: '6px', padding: '0.75rem', marginBottom: '1rem', fontSize: '0.8rem', color: '#495057' }}>
              <strong>Examples:</strong><br/>
              • "Tank 23 innage reading 1842 mm at 14:30 today, temperature 38.5°C, density 850 kg/m3"<br/>
              • "Storage object 00000000000000000023, ullage 2500 MM, water height 45 MM, post-discharge event, 2026-10-06"<br/>
              • "Dip tank TERM-1743 tank 23: 1850mm innage, 09:00, temp 40C, density 856"
            </div>
            <textarea
              className="input textarea"
              rows={5}
              value={aiText}
              onChange={e => setAiText(e.target.value)}
              placeholder="Describe the dip reading here…"
              style={{ width: '100%', resize: 'vertical', marginBottom: '1rem' }}
            />
            {aiError && (
              <div className="error-banner" style={{ marginBottom: '1rem' }}>❌ {aiError}</div>
            )}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="btn btn-primary" onClick={handleAiExtract}
                disabled={aiExtracting || !aiText.trim()}>
                {aiExtracting ? '⏳ Extracting…' : '✨ Extract & Fill Form'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setAiText(''); setAiError(null); }}>
                🔄 Clear
              </button>
            </div>
            <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#6c757d' }}>
              After extraction, the Manual Entry tab will open with pre-filled values. Review and confirm before saving.
            </p>
          </div>
        </div>
      )}

      {/* ── Recent Dip Readings ── */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Recent Dip Readings</span>
          <button className="btn btn-secondary" onClick={loadHistory} disabled={histLoading} style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}>
            {histLoading ? '…' : '↻ Refresh'}
          </button>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {histLoading ? (
            <div style={{ padding: '1rem', color: '#6c757d' }}>Loading…</div>
          ) : history.length === 0 ? (
            <div style={{ padding: '1rem', color: '#6c757d' }}>No dip readings found. Create one above.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tank</th><th>Date / Time</th><th>Type</th><th>Value</th>
                    <th>Temp</th><th>Input</th><th>Status</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(d => {
                    const badge = STATUS_BADGE[d.postingStatus] || { label: d.postingStatus, cls: 'badge-pending' };
                    return (
                      <tr key={d.ID}>
                        <td>
                          <strong>{(d.tankId || '').replace(/^0+/, '') || d.tankId}</strong>
                          {d.tankName && <div style={{ fontSize: '0.75rem', color: '#6c757d' }}>{d.tankName}</div>}
                        </td>
                        <td>
                          {d.measurementDate}
                          {d.measurementTime ? <div style={{ fontSize: '0.75rem', color: '#6c757d' }}>{d.measurementTime.slice(0,2)}:{d.measurementTime.slice(2,4)}</div> : ''}
                        </td>
                        <td>{d.dipType === 'I' ? 'Innage' : d.dipType === 'U' ? 'Ullage' : d.dipType}</td>
                        <td style={{ textAlign: 'right' }}>
                          {parseFloat(d.dipValue || 0).toFixed(1)} {d.dipUnit}
                          {d.waterHeight ? <div style={{ fontSize: '0.75rem', color: '#6c757d' }}>Water: {d.waterHeight}</div> : ''}
                        </td>
                        <td>{d.temperature != null ? d.temperature + ' °C' : '–'}</td>
                        <td style={{ fontSize: '0.75rem' }}>{INPUT_METHODS[d.inputMethod] || d.inputMethod}</td>
                        <td>
                          <span className={'badge ' + badge.cls} title={d.bapiResponse || ''}>
                            {badge.label}
                          </span>
                        </td>
                        <td>
                          {(d.postingStatus === 'DRAFT' || d.postingStatus === 'FAILED') && (
                            <button className="btn btn-primary"
                              style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                              onClick={() => handlePostFromHistory(d.ID)}>
                              Post to SAP
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
