'use strict';

const cds = require('@sap/cds');

// S4HANA destination name — resolved at runtime via SAP Destination Service
const S4HANA_DESTINATION = process.env.S4HANA_DESTINATION_NAME || 'OGS_S4';
const AICORE_DESTINATION  = process.env.AICORE_DESTINATION_NAME || 'aicore';

const S4_PLANT_PATH = '/sap/opu/odata/sap/ZTANK_PLANT_SRV_SRV';
const S4_DIP_PATH   = '/sap/opu/odata/sap/ZTANK_DIP_SRV_SRV';

// ── IS-OIL HPM helpers ────────────────────────────────────────────────────────

/**
 * Fetch latest tank dip from ZTANK_DIP_SRV_SRV for a given SOCNR (tank ID).
 * Returns { physicalQty, bookStock, uom } or null on error.
 */
async function _fetchTankDip(socnr) {
  if (!socnr) return null;
  try {
    const cfg     = await _resolveDestination(S4HANA_DESTINATION);
    const baseUrl = (cfg.URL || cfg.url || '').replace(/\/$/, '');
    if (!baseUrl) return null;

    const authHeader = _basicAuthHeader(cfg);
    const filter = "Socnr eq '" + socnr + "'";
    const path   = S4_DIP_PATH + '/TankDipSet'
      + '?$filter=' + encodeURIComponent(filter)
      + '&$orderby=' + encodeURIComponent('Etmstm desc')
      + '&$top=1&$format=json';

    const headers = { Accept: 'application/json' };
    if (authHeader) headers['Authorization'] = authHeader;

    const proxyOpts = cfg._proxyHost ? { host: cfg._proxyHost, port: cfg._proxyPort, token: cfg._proxyToken, locationId: cfg._locationId } : null;
    const res = await _httpGet(baseUrl + path, headers, proxyOpts);
    if (res.status !== 200) {
      cds.log('s4').warn('ZTANK_DIP_SRV returned ' + res.status + ' for SOCNR ' + socnr);
      return null;
    }
    const payload = JSON.parse(res.body);
    const records = (payload.d && payload.d.results) ? payload.d.results : [];
    if (!records.length) return null;

    const r = records[0];
    return {
      physicalQty : parseFloat(r.QuanSku  || '0'),
      bookStock   : parseFloat(r.Relstock || '0'),
      uom         : r.Meins || '',
      timestamp   : r.Etmstm || '',
      volumeLvc   : parseFloat(r.QuanLvc || '0')
    };
  } catch (err) {
    cds.log('s4').warn('Failed to fetch tank dip: ' + err.message);
    return null;
  }
}

/**
 * Legacy stubs — kept for compatibility, now delegated to _fetchTankDip.
 */
async function _fetchBookStock(materialId, plant) { return null; }
async function _fetchPhysicalInventory(materialId, plant) { return null; }


/**
 * Fetch plant list from API_PLANT_SRV.
 * Returns array of { Plant, PlantName } or empty array on error.
 */
async function _fetchPlants() {
  try {
    const cfg     = await _resolveDestination(S4HANA_DESTINATION);
    const baseUrl = (cfg.URL || cfg.url || '').replace(/\/$/, '');
    if (!baseUrl) return [];

    cds.log('s4').info('_fetchPlants: baseUrl=' + baseUrl + ' proxyHost=' + (cfg._proxyHost || 'none') + ' proxyType=' + (cfg.ProxyType || cfg.proxyType || 'none') + ' locationId=' + (cfg._locationId || 'none'));

    const authHeader = _basicAuthHeader(cfg);
    const path = S4_PLANT_PATH
      + '/PlantsSet?$select=Plant,Plantname&$top=500&$format=json';

    const headers = { Accept: 'application/json' };
    if (authHeader) headers['Authorization'] = authHeader;

    const proxyOpts = cfg._proxyHost ? { host: cfg._proxyHost, port: cfg._proxyPort, token: cfg._proxyToken, locationId: cfg._locationId } : null;
    const fullUrl = baseUrl + path;
    cds.log('s4').info('_fetchPlants calling: ' + fullUrl + (proxyOpts ? ' via proxy ' + proxyOpts.host + ':' + proxyOpts.port : ''));
    const res = await _httpGet(fullUrl, headers, proxyOpts);
    if (res.status !== 200) {
      cds.log('s4').warn('ZTANK_PLANT_SRV_SRV returned ' + res.status + ' body=' + res.body.slice(0, 200));
      return [];
    }
    const payload = JSON.parse(res.body);
    return (payload.d && payload.d.results) ? payload.d.results : [];
  } catch (err) {
    cds.log('s4').warn('Failed to fetch plants: ' + err.message);
    return [];
  }
}

