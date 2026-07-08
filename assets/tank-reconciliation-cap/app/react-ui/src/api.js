/**
 * API client for the CAP ReconciliationService.
 * BASE_URL is resolved from the Vite env variable VITE_CAP_URL (default: /reconciliation)
 */

const BASE = (import.meta.env.VITE_CAP_URL || '/reconciliation').replace(/\/$/, '');
const ODATA_BASE = (import.meta.env.VITE_CAP_URL || '').replace(/\/$/, '') || '';

// ── OData helpers ─────────────────────────────────────────────────────────────

async function odata(path, options = {}) {
  const url = `${ODATA_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Action helper ─────────────────────────────────────────────────────────────

async function action(name, body = {}) {
  const url = `${BASE}/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = (j.error && j.error.message) || JSON.stringify(j); } catch (_) {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ── Reconciliation Runs ───────────────────────────────────────────────────────

export async function fetchRuns(params = {}) {
  const qp = new URLSearchParams({
    $orderby: 'runDate desc',
    $expand: 'results',
    $top: params.top || 50,
    ...Object.fromEntries(
      Object.entries(params)
        .filter(([k]) => k !== 'top')
        .map(([k, v]) => [k, String(v)])
    )
  });
  const data = await odata(`/reconciliation/ReconciliationRuns?${qp}`);
  return data.value || [];
}

export async function fetchRun(id) {
  const data = await odata(`/reconciliation/ReconciliationRuns(${id})?$expand=results,approvals,auditLog`);
  return data;
}

// ── Tank Results ──────────────────────────────────────────────────────────────

export async function fetchTankResults(runId) {
  const data = await odata(`/reconciliation/TankResults?$filter=run_ID eq ${runId}&$orderby=classification desc`);
  return data.value || [];
}

export async function fetchPendingApprovals() {
  const data = await odata(`/reconciliation/TankResults?$filter=classification eq 'URGENT' and postingStatus eq 'PENDING'&$expand=run&$orderby=run/runDate desc`);
  return data.value || [];
}

// ── Tank Configuration ────────────────────────────────────────────────────────

export async function fetchTankConfigurations() {
  const data = await odata(`/reconciliation/TankConfigurations?$orderby=tankId`);
  return data.value || [];
}

export async function updateTankConfiguration(tankId, patch) {
  return odata(`/reconciliation/TankConfigurations('${tankId}')`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

export async function fetchAuditLog(params = {}) {
  const qp = new URLSearchParams({ $orderby: 'timestamp desc', $top: 200, ...params });
  const data = await odata(`/reconciliation/AuditLogEntries?${qp}`);
  return data.value || [];
}

// ── Actions ───────────────────────────────────────────────────────────────────

export async function triggerRun(runDate) {
  return action('triggerRun', { runDate });
}

export async function approvePosting(tankResultId, comment) {
  return action('approvePosting', { tankResultId, comment });
}

export async function rejectPosting(tankResultId, comment) {
  return action('rejectPosting', { tankResultId, comment });
}

// ── R11: Re-trigger Data Collection ──────────────────────────────────────────

export async function retriggerDataCollection(runId) {
  return action('retriggerDataCollection', { runId });
}

// ── R12: Tank Variance Trend ──────────────────────────────────────────────────

export async function fetchVarianceTrend(tankId, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const filter = tankId
    ? `tankId eq '${tankId}' and runDate ge '${since}'`
    : `runDate ge '${since}'`;
  const data = await odata(
    `/reconciliation/TankVarianceTrend?$filter=${encodeURIComponent(filter)}&$orderby=tankId,runDate desc&$top=200`
  );
  return data.value || [];
}

// ── R13: Terminals (filtered TankConfiguration) ───────────────────────────────

export async function fetchTerminals() {
  const data = await odata(`/reconciliation/TankConfigurations?$select=terminalId,terminalName&$orderby=terminalId`);
  const seen = new Set();
  return (data.value || []).filter(t => {
    if (seen.has(t.terminalId)) return false;
    seen.add(t.terminalId);
    return true;
  });
}

// ── AI Chat ───────────────────────────────────────────────────────────────────

export async function chat(message, sessionId) {
  return action('chat', { message, sessionId: sessionId || '' });
}
