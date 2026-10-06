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
const INPUT_METHODS = { MANUAL: '✏️ Manual', EXCEL: '📊 Excel', AI_PROMPT: '🤖 AI' };

const STATUS_CFG = {
  DRAFT:        { label: 'Draft',          color: '#6c757d', bg: '#f8f9fa'  },
  SUBMITTED:    { label: 'Submitted',      color: '#0d6efd', bg: '#e7f1ff'  },
  POSTED:       { label: '✓ Posted',       color: '#198754', bg: '#d1e7dd'  },
  FAILED:       { label: '✗ Failed ⓘ',    color: '#dc3545', bg: '#f8d7da', clickable: true },
  PENDING_ABAP: { label: '⏸ Pending ABAP ⓘ', color: '#fd7e14', bg: '#fff3cd', clickable: true },
};

function DipDetailModal({ dip, onClose, onRetry }) {
  if (!dip) return null;
  const advice = getAdvice(dip);
  const sc = STATUS_CFG[dip.postingStatus] || STATUS_CFG.FAILED;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '560px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.25)', overflow: 'hidden'
      }} onClick={e => e.stopPropagation()}>
        <div style={{ background: sc.bg, borderBottom: '1px solid ' + sc.color + '55', padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, color: sc.color, fontSize: '1rem' }}>{advice ? advice.title : 'Posting Details'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#6c757d', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '1.25rem' }}>
          <div style={{ background: '#f6f8fc', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: '#495057' }}>
            <div><strong>Tank:</strong> {(dip.tankId || '').replace(/^0+/, '') || dip.tankId}{dip.tankName ? ' — ' + dip.tankName : ''}</div>
            <div><strong>Date / Time:</strong> {dip.measurementDate} {dip.measurementTime ? dip.measurementTime.slice(0,2) + ':' + dip.measurementTime.slice(2,4) : ''}</div>
            <div><strong>Value:</strong> {dip.dipValue} {dip.dipUnit}</div>
            <div><strong>Input:</strong> {INPUT_METHODS[dip.inputMethod] || dip.inputMethod}</div>
          </div>
          {dip.bapiResponse && (
            <div style={{ background: '#fff8f8', border: '1px solid #f5c2c7', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#58151c', marginBottom: '0.3rem' }}>SAP Error Message:</div>
              <code style={{ fontSize: '0.78rem', color: '#495057', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{dip.bapiResponse}</code>
            </div>
          )}
          {advice && advice.steps.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1a2332', marginBottom: '0.5rem' }}>💡 What to do:</div>
              <ol style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '0.825rem', color: '#495057', lineHeight: 1.7 }}>
                {advice.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            {(dip.postingStatus === 'FAILED' || dip.postingStatus === 'DRAFT') && (
              <button style={{ padding: '0.45rem 1rem', background: '#198754', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
                onClick={() => { onRetry(dip.ID); onClose(); }}>
                🚀 Retry — Post to SAP
              </button>
            )}
            <button style={{ padding: '0.45rem 1rem', background: '#fff', color: '#495057', border: '1px solid #ced4da', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
              onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getAdvice(dip) {
  const bapi = (dip.bapiResponse || '').toLowerCase();
  if (dip.postingStatus === 'PENDING_ABAP') {
    return {
      title: 'Pending ABAP — CREATE not yet enabled',
      steps: [
        'The SAP IS-Oil OData service (ZTANK_DIP_SRV_SRV) does not support CREATE on TankDipSet.',
        'The dip reading is safely stored in the system — no data has been lost.',
        'Contact the OGS ABAP team to activate the CREATE operation on TankDipSet in SEGW.',
        'Once the ABAP service is updated, click "Post to SAP" on this row to retry.',
      ],
      severity: 'warn',
    };
  }
  if (dip.postingStatus === 'FAILED') {
    if (bapi.includes('403') || bapi.includes('csrf')) {
      return {
        title: 'HTTP 403 — CSRF Token or Authorization Failure',
        steps: [
          'SAP Gateway rejected the request. This usually means either the CSRF token is missing, or the OGS_S4 user lacks CREATE authorization.',
          'Try clicking "Post to SAP" again — a fresh CSRF token will be fetched automatically.',
          'If it fails again with 403, the OGS_S4 destination user needs the CREATE authorization for BAPI_CREATE_DIPS_EXT in SAP (contact Basis team).',
          'Authorization objects to check: B_TANKDIP (or the IS-Oil equivalent for dip creation).',
        ],
        severity: 'err',
      };
    }
    if (bapi.includes('405')) {
      return {
        title: 'HTTP 405 — CREATE Not Supported on This Service',
        steps: [
          'The OData service ZTANK_DIP_SRV_SRV does not accept POST on TankDipSet.',
          'This is an ABAP/SEGW configuration issue. The entity set is read-only.',
          'Contact the OGS ABAP team: in SEGW, the TankDipSet entity must have "Creatable" = true.',
        ],
        severity: 'err',
      };
    }
    if (bapi.includes('401')) {
      return {
        title: 'HTTP 401 — Authentication Failed',
        steps: [
          'The OGS_S4 BTP destination credentials are incorrect or expired.',
          'Check the OGS_S4 destination in BTP Cockpit: verify the username and password are current.',
        ],
        severity: 'err',
      };
    }
    if (bapi.includes('destination') || bapi.includes('url not found')) {
      return {
        title: 'Destination Configuration Error',
        steps: [
          'The OGS_S4 BTP destination is not reachable from the CAP service.',
          'Check BTP Cockpit → Destinations → OGS_S4: verify URL, credentials, and Cloud Connector.',
          'Check Cloud Connector is running and APAC_DEV10 location is connected.',
        ],
        severity: 'err',
      };
    }
    return {
      title: 'SAP Posting Failed',
      steps: [
        'The dip reading was saved in the system but could not be posted to SAP IS-Oil.',
        'Review the error message below and retry by clicking "Post to SAP".',
        'If the error persists, check the OGS_S4 destination and Cloud Connector connectivity.',
      ],
      severity: 'err',
    };
  }
  return null;
}

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

function validateExcelRow(row) {
  const errors = [];
  if (!row.tankId)          errors.push('Tank ID required');
  if (!row.measurementDate) errors.push('Date required');
  if (!row.dipType || !['I','U'].includes(row.dipType.toUpperCase())) errors.push('Dip type must be I or U');
  if (!row.dipValue || isNaN(parseFloat(row.dipValue))) errors.push('Dip value must be a number');
  if (!row.dipUnit || !DIP_UNITS.includes(row.dipUnit.toUpperCase())) errors.push('Unit must be: ' + DIP_UNITS.join(', '));
  return errors;
}

function validateManualForm(form) {
  const errs = {};
  if (!form.tankId)          errs.tankId = 'Please select a tank';
  if (!form.measurementDate) errs.measurementDate = 'Date is required';
  if (!form.dipValue)        errs.dipValue = 'Dip value is required';
  else if (isNaN(parseFloat(form.dipValue))) errs.dipValue = 'Dip value must be a number (e.g. 1842.5)';
  if (form.waterHeight !== '' && form.waterHeight != null && isNaN(parseFloat(form.waterHeight)))
    errs.waterHeight = 'Water height must be a number';
  if (form.temperature !== '' && form.temperature != null && isNaN(parseFloat(form.temperature)))
    errs.temperature = 'Temperature must be a number (e.g. 38.5)';
  if (form.density !== '' && form.density != null && isNaN(parseFloat(form.density)))
    errs.density = 'Density must be a number (e.g. 850.0)';
  return errs;
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

/* ── Shared styles ──────────────────────────────────────────────────────────── */
const S = {
  section: {
    background: '#fff', border: '1px solid #e0e4ea', borderRadius: '10px',
    marginBottom: '1.25rem', overflow: 'hidden',
  },
  sectionHead: {
    background: '#f6f8fc', borderBottom: '1px solid #e0e4ea',
    padding: '0.75rem 1.25rem', fontWeight: 600, fontSize: '0.9rem',
    color: '#2c3e50', display: 'flex', alignItems: 'center', gap: '0.5rem'
  },
  sectionBody: { padding: '1.25rem' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' },
  row3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' },
  label: { display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#495057', marginBottom: '0.3rem' },
  req:   { color: '#dc3545', marginLeft: '2px' },
  input: {
    width: '100%', padding: '0.45rem 0.7rem', border: '1px solid #ced4da',
    borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box',
    outline: 'none', transition: 'border-color 0.15s',
  },
  inputErr: { borderColor: '#dc3545', background: '#fff8f8' },
  errMsg: { color: '#dc3545', fontSize: '0.75rem', marginTop: '0.25rem' },
  hint:   { color: '#6c757d', fontSize: '0.75rem', marginTop: '0.25rem' },
  btnRow: { display: 'flex', gap: '0.6rem', marginTop: '1.25rem', flexWrap: 'wrap' },
  btnPrimary: {
    padding: '0.5rem 1.1rem', background: '#0d6efd', color: '#fff',
    border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
  },
  btnSecondary: {
    padding: '0.5rem 1.1rem', background: '#fff', color: '#495057',
    border: '1px solid #ced4da', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem',
  },
  btnSuccess: {
    padding: '0.5rem 1.1rem', background: '#198754', color: '#fff',
    border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
  },
  badge: (cfg) => ({
    display: 'inline-block', padding: '0.2rem 0.55rem', borderRadius: '4px',
    fontSize: '0.75rem', fontWeight: 600, color: cfg.color, background: cfg.bg, letterSpacing: '0.02em'
  }),
  tab: (active) => ({
    padding: '0.65rem 1.2rem', border: 'none', background: 'none', cursor: 'pointer',
    borderBottom: active ? '3px solid #0d6efd' : '3px solid transparent',
    fontWeight: active ? 700 : 400, color: active ? '#0d6efd' : '#495057',
    fontSize: '0.875rem', marginBottom: '-2px', transition: 'color 0.15s',
  }),
  banner: (type) => {
    const map = {
      ok:   { bg: '#d1e7dd', color: '#0a3622', border: '#badbcc' },
      warn: { bg: '#fff3cd', color: '#664d03', border: '#ffecb5' },
      err:  { bg: '#f8d7da', color: '#58151c', border: '#f5c2c7' },
      info: { bg: '#cfe2ff', color: '#084298', border: '#b6d4fe' },
    };
    const c = map[type] || map.info;
    return {
      padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem',
      background: c.bg, color: c.color, border: '1px solid ' + c.border,
      fontSize: '0.875rem', lineHeight: 1.5,
    };
  },
};

function FieldError({ msg }) {
  if (!msg) return null;
  return <div style={S.errMsg}>⚠ {msg}</div>;
}

function FormInput({ label, required, hint, error, type = 'text', value, onChange, ...rest }) {
  return (
    <div>
      <label style={S.label}>{label}{required && <span style={S.req}>*</span>}</label>
      <input
        type={type}
        style={{ ...S.input, ...(error ? S.inputErr : {}) }}
        value={value}
        onChange={onChange}
        {...rest}
      />
      {error ? <FieldError msg={error} /> : hint ? <div style={S.hint}>{hint}</div> : null}
    </div>
  );
}

function FormSelect({ label, required, hint, error, children, value, onChange }) {
  return (
    <div>
      <label style={S.label}>{label}{required && <span style={S.req}>*</span>}</label>
      <select style={{ ...S.input, ...(error ? S.inputErr : {}) }} value={value} onChange={onChange}>
        {children}
      </select>
      {error ? <FieldError msg={error} /> : hint ? <div style={S.hint}>{hint}</div> : null}
    </div>
  );
}

export default function DipEntry() {
  const [tab, setTab]                   = useState('manual');
  const [tanks, setTanks]               = useState([]);
  const [history, setHistory]           = useState([]);
  const [histLoading, setHistLoading]   = useState(false);
  const [form, setForm]                 = useState(emptyForm());
  const [fieldErrors, setFieldErrors]   = useState({});
  const [saving, setSaving]             = useState(false);
  const [saveMsg, setSaveMsg]           = useState(null);
  const [postStep, setPostStep]         = useState(null); // null | 'saving' | 'posting' | 'done'
  const [detailDip, setDetailDip]       = useState(null); // dip record shown in details modal

  // Excel tab
  const [excelRows, setExcelRows]       = useState([]);
  const [excelErrors, setExcelErrors]   = useState([]);
  const [dragOver, setDragOver]         = useState(false);
  const [batchPosting, setBatchPosting] = useState(false);
  const [batchResult, setBatchResult]   = useState(null);
  const fileInputRef = useRef(null);

  // AI tab
  const [aiText, setAiText]             = useState('');
  const [aiExtracting, setAiExtracting] = useState(false);
  const [aiError, setAiError]           = useState(null);
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
    if (fieldErrors.tankId) setFieldErrors(fe => ({ ...fe, tankId: undefined }));
  }

  function setField(name) {
    return e => {
      setForm(f => ({ ...f, [name]: e.target.value }));
      if (fieldErrors[name]) setFieldErrors(fe => ({ ...fe, [name]: undefined }));
    };
  }

  function doValidate() {
    const errs = validateManualForm(form);
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSaveDraft() {
    if (!doValidate()) return;
    setSaving(true); setSaveMsg(null); setPostStep('saving');
    try {
      const res = await saveDipReading({ ...form, inputMethod: tab === 'ai' ? 'AI_PROMPT' : 'MANUAL' });
      setSaveMsg({ type: 'ok', text: 'Draft saved. ID: ' + res.id.slice(0, 8) + '…' });
      setForm(emptyForm()); setFieldErrors({}); setAiConfidence(null);
      loadHistory();
    } catch (e) {
      setSaveMsg({ type: 'err', text: e.message });
    } finally { setSaving(false); setPostStep(null); }
  }

  async function handleSaveAndPost() {
    if (!doValidate()) return;
    setSaving(true); setSaveMsg(null); setPostStep('saving');
    try {
      const saved = await saveDipReading({ ...form, inputMethod: tab === 'ai' ? 'AI_PROMPT' : 'MANUAL' });
      setPostStep('posting');
      const post  = await saveDipToSAP(saved.id);
      setSaveMsg({
        type: post.success ? 'ok' : 'warn',
        text: post.success
          ? '✓ Dip reading posted to SAP IS-Oil successfully.'
          : 'Saved in CAP. SAP posting: ' + post.message
      });
      setForm(emptyForm()); setFieldErrors({}); setAiConfidence(null);
      loadHistory();
    } catch (e) {
      setSaveMsg({ type: 'err', text: e.message });
    } finally { setSaving(false); setPostStep(null); }
  }

  // ── Excel ──────────────────────────────────────────────────────────────────
  function parseExcelFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb  = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (raw.length < 2) { setExcelErrors(['File appears empty']); return; }
        const rows = raw.slice(1).filter(r => r.some(c => c !== '')).map((r, i) => {
          const m  = mapExcelRow(raw[0], r);
          m._row   = i + 2;
          m._errs  = validateExcelRow(m);
          return m;
        });
        setExcelRows(rows); setExcelErrors([]); setBatchResult(null);
      } catch (err) { setExcelErrors(['Failed to parse file: ' + err.message]); }
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
      const ids = [];
      for (const row of valid) {
        const res = await saveDipReading({
          ...row,
          dipType: (row.dipType || 'I').toUpperCase(),
          dipUnit: (row.dipUnit || 'MM').toUpperCase(),
          inputMethod: 'EXCEL'
        });
        ids.push(res.id);
      }
      setBatchResult(await batchSaveDipsToSAP(ids));
      loadHistory();
    } catch (e) {
      setBatchResult({ error: e.message });
    } finally { setBatchPosting(false); }
  }

  // ── AI Prompt ──────────────────────────────────────────────────────────────
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
      if (res.tankId) {
        const t = tanks.find(x => x.tankId === res.tankId);
        if (t) setForm(f => ({ ...f, tankName: t.tankName }));
      }
      setFieldErrors({});
      setTab('manual');
    } catch (e) {
      setAiError(e.message);
    } finally { setAiExtracting(false); }
  }

  async function handlePostFromHistory(id) {
    try {
      const res = await saveDipToSAP(id);
      setSaveMsg({ type: res.success ? 'ok' : 'warn', text: res.message });
      loadHistory();
    } catch (e) {
      setSaveMsg({ type: 'err', text: e.message });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '1.5rem', maxWidth: '1100px', margin: '0 auto' }}>
      {detailDip && (
        <DipDetailModal
          dip={detailDip}
          onClose={() => setDetailDip(null)}
          onRetry={(id) => { handlePostFromHistory(id); setDetailDip(null); }}
        />
      )}

      {/* Page header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#1a2332' }}>
          💧 Dip Entry
        </h1>
        <p style={{ margin: '0.4rem 0 0', color: '#6c757d', fontSize: '0.875rem' }}>
          Create hydrocarbon tank dip readings — manual form, Excel upload, or AI natural language.
          Readings are saved in the system and posted live to SAP IS-Oil via OGS_S4.
        </p>
      </div>

      {/* Status banner */}
      {saveMsg && (
        <div style={S.banner(saveMsg.type)}>
          {saveMsg.text}
          <button onClick={() => setSaveMsg(null)}
            style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'inherit', opacity: 0.6 }}>×</button>
        </div>
      )}

      {/* Post progress indicator */}
      {postStep && (
        <div style={{ ...S.banner('info'), display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1rem' }}>⏳</span>
          <span>
            {postStep === 'saving'  && 'Step 1/2 — Saving dip reading…'}
            {postStep === 'posting' && 'Step 2/2 — Posting to SAP IS-Oil via OGS_S4…'}
          </span>
          {[1,2].map(n => (
            <span key={n} style={{
              width: 20, height: 6, borderRadius: 3,
              background: (postStep === 'saving' && n === 1) || (postStep === 'posting' && n <= 2)
                ? '#0d6efd' : '#dee2e6'
            }} />
          ))}
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: '2px solid #e0e4ea', marginBottom: '0' }}>
        {[
          { id: 'manual', icon: '✏️', label: 'Manual Entry' },
          { id: 'excel',  icon: '📊', label: 'Excel Upload' },
          { id: 'ai',     icon: '🤖', label: 'AI Prompt'    },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={S.tab(tab === t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Manual Entry Tab ── */}
      {tab === 'manual' && (
        <div style={{ ...S.section, borderTopLeftRadius: 0 }}>
          {form.inputMethod === 'AI_PROMPT' && (
            <div style={{ ...S.banner('info'), margin: '1rem 1.25rem 0', borderRadius: '8px' }}>
              🤖 <strong>AI-extracted values pre-filled below.</strong> Review carefully before saving — correct any fields as needed.
            </div>
          )}

          {/* Tank Selection */}
          <div style={{ ...S.sectionHead, marginTop: form.inputMethod === 'AI_PROMPT' ? 0 : undefined }}>
            🏭 Tank &amp; Timing
          </div>
          <div style={S.sectionBody}>
            <div style={S.row2}>
              <FormSelect
                label="Tank / Storage Object" required
                error={fieldErrors.tankId}
                value={form.tankId} onChange={handleTankSelect}
              >
                <option value="">— select tank —</option>
                {tanks.map(t => (
                  <option key={t.tankId} value={t.tankId}>
                    {t.tankId.replace(/^0+/, '') || t.tankId} — {t.tankName} ({t.plant})
                  </option>
                ))}
              </FormSelect>
              <FormInput label="Tank Name"
                value={form.tankName} onChange={setField('tankName')}
                placeholder="Auto-filled from tank selection"
              />
            </div>
            <div style={S.row2}>
              <FormInput label="Measurement Date" required type="date"
                error={fieldErrors.measurementDate}
                value={form.measurementDate} onChange={setField('measurementDate')}
              />
              <FormInput label="Measurement Time"
                value={form.measurementTime} onChange={setField('measurementTime')}
                placeholder="HHMMSS — e.g. 143000" maxLength={6}
                hint="24-hour format without colons"
              />
            </div>
          </div>

          {/* Dip Measurement */}
          <div style={S.sectionHead}>📏 Dip Measurement</div>
          <div style={S.sectionBody}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={S.label}>Dip Type<span style={S.req}>*</span></label>
              <div style={{ display: 'flex', gap: '2rem', paddingTop: '0.4rem' }}>
                {DIP_TYPES.map(d => (
                  <label key={d.code} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                    <input type="radio" name="dipType" value={d.code}
                      checked={form.dipType === d.code} onChange={setField('dipType')} />
                    <span><strong>{d.code}</strong> — {d.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div style={S.row3}>
              <FormInput label="Dip Value" required type="number" step="0.001"
                error={fieldErrors.dipValue}
                value={form.dipValue} onChange={setField('dipValue')}
                placeholder="e.g. 1842.500"
              />
              <FormSelect label="Unit" required value={form.dipUnit} onChange={setField('dipUnit')}>
                {DIP_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </FormSelect>
              <FormInput label="Dip Event"
                value={form.dipEvent} onChange={setField('dipEvent')}
                placeholder="e.g. Post-discharge" maxLength={50}
              />
            </div>
            <div style={S.row2}>
              <FormInput label="Water Height (optional)" type="number" step="0.001"
                error={fieldErrors.waterHeight}
                value={form.waterHeight} onChange={setField('waterHeight')}
                placeholder="Free water level"
              />
              <FormSelect label="Water Height Unit" value={form.waterHeightUnit} onChange={setField('waterHeightUnit')}>
                {DIP_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </FormSelect>
            </div>
          </div>

          {/* QCI / ASTM Correction */}
          <div style={S.sectionHead}>🌡 Quality / ASTM Correction (optional)</div>
          <div style={S.sectionBody}>
            <div style={S.row2}>
              <FormInput label="Temperature (°C)" type="number" step="0.01"
                error={fieldErrors.temperature}
                value={form.temperature} onChange={setField('temperature')}
                placeholder="e.g. 38.5"
                hint="Used for VCF calculation"
              />
              <FormInput label="Density (kg/m³)" type="number" step="0.0001"
                error={fieldErrors.density}
                value={form.density} onChange={setField('density')}
                placeholder="e.g. 850.0"
                hint="Used for VCF calculation"
              />
            </div>
            <div style={{ ...S.row2 }}>
              <FormInput label="Notes"
                value={form.notes} onChange={setField('notes')}
                placeholder="Optional notes" maxLength={200}
              />
              <div /> {/* spacer */}
            </div>
          </div>

          {/* Confidence banner (AI) */}
          {aiConfidence && (
            <div style={{ margin: '0 1.25rem' }}>
              <div style={S.banner(aiConfidence === 'HIGH' ? 'ok' : aiConfidence === 'MEDIUM' ? 'warn' : 'err')}>
                AI confidence: <strong>{aiConfidence}</strong>
                {aiConfidence !== 'HIGH' && ' — Please review all extracted fields carefully before posting.'}
              </div>
            </div>
          )}

          {/* Validation summary */}
          {Object.keys(fieldErrors).length > 0 && (
            <div style={{ margin: '0 1.25rem' }}>
              <div style={S.banner('err')}>
                <strong>Please fix the following before saving:</strong>
                <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.25rem' }}>
                  {Object.entries(fieldErrors).map(([k, v]) => <li key={k}>{v}</li>)}
                </ul>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ ...S.sectionBody, paddingTop: 0 }}>
            <div style={S.btnRow}>
              <button style={{ ...S.btnSecondary, opacity: saving ? 0.6 : 1 }}
                onClick={handleSaveDraft} disabled={saving}>
                {saving && postStep === 'saving' ? '⏳ Saving…' : '💾 Save Draft'}
              </button>
              <button style={{ ...S.btnSuccess, opacity: (saving || !form.tankId || !form.dipValue) ? 0.6 : 1 }}
                onClick={handleSaveAndPost} disabled={saving || !form.tankId || !form.dipValue}>
                {saving && postStep === 'posting' ? '⏳ Posting to SAP…' : saving ? '⏳ Saving…' : '🚀 Save & Post to SAP'}
              </button>
              <button style={S.btnSecondary}
                onClick={() => { setForm(emptyForm()); setSaveMsg(null); setFieldErrors({}); setAiConfidence(null); }}>
                🔄 Reset Form
              </button>
            </div>
            <p style={{ margin: '0.6rem 0 0', fontSize: '0.78rem', color: '#6c757d' }}>
              <strong>Save Draft</strong> stores locally. <strong>Save &amp; Post to SAP</strong> posts to SAP IS-Oil via OGS_S4 (BAPI_CREATE_DIPS_EXT).
              <span style={S.req}>*</span> Required fields.
            </p>
          </div>
        </div>
      )}

      {/* ── Excel Upload Tab ── */}
      {tab === 'excel' && (
        <div style={{ ...S.section, borderTopLeftRadius: 0 }}>
          <div style={S.sectionHead}>📊 Excel / CSV Upload</div>
          <div style={S.sectionBody}>
            <div style={{ background: '#f6f8fc', border: '1px solid #e0e4ea', borderRadius: '8px', padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: '#495057' }}>
              <strong>Supported:</strong> .xlsx, .xls, .csv<br/>
              <strong>Required columns:</strong> <code>SOCNR</code> / <code>tankId</code> · <code>Date</code> · <code>DipType (I/U)</code> · <code>DipQty</code> / <code>dipValue</code> · <code>DipQun</code> / <code>dipUnit</code><br/>
              <strong>Optional:</strong> Time · WaterHeight · Temperature · Density · DipEvent · Notes
            </div>

            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed ' + (dragOver ? '#0d6efd' : '#ced4da'),
                borderRadius: '10px', padding: '2.5rem', textAlign: 'center', cursor: 'pointer',
                background: dragOver ? '#f0f7ff' : '#fafafa', marginBottom: '1rem', transition: 'all 0.15s'
              }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.4rem' }}>📂</div>
              <div style={{ color: '#495057', fontWeight: 600 }}>Drop file here or click to browse</div>
              <div style={{ color: '#6c757d', fontSize: '0.8rem', marginTop: '0.2rem' }}>.xlsx · .xls · .csv</div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileDrop} />
            </div>

            {excelErrors.length > 0 && (
              <div style={S.banner('err')}>
                {excelErrors.map((e, i) => <div key={i}>⚠ {e}</div>)}
              </div>
            )}

            {excelRows.length > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.875rem' }}>
                    <strong>{excelRows.length}</strong> rows — {' '}
                    <span style={{ color: '#198754', fontWeight: 600 }}>{excelRows.filter(r => !r._errs.length).length} valid</span>
                    , <span style={{ color: '#dc3545', fontWeight: 600 }}>{excelRows.filter(r => r._errs.length).length} invalid</span>
                  </span>
                  <button style={{ ...S.btnSuccess, opacity: (batchPosting || !excelRows.filter(r => !r._errs.length).length) ? 0.6 : 1 }}
                    onClick={handleBatchPost}
                    disabled={batchPosting || !excelRows.filter(r => !r._errs.length).length}>
                    {batchPosting ? '⏳ Posting…' : '🚀 Post All Valid to SAP'}
                  </button>
                </div>

                {batchResult && (
                  <div style={S.banner(batchResult.error ? 'err' : 'ok')}>
                    {batchResult.error
                      ? '⚠ ' + batchResult.error
                      : '✓ Submitted: ' + batchResult.submitted + ' | Failed: ' + batchResult.failed + (batchResult.messages ? ' — ' + batchResult.messages : '')}
                  </div>
                )}

                <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid #e0e4ea' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ background: '#f6f8fc' }}>
                        {['Row','Tank ID','Date','Type','Value','Unit','Temp','Density','Event','Status'].map(h => (
                          <th key={h} style={{ padding: '0.5rem 0.65rem', textAlign: 'left', borderBottom: '2px solid #e0e4ea', fontWeight: 700, color: '#495057', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {excelRows.map((r, i) => (
                        <tr key={i} style={{ background: r._errs.length ? '#fff5f5' : i % 2 ? '#fafafa' : '#fff', borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '0.45rem 0.65rem', color: '#6c757d' }}>{r._row}</td>
                          <td style={{ padding: '0.45rem 0.65rem', fontWeight: 600 }}>{r.tankId || <span style={{ color: '#dc3545' }}>missing</span>}</td>
                          <td style={{ padding: '0.45rem 0.65rem' }}>{r.measurementDate || '–'}</td>
                          <td style={{ padding: '0.45rem 0.65rem' }}>{r.dipType || '–'}</td>
                          <td style={{ padding: '0.45rem 0.65rem', textAlign: 'right' }}>{r.dipValue || '–'}</td>
                          <td style={{ padding: '0.45rem 0.65rem' }}>{r.dipUnit || '–'}</td>
                          <td style={{ padding: '0.45rem 0.65rem' }}>{r.temperature || '–'}</td>
                          <td style={{ padding: '0.45rem 0.65rem' }}>{r.density || '–'}</td>
                          <td style={{ padding: '0.45rem 0.65rem' }}>{r.dipEvent || '–'}</td>
                          <td style={{ padding: '0.45rem 0.65rem' }}>
                            {r._errs.length === 0
                              ? <span style={{ color: '#198754', fontWeight: 700, fontSize: '0.75rem' }}>✓ Valid</span>
                              : <span style={{ color: '#dc3545', fontWeight: 700, fontSize: '0.75rem', cursor: 'help' }} title={r._errs.join('; ')}>⚠ {r._errs.length} error{r._errs.length > 1 ? 's' : ''}</span>
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
        <div style={{ ...S.section, borderTopLeftRadius: 0 }}>
          <div style={S.sectionHead}>🤖 AI Natural Language Extraction</div>
          <div style={S.sectionBody}>
            <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#495057', lineHeight: 1.6 }}>
              Describe the dip reading in plain English. The AI (SAP AI Core — <code>aicore</code> destination) will extract all structured fields
              and pre-fill the Manual Entry form for your review before saving.
            </p>

            {/* Example prompts */}
            <div style={{ background: '#f6f8fc', borderRadius: '8px', border: '1px solid #e0e4ea', padding: '0.85rem 1rem', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#495057', marginBottom: '0.5rem' }}>Examples:</div>
              {[
                'Tank 23 innage reading 1842 mm at 14:30 today, temperature 38.5°C, density 850 kg/m3',
                'Storage object 00000000000000000023, ullage 2500 MM, water height 45 MM, post-discharge event, 2026-10-06',
                'Dip tank 5: 1850mm innage, 09:00, temp 40°C, density 856, end-of-day measurement',
              ].map((ex, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: i < 2 ? '0.35rem' : 0 }}>
                  <span style={{ color: '#6c757d', fontSize: '0.75rem', paddingTop: '0.05rem', flexShrink: 0 }}>▸</span>
                  <button
                    onClick={() => setAiText(ex)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: '#0d6efd', fontSize: '0.8rem', padding: 0, textDecoration: 'underline dotted' }}>
                    {ex}
                  </button>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={S.label}>Your description</label>
              <textarea
                style={{ ...S.input, resize: 'vertical', minHeight: '100px', fontFamily: 'inherit', lineHeight: 1.5 }}
                rows={4}
                value={aiText}
                onChange={e => setAiText(e.target.value)}
                placeholder="Describe the dip reading here…"
              />
            </div>

            {/* AI Error with detail */}
            {aiError && (
              <div style={{ ...S.banner('err'), marginBottom: '1rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>⚠ AI extraction failed</div>
                <div style={{ fontSize: '0.8rem', opacity: 0.9, wordBreak: 'break-word' }}>
                  {aiError.includes('AI Core') || aiError.includes('aicore') || aiError.includes('destination')
                    ? <>
                        <strong>Cause:</strong> SAP AI Core could not be reached via the <code>aicore</code> BTP destination.<br/>
                        <details style={{ marginTop: '0.3rem' }}>
                          <summary style={{ cursor: 'pointer', color: 'inherit', fontSize: '0.78rem' }}>Technical details</summary>
                          <code style={{ fontSize: '0.75rem', display: 'block', marginTop: '0.25rem', whiteSpace: 'pre-wrap', opacity: 0.8 }}>{aiError}</code>
                        </details>
                        <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: 'inherit', opacity: 0.85 }}>
                          Check that the <code>aicore</code> BTP destination is configured and the AI Core model deployment is running.
                          You can still enter the dip reading manually in the <strong>Manual Entry</strong> tab.
                        </div>
                      </>
                    : aiError
                  }
                </div>
              </div>
            )}

            <div style={S.btnRow}>
              <button style={{ ...S.btnPrimary, opacity: (aiExtracting || !aiText.trim()) ? 0.6 : 1 }}
                onClick={handleAiExtract} disabled={aiExtracting || !aiText.trim()}>
                {aiExtracting ? '⏳ Extracting…' : '✨ Extract & Fill Form'}
              </button>
              <button style={S.btnSecondary} onClick={() => { setAiText(''); setAiError(null); }}>
                🔄 Clear
              </button>
            </div>
            <p style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: '#6c757d' }}>
              After extraction, the <strong>Manual Entry</strong> tab opens with pre-filled values.
              Review all fields — especially tank ID, dip value, and date — before posting to SAP.
            </p>
          </div>
        </div>
      )}

      {/* ── Recent Dip Readings ─────────────────────────────────────────────── */}
      <div style={S.section}>
        <div style={{ ...S.sectionHead, justifyContent: 'space-between' }}>
          <span>📋 Recent Dip Readings</span>
          <button style={{ ...S.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.65rem' }}
            onClick={loadHistory} disabled={histLoading}>
            {histLoading ? '…' : '↻ Refresh'}
          </button>
        </div>
        <div style={{ padding: 0 }}>
          {histLoading ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: '#6c757d', fontSize: '0.875rem' }}>Loading…</div>
          ) : history.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: '#6c757d', fontSize: '0.875rem' }}>
              No dip readings yet. Create one using the tabs above.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ background: '#f6f8fc' }}>
                    {['Tank','Date / Time','Type','Dip Value','Water Ht','Temp','Method','Status','Action'].map(h => (
                      <th key={h} style={{ padding: '0.6rem 0.85rem', textAlign: 'left', borderBottom: '2px solid #e0e4ea', fontWeight: 700, color: '#495057', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((d, i) => {
                    const sc = STATUS_CFG[d.postingStatus] || { label: d.postingStatus, color: '#6c757d', bg: '#f8f9fa' };
                    return (
                      <tr key={d.ID} style={{ background: i % 2 ? '#fafafa' : '#fff', borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '0.55rem 0.85rem' }}>
                          <span style={{ fontWeight: 700, color: '#1a2332' }}>{(d.tankId || '').replace(/^0+/, '') || d.tankId}</span>
                          {d.tankName && <div style={{ fontSize: '0.72rem', color: '#6c757d', marginTop: '0.1rem' }}>{d.tankName}</div>}
                        </td>
                        <td style={{ padding: '0.55rem 0.85rem', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 500 }}>{d.measurementDate}</span>
                          {d.measurementTime ? <div style={{ fontSize: '0.72rem', color: '#6c757d' }}>{d.measurementTime.slice(0,2)}:{d.measurementTime.slice(2,4)}</div> : ''}
                        </td>
                        <td style={{ padding: '0.55rem 0.85rem' }}>
                          <span title={d.dipType === 'I' ? 'Innage' : d.dipType === 'U' ? 'Ullage' : ''}>
                            {d.dipType === 'I' ? 'I – Innage' : d.dipType === 'U' ? 'U – Ullage' : d.dipType}
                          </span>
                        </td>
                        <td style={{ padding: '0.55rem 0.85rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {parseFloat(d.dipValue || 0).toFixed(1)} {d.dipUnit}
                        </td>
                        <td style={{ padding: '0.55rem 0.85rem', textAlign: 'right', color: d.waterHeight ? '#1a2332' : '#adb5bd' }}>
                          {d.waterHeight ? parseFloat(d.waterHeight).toFixed(1) : '–'}
                        </td>
                        <td style={{ padding: '0.55rem 0.85rem', textAlign: 'right', color: d.temperature != null ? '#1a2332' : '#adb5bd' }}>
                          {d.temperature != null ? d.temperature + ' °C' : '–'}
                        </td>
                        <td style={{ padding: '0.55rem 0.85rem', fontSize: '0.75rem', color: '#6c757d' }}>
                          {INPUT_METHODS[d.inputMethod] || d.inputMethod}
                        </td>
                        <td style={{ padding: '0.55rem 0.85rem' }}>
                          {sc.clickable ? (
                            <button
                              onClick={() => setDetailDip(d)}
                              style={{ ...S.badge(sc), cursor: 'pointer', border: 'none', textDecoration: 'underline dotted' }}
                              title="Click for details and next steps">
                              {sc.label}
                            </button>
                          ) : (
                            <span style={S.badge(sc)}>{sc.label}</span>
                          )}
                        </td>
                        <td style={{ padding: '0.55rem 0.85rem' }}>
                          {(d.postingStatus === 'DRAFT' || d.postingStatus === 'FAILED') && (
                            <button
                              style={{ ...S.btnSuccess, fontSize: '0.73rem', padding: '0.2rem 0.55rem' }}
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