/** Build a Basic Authorization header value from destination config (BasicAuthentication). */
function _basicAuthHeader(cfg) {
  const user = cfg.User || cfg.user || '';
  const pass = cfg.Password || cfg.password || '';
  if (!user) return null;
  return 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
}

// ── Service module ────────────────────────────────────────────────────────────

module.exports = class ReconciliationService extends cds.ApplicationService {

  async init() {

    // ── triggerRun ──────────────────────────────────────────────────────────
    this.on('triggerRun', async (req) => {
      const { runDate } = req.data;
      if (!runDate) return req.reject(400, 'runDate is required');

      const existing = await SELECT.one
        .from('tank.reconciliation.ReconciliationRun')
        .where({ runDate, status: { '!=': 'FAILED' } });
      if (existing) return req.reject(409, 'A run already exists for ' + runDate + ' (status: ' + existing.status + ')');

      const runId = cds.utils.uuid();
      const now   = new Date().toISOString();
      const actor = (req.user && req.user.id) || 'scheduler';

      await INSERT.into('tank.reconciliation.ReconciliationRun').entries({
        ID: runId, runDate, status: 'PROCESSING', triggeredBy: actor, triggeredAt: now
      });
      await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
        ID: cds.utils.uuid(), run_ID: runId,
        step: 'INGEST', milestone: 'M1', outcome: 'ACHIEVED',
        message: 'M1.trigger: reconciliation run initiated for ' + runDate,
        timestamp: now, actor
      });

      // Fetch all active tank configs and pull live IS-OIL dip data
      const tanks = await SELECT.from('tank.reconciliation.TankConfiguration').where({ active: true });
      let okCount = 0, flagCount = 0, urgentCount = 0;

      for (const tank of tanks) {
        // Use tankId as SOCNR for IS-OIL dip lookup
        cds.log('s4').info('triggerRun: fetching dip for SOCNR=' + tank.tankId);
        const dipData = await _fetchTankDip(tank.tankId);

        const physicalQty = dipData ? dipData.physicalQty : 0;
        const bookStock   = dipData ? dipData.bookStock   : 0;
        const s4Source    = dipData ? 'ISOIL_LIVE' : 'FALLBACK';

        // Delta = physical dip quantity minus book stock (IS-OIL reconciliation)
        const delta        = physicalQty - bookStock;
        const deltaPercent = bookStock > 0 ? Math.abs(delta / bookStock) * 100 : 0;
        const netVolumePhysical = physicalQty;

        let classification = 'OK';
        if      (deltaPercent > (tank.toleranceFlagPct || 0.25)) classification = 'URGENT';
        else if (deltaPercent > (tank.toleranceOkPct  || 0.10)) classification = 'FLAG';

        if      (classification === 'OK')     okCount++;
        else if (classification === 'FLAG')   flagCount++;
        else if (classification === 'URGENT') urgentCount++;

        const resultId = cds.utils.uuid();
        await INSERT.into('tank.reconciliation.TankResult').entries({
          ID: resultId,
          run_ID: runId,
          tankId: tank.tankId,
          tankName: tank.tankName,
          materialId: tank.materialId,
          plant: tank.plant,
          grossVolumeObserved: netVolumePhysical,
          netVolumePhysical,
          bookStock,
          delta,
          deltaPercent,
          classification,
          toleranceOkPct:   tank.toleranceOkPct  || 0.10,
          toleranceFlagPct: tank.toleranceFlagPct || 0.25,
          postingStatus:    classification === 'URGENT' ? 'PENDING' : 'AUTO_POSTED',
          vcfSource: s4Source,
          vcfFactor: 1.0
        });

        await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
          ID: cds.utils.uuid(), run_ID: runId, tankId: tank.tankId,
          step: 'RECONCILE', milestone: 'M2', outcome: 'ACHIEVED',
          message: 'M2.reconciled: ' + tank.tankId
            + ' bookStock=' + bookStock.toFixed(2)
            + ' netPhysical=' + netVolumePhysical.toFixed(2)
            + ' delta=' + delta.toFixed(2)
            + ' (' + deltaPercent.toFixed(4) + '%)'
            + ' class=' + classification
            + ' source=' + s4Source,
          timestamp: new Date().toISOString(), actor
        });
      }

      await UPDATE('tank.reconciliation.ReconciliationRun', runId).with({
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
        tankCount: tanks.length,
        okCount, flagCount, urgentCount
      });

      await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
        ID: cds.utils.uuid(), run_ID: runId,
        step: 'COMPLETE', milestone: 'M5', outcome: 'ACHIEVED',
        message: 'M5.complete: run finished — ' + tanks.length + ' tanks (OK:' + okCount + ' FLAG:' + flagCount + ' URGENT:' + urgentCount + ')',
        timestamp: new Date().toISOString(), actor
      });

      const webhookUrl = process.env.N8N_WEBHOOK_URL;
      if (webhookUrl) _notifyWebhook(webhookUrl, { runId, runDate, triggeredBy: actor, okCount, flagCount, urgentCount });

      return { runId, status: 'COMPLETED' };
    });

    // ── approvePosting ───────────────────────────────────────────────────────
    this.on('approvePosting', async (req) => {
      const { tankResultId, comment } = req.data;
      if (!tankResultId) return req.reject(400, 'tankResultId is required');

      const result = await SELECT.one.from('tank.reconciliation.TankResult').where({ ID: tankResultId });
      if (!result) return req.reject(404, 'TankResult not found');
      if (result.classification !== 'URGENT') return req.reject(400, 'Only URGENT tanks require approval');
      if (result.postingStatus  !== 'PENDING') return req.reject(409, 'Tank is already in status: ' + result.postingStatus);

      const now       = new Date().toISOString();
      const decidedBy = (req.user && req.user.id) || 'supervisor';

      await INSERT.into('tank.reconciliation.ApprovalRecord').entries({
        ID: cds.utils.uuid(), tankResult_ID: tankResultId, run_ID: result.run_ID,
        decision: 'APPROVED', decidedBy, decidedAt: now, comment: comment || ''
      });
      await UPDATE('tank.reconciliation.TankResult', tankResultId).with({ postingStatus: 'APPROVED' });
      await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
        ID: cds.utils.uuid(), run_ID: result.run_ID, tankId: result.tankId,
        step: 'APPROVAL', milestone: 'M4', outcome: 'ACHIEVED',
        message: 'M4.achieved: URGENT variance approved for tank ' + result.tankId + ' — approver=' + decidedBy,
        timestamp: now, actor: decidedBy
      });

      const callbackUrl = process.env.N8N_APPROVAL_CALLBACK_URL;
      if (callbackUrl) _notifyWebhook(callbackUrl, { tankResultId, decision: 'APPROVED', runId: result.run_ID, decidedBy });
      return { success: true, message: 'Tank ' + result.tankId + ' approved for posting' };
    });

    // ── rejectPosting ────────────────────────────────────────────────────────
    this.on('rejectPosting', async (req) => {
      const { tankResultId, comment } = req.data;
      if (!tankResultId) return req.reject(400, 'tankResultId is required');
      if (!comment || comment.trim().length === 0) return req.reject(400, 'comment is mandatory for rejection');

      const result = await SELECT.one.from('tank.reconciliation.TankResult').where({ ID: tankResultId });
      if (!result) return req.reject(404, 'TankResult not found');
      if (result.classification !== 'URGENT') return req.reject(400, 'Only URGENT tanks require approval');
      if (result.postingStatus  !== 'PENDING') return req.reject(409, 'Tank is already in status: ' + result.postingStatus);

      const now       = new Date().toISOString();
      const decidedBy = (req.user && req.user.id) || 'supervisor';

      await INSERT.into('tank.reconciliation.ApprovalRecord').entries({
        ID: cds.utils.uuid(), tankResult_ID: tankResultId, run_ID: result.run_ID,
        decision: 'REJECTED', decidedBy, decidedAt: now, comment
      });
      await UPDATE('tank.reconciliation.TankResult', tankResultId).with({
        postingStatus: 'REJECTED', rejectionReason: comment
      });
      await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
        ID: cds.utils.uuid(), run_ID: result.run_ID, tankId: result.tankId,
        step: 'APPROVAL', milestone: 'M4', outcome: 'ACHIEVED',
        message: 'M4.achieved: URGENT variance rejected for tank ' + result.tankId + ' — approver=' + decidedBy + ', reason: ' + comment,
        timestamp: now, actor: decidedBy
      });

      const callbackUrl = process.env.N8N_APPROVAL_CALLBACK_URL;
      if (callbackUrl) _notifyWebhook(callbackUrl, { tankResultId, decision: 'REJECTED', runId: result.run_ID, decidedBy, comment });
      return { success: true, message: 'Tank ' + result.tankId + ' posting rejected' };
    });

    // ── retriggerDataCollection (R11) ───────────────────────────────────────
    this.on('retriggerDataCollection', async (req) => {
      const { runId } = req.data;
      if (!runId) return req.reject(400, 'runId is required');

      const run = await SELECT.one.from('tank.reconciliation.ReconciliationRun').where({ ID: runId });
      if (!run) return req.reject(404, 'ReconciliationRun not found');

      if (!['FAILED', 'PENDING'].includes(run.status)) {
        return req.reject(409, "Run cannot be re-triggered from status '" + run.status + "'. Only FAILED or PENDING runs may be re-triggered.");
      }

      const now   = new Date().toISOString();
      const actor = (req.user && req.user.id) || 'system';

      await UPDATE('tank.reconciliation.ReconciliationRun', runId).with({
        status: 'PENDING',
        auditNotes: 'Re-triggered by ' + actor + ' at ' + now
      });
      await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
        ID: cds.utils.uuid(), run_ID: runId,
        step: 'INGEST', milestone: 'M1', outcome: 'ACHIEVED',
        message: 'M1.retrigger: data collection re-triggered by ' + actor + ' for run ' + runId,
        timestamp: now, actor
      });

      const webhookUrl = process.env.N8N_WEBHOOK_URL;
      if (webhookUrl) _notifyWebhook(webhookUrl, { runId, runDate: run.runDate, triggeredBy: actor, retrigger: true });

      return { success: true, message: 'Data collection re-triggered for run ' + runId + ' (date: ' + run.runDate + ')' };
    });

    // ── chat ─────────────────────────────────────────────────────────────────
    this.on('chat', async (req) => {
      const { message } = req.data;
      if (!message || message.trim().length === 0) return req.reject(400, 'message is required');

      const latestRun = await SELECT.one
        .from('tank.reconciliation.ReconciliationRun')
        .orderBy({ runDate: 'desc' });

      let tankSummary = 'No reconciliation data available yet.';
      let sources     = '';

      if (latestRun) {
        const tanks   = await SELECT.from('tank.reconciliation.TankResult')
          .where({ run_ID: latestRun.ID }).orderBy({ deltaPercent: 'desc' });
        const urgent  = tanks.filter(t => t.classification === 'URGENT');
        const flagged = tanks.filter(t => t.classification === 'FLAG');

        tankSummary = [
          'Latest run: ' + latestRun.runDate + ' (status: ' + latestRun.status + ')',
          'Tanks: ' + (latestRun.tankCount || 0) + ' total — OK: ' + (latestRun.okCount || 0) + ', FLAG: ' + (latestRun.flagCount || 0) + ', URGENT: ' + (latestRun.urgentCount || 0),
          urgent.length  ? 'URGENT tanks: '  + urgent.map(t  => t.tankId + ' (' + t.deltaPercent + '%)').join(', ') : '',
          flagged.length ? 'Flagged tanks: ' + flagged.map(t => t.tankId + ' (' + t.deltaPercent + '%)').join(', ') : ''
        ].filter(Boolean).join('\n');

        sources = 'Run ' + latestRun.runDate;
      }

      const systemPrompt =
        'You are a helpful tank stock reconciliation assistant for an oil terminal.\n' +
        'You help operators and supervisors understand daily reconciliation results, variances, and approvals.\n' +
        'Keep answers concise and focused on the data.\n\n' +
        'Current reconciliation context:\n' + tankSummary;

      try {
        const reply = await _callAiCore(systemPrompt, message);
        return { reply, sources };
      } catch (_err) {
        return { reply: _fallbackReply(message, latestRun, tankSummary), sources };
      }
    });

    // ── getPlants ────────────────────────────────────────────────────────────
    this.on('getPlants', async (req) => {
      const plants = await _fetchPlants();
      return plants.map(p => ({ Plant: p.Plant, PlantName: p.Plantname || p.PlantName || p.Plant }));
    });

    return super.init();
  }
};

