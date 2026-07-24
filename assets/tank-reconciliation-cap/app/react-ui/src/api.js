/**
 * API client for the CAP ReconciliationService.
 */

const ODATA_BASE = (import.meta.env.VITE_CAP_URL || '').replace(/\/$/, '');
const BASE = ODATA_BASE || '';

// OData query string builder — keeps $ literal, encodes spaces as %20
function odataParams(obj) {
  return Object.entries(obj).map(function(entry) {
    var k = entry[0];
    var v = String(entry[1]);
    var key = k.startsWith('$') ? k : encodeURIComponent(k);
    var val = encodeURIComponent(v).replace(/%24/g, '$');
    return key + '=' + val;
  }).join('&');
}

async function odata(path, options) {
  options = options || {};
  var url = ODATA_BASE + path;
  var res = await fetch(url, {
    headers: Object.assign({ 'Accept': 'application/json', 'Content-Type': 'application/json' }, options.headers || {}),
    method: options.method || 'GET',
    body: options.body
  });
  if (!res.ok) {
    var text = await res.text().catch(function() { return res.statusText; });
    throw new Error(res.status + ' ' + text);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function action(name, body) {
  body = body || {};
  var url = BASE + '/reconciliation/' + name;
  var res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    var msg = res.statusText;
    try { var j = await res.json(); msg = (j.error && j.error.message) || JSON.stringify(j); } catch (_) {}
    var err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Reconciliation Runs
export async function fetchRuns(params) {
  params = params || {};
  var extra = {};
  Object.entries(params).forEach(function(e) {
    if (e[0] !== 'top') extra[e[0]] = String(e[1]);
  });
  var qp = odataParams(Object.assign({ '$orderby': 'triggeredAt desc', '$expand': 'tankResults', '$top': params.top || 50 }, extra));
  var data = await odata('/reconciliation/ReconciliationRuns?' + qp);
  return data.value || [];
}

export async function fetchRun(id) {
  return odata("/reconciliation/ReconciliationRuns('" + id + "')?$expand=tankResults,auditEntries");
}

// Tank Results
export async function fetchTankResults(runId) {
  var qp = odataParams({ '$filter': "run_ID eq '" + runId + "'", '$orderby': 'classification desc' });
  var data = await odata('/reconciliation/TankResults?' + qp);
  return data.value || [];
}

export async function fetchPendingApprovals() {
  var qp = odataParams({
    '$filter': "classification eq 'RED' and postingStatus eq 'PENDING'",
    '$expand': 'run',
    '$orderby': 'run/runDate desc'
  });
  var data = await odata('/reconciliation/TankResults?' + qp);
  return data.value || [];
}

// Tank Configuration
export async function fetchTankConfigurations() {
  var data = await odata('/reconciliation/TankConfigurations?$orderby=tankId');
  return data.value || [];
}

export async function updateTankConfiguration(tankId, patch) {
  return odata("/reconciliation/TankConfigurations('" + tankId + "')", {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
}

// Audit Log
export async function fetchAuditLog(params) {
  params = params || {};
  var qp = odataParams(Object.assign({ '$orderby': 'timestamp desc', '$top': 200 }, params));
  var data = await odata('/reconciliation/AuditLog?' + qp);
  return data.value || [];
}

// Plants (live from S/4HANA via getPlants action)
export async function fetchPlants() {
  var res = await action('getPlants', {});
  return Array.isArray(res) ? res : (res && res.value ? res.value : []);
}

// Reason Codes (live from T157D/T157E via OGS)
export async function fetchReasonCodes() {
  var res = await action('getReasonCodes', {});
  return Array.isArray(res) ? res : (res && res.value ? res.value : []);
}

// Actions
export async function triggerRun(runDate, plant) {
  var body = { runDate: runDate };
  if (plant) body.plant = plant;
  return action('triggerRun', body);
}

export async function approvePosting(tankResultId, comment) {
  return action('approvePosting', { tankResultId: tankResultId, comment: comment });
}

export async function rejectPosting(tankResultId, comment) {
  return action('rejectPosting', { tankResultId: tankResultId, comment: comment });
}

export async function retriggerDataCollection(runId) {
  return action('retriggerDataCollection', { runId: runId });
}

// Variance Trend
export async function fetchVarianceTrend(tankId, days) {
  days = days || 30;
  var since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  var filter = tankId
    ? "tankId eq '" + tankId + "' and runDate ge '" + since + "'"
    : "runDate ge '" + since + "'";
  var qp = odataParams({ '$filter': filter, '$orderby': 'tankId,runDate desc', '$top': 200 });
  var data = await odata('/reconciliation/TankVarianceTrend?' + qp);
  return data.value || [];
}

// Terminals
export async function fetchTerminals() {
  var data = await odata('/reconciliation/TankConfigurations?$select=terminalId,terminalName&$orderby=terminalId');
  var seen = new Set();
  return (data.value || []).filter(function(t) {
    if (seen.has(t.terminalId)) return false;
    seen.add(t.terminalId);
    return true;
  });
}

// AI Chat
export async function chat(message, sessionId) {
  return action('chat', { message: message, sessionId: sessionId || '' });
}