// ── Destination Service resolver ──────────────────────────────────────────────

async function _resolveDestination(destName) {
  const vcap        = JSON.parse(process.env.VCAP_SERVICES || '{}');
  const destBinding = (vcap['destination'] || [])[0];
  if (!destBinding) throw new Error("No 'destination' service bound in VCAP_SERVICES");
  const dc = destBinding.credentials;

  const svcToken = await _fetchOAuthTokenHttp(dc.url, dc.clientid, dc.clientsecret);
  const destUrl  = dc.uri.replace(/\/$/, '') + '/destination-configuration/v1/destinations/' + destName;
  const res = await _httpGet(destUrl, { Authorization: 'Bearer ' + svcToken, Accept: 'application/json' });
  if (res.status >= 400) throw new Error('Destination service ' + res.status + ' for ' + destName + ': ' + res.body);
  const payload = JSON.parse(res.body);
  const cfg = payload.destinationConfiguration || {};

  // For OnPremise destinations, attach connectivity proxy info
  if (cfg.ProxyType === 'OnPremise' || cfg.proxyType === 'OnPremise') {
    const connBinding = (vcap['connectivity'] || [])[0];
    if (connBinding) {
      const cc = connBinding.credentials;
      const proxyToken = await _fetchOAuthTokenHttp(cc.token_service_url || cc.url, cc.clientid, cc.clientsecret);
      cfg._proxyHost   = cc.onpremise_proxy_host || 'connectivityproxy.internal.cf.us10.hana.ondemand.com';
      cfg._proxyPort   = parseInt(cc.onpremise_proxy_http_port || cc.onpremise_proxy_port || '20003');
      cfg._proxyToken  = proxyToken;
      cfg._locationId  = cfg.CloudConnectorLocationId || cfg['sap-connectivity-scc-location_id'] || 'APAC_DEV10';
    }
  }
  return cfg;
}

// ── AI Core integration ───────────────────────────────────────────────────────

async function _callAiCore(systemPrompt, userMessage) {
  const cfg = await _resolveDestination(AICORE_DESTINATION);

  const baseUrl       = (cfg.URL || '').replace(/\/$/, '');
  const clientId      = cfg.clientId      || cfg['Authentication.clientId']      || '';
  const clientSecret  = cfg.clientSecret  || cfg['Authentication.clientSecret']  || '';
  const tokenUrl      = cfg.tokenServiceURL || cfg.TokenServiceURL || '';
  const resourceGroup = cfg['URL.headers.AI-Resource-Group'] || cfg.AI_RESOURCE_GROUP || 'default';
  const deploymentId  = process.env.AICORE_DEPLOYMENT_ID || '';

  if (!baseUrl || !clientId || !clientSecret || !tokenUrl) {
    throw new Error("Destination '" + AICORE_DESTINATION + "' missing URL/clientId/clientSecret/tokenServiceURL. Keys: " + Object.keys(cfg).join(', '));
  }

  const token    = await _fetchOAuthTokenHttp(tokenUrl, clientId, clientSecret);
  const chatPath = deploymentId
    ? '/v2/inference/deployments/' + deploymentId + '/chat/completions'
    : '/v2/lm/deployments/chat/completions';

  const body = JSON.stringify({
    model: process.env.AICORE_MODEL || 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage  }
    ],
    max_tokens: 800,
    temperature: 0.3
  });

  const res = await _httpPost(baseUrl + chatPath, body, {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
    'AI-Resource-Group': resourceGroup
  });
  if (res.status >= 400) throw new Error('AI Core HTTP ' + res.status + ': ' + res.body);
  const parsed = JSON.parse(res.body);
  return (parsed.choices && parsed.choices[0] && parsed.choices[0].message)
    ? parsed.choices[0].message.content
    : 'No response from AI';
}

// ── Generic HTTP helpers ──────────────────────────────────────────────────────

async function _fetchOAuthTokenHttp(tokenUrl, clientId, clientSecret) {
  const https = require('https');
  const http  = require('http');
  const body  = 'grant_type=client_credentials';
  const creds = Buffer.from(clientId + ':' + clientSecret).toString('base64');

  return new Promise((resolve, reject) => {
    const url  = new URL('/oauth/token', tokenUrl);
    const lib  = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + creds,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.access_token) resolve(p.access_token);
          else reject(new Error('No access_token in OAuth response: ' + data));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function _httpGet(url, headers, proxyOpts) {
  const https = require('https');
  const http  = require('http');
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    let opts;
    if (proxyOpts && proxyOpts.host) {
      // Route through connectivity proxy for OnPremise destinations
      opts = {
        hostname: proxyOpts.host,
        port:     proxyOpts.port || 20003,
        path:     url,
        method:   'GET',
        headers:  {
          ...headers,
          'Proxy-Authorization': 'Bearer ' + proxyOpts.token,
          'SAP-Connectivity-SCC-Location_ID': proxyOpts.locationId || ''
        }
      };
    } else {
      opts = {
        hostname: u.hostname,
        port:     u.port || (u.protocol === 'https:' ? 443 : 80),
        path:     u.pathname + u.search,
        method:   'GET',
        headers
      };
    }
    const lib = (proxyOpts && proxyOpts.host) ? http : (u.protocol === 'https:' ? https : http);
    const req = lib.request(opts, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function _httpPost(url, body, headers) {
  const https = require('https');
  const http  = require('http');
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    const lib  = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     u.pathname + u.search,
      method:   'POST',
      headers:  { ...headers, 'Content-Length': Buffer.byteLength(body) }
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function _fallbackReply(message, latestRun, tankSummary) {
  const q = (message || '').toLowerCase();
  if (!latestRun) return 'No reconciliation runs found yet. Trigger a run first.';
  if (q.includes('urgent') || q.includes('critical'))
    return latestRun.urgentCount > 0
      ? 'There are ' + latestRun.urgentCount + ' URGENT variance(s) in the latest run (' + latestRun.runDate + ') requiring supervisor approval.\n\n' + tankSummary
      : 'No URGENT variances in the latest run (' + latestRun.runDate + '). All tanks are within limits.';
  if (q.includes('flag') || q.includes('warning'))
    return 'Latest run (' + latestRun.runDate + '): ' + latestRun.flagCount + ' flagged tank(s).\n\n' + tankSummary;
  if (q.includes('status') || q.includes('latest') || q.includes('last') || q.includes('summary'))
    return tankSummary;
  return 'Here is the latest reconciliation context:\n\n' + tankSummary + '\n\nAsk me about specific tanks, variances, or approvals.';
}

// ── Webhook fire-and-forget ───────────────────────────────────────────────────

function _notifyWebhook(webhookUrl, payload) {
  try {
    const https = require('https');
    const http  = require('http');
    const body  = JSON.stringify(payload);
    const url   = new URL(webhookUrl);
    const lib   = url.protocol === 'https:' ? https : http;
    const opts  = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const r = lib.request(opts, () => {});
    r.on('error', () => {});
    r.write(body);
    r.end();
  } catch (_) { /* ignore */ }
}
