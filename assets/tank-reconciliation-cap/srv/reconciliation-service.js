'use strict';

const cds = require('@sap/cds');

// S4HANA destination name — resolved at runtime via SAP Destination Service
const S4HANA_DESTINATION = process.env.S4HANA_DESTINATION_NAME || 'OGS_S4';
const AICORE_DESTINATION  = process.env.AICORE_DESTINATION_NAME || 'aicore';

const S4_PLANT_PATH   = '/sap/opu/odata/sap/ZTANK_PLANT_SRV_SRV';
const S4_DIP_PATH     = '/sap/opu/odata/sap/ZTANK_DIP_SRV_SRV';
const S4_POSTING_PATH = '/sap/opu/odata/sap/ZTANK_POST_SRV_SRV';

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
 * Legacy stubs — no longer used, kept to avoid reference errors.
 */
async function _fetchBookStock() { return null; }
async function _fetchPhysicalInventory() { return null; }

/**
 * Post a tank dip goods movement via ZTANK_POST_SRV_SRV in OGS.
 * Returns { success, materialDocument, message }
 */
async function _postTankDip(socnr, etmstm, quanSku, relstock, meins) {
  try {
    const cfg     = await _resolveDestination(S4HANA_DESTINATION);
    const baseUrl = (cfg.URL || cfg.url || '').replace(/\/$/, '');
    if (!baseUrl) return { success: false, message: 'S4HANA destination URL not found' };

    const authHeader = _basicAuthHeader(cfg);
    const proxyOpts  = cfg._proxyHost ? { host: cfg._proxyHost, port: cfg._proxyPort, token: cfg._proxyToken, locationId: cfg._locationId } : null;

    // Step 1: Fetch CSRF token and session cookie in one request
    const tokenHeaders = { Accept: 'application/json', 'x-csrf-token': 'Fetch' };
    if (authHeader) tokenHeaders['Authorization'] = authHeader;

    const tokenRes = await _httpGet(baseUrl + S4_POSTING_PATH + '/TankPostingSet', tokenHeaders, proxyOpts);
    const csrfToken = (tokenRes.headers && (tokenRes.headers['x-csrf-token'] || tokenRes.headers['X-CSRF-Token'])) || null;

    // Extract session cookie from response
    const setCookie = tokenRes.headers && tokenRes.headers['set-cookie'];
    let sessionCookie = '';
    if (setCookie) {
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
    }

    cds.log('s4').info('_postTankDip: CSRF=' + (csrfToken ? 'found' : 'MISSING') + ' cookie=' + (sessionCookie ? 'found' : 'MISSING') + ' status=' + tokenRes.status);

    // Step 2: POST with CSRF token and session cookie
    const body = JSON.stringify({
      Socnr:    socnr,
      Etmstm:   etmstm,
      QuanSku:  String(quanSku),
      Relstock: String(relstock),
      Meins:    meins,
      Socev:    'C'
    });

    const postHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (authHeader)    postHeaders['Authorization']  = authHeader;
    if (csrfToken)     postHeaders['x-csrf-token']   = csrfToken;
    if (sessionCookie) postHeaders['Cookie']          = sessionCookie;

    const res = await _httpPost(baseUrl + S4_POSTING_PATH + '/TankPostingSet', body, postHeaders, proxyOpts);
    cds.log('s4').info('_postTankDip POST status=' + res.status);

    if (res.status === 201 || res.status === 200) {
      const payload = JSON.parse(res.body);
      const d = payload.d || {};
      return {
        success:          true,
        materialDocument: d.MaterialDocument || '',
        message:          d.PostingResult || 'Posting completed'
      };
    } else {
      let errMsg = 'HTTP ' + res.status;
      try { errMsg = JSON.parse(res.body)?.error?.message?.value || errMsg; } catch(_) {}
      return { success: false, message: errMsg };
    }
  } catch (err) {
    return { success: false, message: 'Posting failed: ' + err.message };
  }
}


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

// ── Inline reconciliation (dev/demo mode when N8N_WEBHOOK_URL not set) ────────
async function _runInlineReconciliation(runId, runDate, actor) {
  try {
    await UPDATE('tank.reconciliation.ReconciliationRun', runId).with({ status: 'INGESTING' });

    const tanks = await SELECT.from('tank.reconciliation.TankConfiguration').where({ active: true });
    let okCount = 0, flagCount = 0, urgentCount = 0;

    for (const tank of tanks) {
      cds.log('s4').info('inline reconciliation: fetching dip for SOCNR=' + tank.tankId);
      const dipData = await _fetchTankDip(tank.tankId);

      const physicalQty         = dipData ? dipData.physicalQty : null;
      const bookStock           = dipData ? dipData.bookStock   : null;
      const s4Source            = dipData ? 'ISOIL_LIVE' : null;

      // If no live data available, fail this tank
      if (!dipData || physicalQty === null || bookStock === null) {
        cds.log('s4').warn('No live dip data for tank ' + tank.tankId + ' — skipping');
        await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
          ID: cds.utils.uuid(), run_ID: runId, tankId: tank.tankId,
          step: 'INGEST', milestone: 'M1', outcome: 'FAILED',
          message: 'M1.failed: no live dip data available for tank ' + tank.tankId,
          timestamp: new Date().toISOString(), actor
        });
        continue;
      }

      const grossVolumeObserved = physicalQty;

      // M2: VCF Correction — attempt Hydrocarbon Qty Conversion API, fallback to ASTM 1.0
      let vcfFactor  = 1.0;
      let vcfSource2 = 'ASTM_FALLBACK';
      try {
        const vcfApiUrl = process.env.VCF_API_URL;
        if (vcfApiUrl) {
          // Call Hydrocarbon Quantity Conversion REST API if configured
          const vcfPayload = JSON.stringify({ material: tank.materialId, grossVolume: grossVolumeObserved, uom: dipData.uom || 'TO' });
          const vcfRes = await _httpPost(vcfApiUrl, vcfPayload, { 'Content-Type': 'application/json' });
          if (vcfRes.status === 200) {
            const vcfData = JSON.parse(vcfRes.body);
            vcfFactor  = vcfData.vcfFactor || 1.0;
            vcfSource2 = 'API';
          }
        }
      } catch (_) { /* ASTM fallback */ }

      const netVolumePhysical = grossVolumeObserved * vcfFactor;

      // M2 audit entry
      await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
        ID: cds.utils.uuid(), run_ID: runId, tankId: tank.tankId,
        step: 'VCF', milestone: 'M2', outcome: 'ACHIEVED',
        message: 'M2.vcf: grossVolume=' + grossVolumeObserved.toFixed(3)
          + ' vcfFactor=' + vcfFactor.toFixed(6)
          + ' netVolume=' + netVolumePhysical.toFixed(3)
          + ' source=' + vcfSource2
          + (vcfSource2 === 'ASTM_FALLBACK' ? ' (VCF_API_URL not configured — using factor 1.0)' : ''),
        timestamp: new Date().toISOString(), actor
      });

      const delta        = netVolumePhysical - bookStock;
      const deltaPercent = bookStock > 0 ? Math.abs(delta / bookStock) * 100 : 0;

      let classification = 'OK';
      if      (deltaPercent > (tank.toleranceFlagPct || 0.25)) classification = 'URGENT';
      else if (deltaPercent > (tank.toleranceOkPct  || 0.10)) classification = 'FLAG';

      if      (classification === 'OK')     okCount++;
      else if (classification === 'FLAG')   flagCount++;
      else if (classification === 'URGENT') urgentCount++;

      await INSERT.into('tank.reconciliation.TankResult').entries({
        ID: cds.utils.uuid(),
        run_ID: runId,
        tankId: tank.tankId,
        tankName: tank.tankName,
        materialId: tank.materialId,
        plant: tank.plant,
        storageLocation: tank.storageLocation || '',
        uom: dipData ? dipData.uom : 'TO',
        grossVolumeObserved,
        netVolumePhysical,
        bookStock,
        delta,
        deltaPercent,
        classification,
        toleranceOkPct:   tank.toleranceOkPct  || 0.10,
        toleranceFlagPct: tank.toleranceFlagPct || 0.25,
        postingStatus:    'PENDING',
        vcfSource: vcfSource2,
        vcfFactor
      });

      await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
        ID: cds.utils.uuid(), run_ID: runId, tankId: tank.tankId,
        step: 'VARIANCE', milestone: 'M3', outcome: 'ACHIEVED',
        message: 'M3.variance: ' + tank.tankId
          + ' bookStock=' + bookStock.toFixed(3)
          + ' netPhysical=' + netVolumePhysical.toFixed(3)
          + ' delta=' + delta.toFixed(3)
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

    // M6: Send alerts and notifications
    await _sendM6Notifications(runId, runDate, tanks.length, okCount, flagCount, urgentCount);

    await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
      ID: cds.utils.uuid(), run_ID: runId,
      step: 'REPORT', milestone: 'M6', outcome: 'ACHIEVED',
      message: 'M6.complete: run finished — ' + tanks.length + ' tanks (OK:' + okCount + ' FLAG:' + flagCount + ' URGENT:' + urgentCount + ') — alerts sent',
      timestamp: new Date().toISOString(), actor
    });
  } catch (err) {
    cds.log('s4').error('Inline reconciliation failed: ' + err.message);
    await UPDATE('tank.reconciliation.ReconciliationRun', runId).with({ status: 'FAILED' });
  }
}

// ── M6: Alert & Report Distribution ──────────────────────────────────────────

async function _sendM6Notifications(runId, runDate, tankCount, okCount, flagCount, urgentCount) {
  const status = urgentCount > 0 ? 'URGENT' : (flagCount > 0 ? 'FLAG' : 'OK');
  const emoji  = status === 'URGENT' ? '🔴' : (status === 'FLAG' ? '🟡' : '🟢');

  const summary = `${emoji} Tank Reconciliation Run — ${runDate}\n`
    + `Status: ${status}\n`
    + `Tanks: ${tankCount} total | OK: ${okCount} | FLAG: ${flagCount} | URGENT: ${urgentCount}\n`
    + `Run ID: ${runId}`;

  // 1. MS Teams / Generic Webhook
  const teamsUrl = process.env.TEAMS_WEBHOOK_URL;
  if (teamsUrl) {
    try {
      const teamsPayload = JSON.stringify({
        text: summary,
        title: `Tank Reconciliation — ${runDate}`,
        themeColor: status === 'URGENT' ? 'FF0000' : (status === 'FLAG' ? 'FFA500' : '00FF00'),
        sections: [{
          activityTitle: `Run ${runDate}`,
          facts: [
            { name: 'Status',  value: status },
            { name: 'Total Tanks', value: String(tankCount) },
            { name: 'OK',      value: String(okCount) },
            { name: 'FLAG',    value: String(flagCount) },
            { name: 'URGENT',  value: String(urgentCount) }
          ]
        }]
      });
      await _httpPost(teamsUrl, teamsPayload, { 'Content-Type': 'application/json' });
      cds.log('s4').info('M6: Teams notification sent');
    } catch (err) {
      cds.log('s4').warn('M6: Teams notification failed: ' + err.message);
    }
  }

  // 2. BTP Alert Notification Service
  const ansUrl   = process.env.BTP_ANS_URL;
  const ansToken = process.env.BTP_ANS_TOKEN;
  if (ansUrl && ansToken) {
    try {
      const ansPayload = JSON.stringify({
        eventType:   'TankReconciliationCompleted',
        severity:    status === 'URGENT' ? 'ERROR' : (status === 'FLAG' ? 'WARNING' : 'INFO'),
        category:    'ALERT',
        subject:     `Tank Reconciliation ${runDate} — ${status}`,
        body:        summary,
        tags:        { runId, runDate, status }
      });
      await _httpPost(ansUrl + '/cf/producer/v1/resource-events',
        ansPayload,
        { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ansToken });
      cds.log('s4').info('M6: BTP ANS alert sent');
    } catch (err) {
      cds.log('s4').warn('M6: BTP ANS alert failed: ' + err.message);
    }
  }

  if (!teamsUrl && !ansUrl) {
    cds.log('s4').info('M6: No notification channels configured (set TEAMS_WEBHOOK_URL or BTP_ANS_URL)');
  }
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

      // Create run with PENDING status — n8n will drive it through states
      await INSERT.into('tank.reconciliation.ReconciliationRun').entries({
        ID: runId, runDate, status: 'PENDING', triggeredBy: actor, triggeredAt: now
      });

      // M1 audit log
      await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
        ID: cds.utils.uuid(), run_ID: runId,
        step: 'INGEST', milestone: 'M1', outcome: 'ACHIEVED',
        message: 'M1.trigger: reconciliation run initiated for ' + runDate,
        timestamp: now, actor
      });

      // Notify n8n to start the reconciliation workflow
      const webhookUrl = process.env.N8N_WEBHOOK_URL;
      if (webhookUrl) {
        _notifyWebhook(webhookUrl, { runId, runDate });
      } else {
        // No n8n configured — run inline reconciliation for demo/dev purposes
        await _runInlineReconciliation(runId, runDate, actor);
      }

      return { runId, status: 'PENDING' };
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

      await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
        ID: cds.utils.uuid(), run_ID: result.run_ID, tankId: result.tankId,
        step: 'APPROVAL', milestone: 'M4', outcome: 'ACHIEVED',
        message: 'M4.achieved: URGENT variance approved for tank ' + result.tankId + ' — approver=' + decidedBy,
        timestamp: now, actor: decidedBy
      });

      // M5: Attempt goods movement posting via ZTANK_POST_SRV_SRV
      const dipData = await _fetchTankDip(result.tankId);
      const postResult = await _postTankDip(
        result.tankId,
        dipData ? dipData.timestamp : '',
        result.netVolumePhysical,
        result.bookStock,
        result.meins || 'TO'
      );

      if (postResult.success) {
        await UPDATE('tank.reconciliation.TankResult', tankResultId).with({
          postingStatus: 'POSTED',
          materialDocumentId: postResult.materialDocument
        });
        await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
          ID: cds.utils.uuid(), run_ID: result.run_ID, tankId: result.tankId,
          step: 'POSTING', milestone: 'M5', outcome: 'ACHIEVED',
          message: 'M5.posted: goods movement posted — doc=' + postResult.materialDocument + ' — ' + postResult.message,
          timestamp: new Date().toISOString(), actor: decidedBy
        });
      } else {
        await UPDATE('tank.reconciliation.TankResult', tankResultId).with({
          postingStatus: 'FAILED',
          rejectionReason: postResult.message
        });
        await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
          ID: cds.utils.uuid(), run_ID: result.run_ID, tankId: result.tankId,
          step: 'POSTING', milestone: 'M5', outcome: 'FAILED',
          message: 'M5.failed: goods movement posting failed — ' + postResult.message,
          timestamp: new Date().toISOString(), actor: decidedBy
        });
      }

      const callbackUrl = process.env.N8N_APPROVAL_CALLBACK_URL;
      if (callbackUrl) _notifyWebhook(callbackUrl, { tankResultId, decision: 'APPROVED', runId: result.run_ID, decidedBy });
      return { success: true, message: postResult.success
        ? 'Tank ' + result.tankId + ' approved and posted — doc ' + postResult.materialDocument
        : 'Tank ' + result.tankId + ' approved — posting failed: ' + postResult.message
      };
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
      let tanks       = [];

      if (latestRun) {
        tanks   = await SELECT.from('tank.reconciliation.TankResult')
          .where({ run_ID: latestRun.ID }).orderBy({ deltaPercent: 'desc' });
        const urgent       = tanks.filter(t => t.classification === 'URGENT');
        const flagged      = tanks.filter(t => t.classification === 'FLAG');
        const pendingCount = tanks.filter(t => t.classification === 'URGENT' && t.postingStatus === 'PENDING').length;
        const approvedCount = tanks.filter(t => t.postingStatus === 'POSTED').length;
        const rejectedCount = tanks.filter(t => t.postingStatus === 'REJECTED').length;

        tankSummary = [
          'Latest run: ' + latestRun.runDate + ' (status: ' + latestRun.status + ')',
          'Tanks: ' + (latestRun.tankCount || 0) + ' total — OK: ' + (latestRun.okCount || 0) + ', FLAG: ' + (latestRun.flagCount || 0) + ', URGENT: ' + urgent.length,
          pendingCount > 0  ? 'Pending approval: ' + pendingCount + ' tank(s)' : '',
          approvedCount > 0 ? 'Approved/Posted: ' + approvedCount + ' tank(s)' : '',
          rejectedCount > 0 ? 'Rejected: ' + rejectedCount + ' tank(s)' : '',
          urgent.length  ? 'URGENT tanks: '  + urgent.map(t  => t.tankId + ' (' + parseFloat(t.deltaPercent).toFixed(2) + '%) [' + t.postingStatus + ']').join(', ') : '',
          flagged.length ? 'Flagged tanks: ' + flagged.map(t => t.tankId + ' (' + parseFloat(t.deltaPercent).toFixed(2) + '%)').join(', ') : ''
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
        return { reply: _fallbackReply(message, latestRun, tankSummary, tanks || []), sources };
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
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function _httpPost(url, body, headers, proxyOpts) {
  const https = require('https');
  const http  = require('http');
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    let opts;
    if (proxyOpts && proxyOpts.host) {
      opts = {
        hostname: proxyOpts.host,
        port:     proxyOpts.port || 20003,
        path:     url,
        method:   'POST',
        headers:  {
          ...headers,
          'Content-Length': Buffer.byteLength(body),
          'Proxy-Authorization': 'Bearer ' + proxyOpts.token,
          'SAP-Connectivity-SCC-Location_ID': proxyOpts.locationId || ''
        }
      };
    } else {
      opts = {
        hostname: u.hostname,
        port:     u.port || (u.protocol === 'https:' ? 443 : 80),
        path:     u.pathname + u.search,
        method:   'POST',
        headers:  { ...headers, 'Content-Length': Buffer.byteLength(body) }
      };
    }
    const lib = (proxyOpts && proxyOpts.host) ? http : (u.protocol === 'https:' ? https : http);
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

function _fallbackReply(message, latestRun, tankSummary, tanks) {
  const q = (message || '').toLowerCase();
  if (!latestRun) return 'No reconciliation runs found yet. Trigger a run first.';

  tanks = tanks || [];

  // Check if asking about a specific tank by SOCNR (any length) or by tank name
  const socnrMatch = message.match(/\b0+\d+\b/);
  const specificTankId = socnrMatch ? socnrMatch[0].padStart(20, '0') : null;

  // Also match by tank name e.g. USMOB-17T1, USMOB-17T2
  const nameMatch = message.match(/USMOB-\w+/i);
  const specificTank = specificTankId
    ? tanks.find(t => t.tankId === specificTankId || t.tankId.endsWith(specificTankId.replace(/^0+/, '')))
    : nameMatch
      ? tanks.find(t => t.tankName && t.tankName.toUpperCase().includes(nameMatch[0].toUpperCase()))
      : null;

  // Recommendation logic — data-driven, not hallucinated
  if (q.includes('recommend') || q.includes('advice') || q.includes('suggest') || q.includes('what should') || q.includes('what do')) {
    if (specificTank) {
      const pct    = parseFloat(specificTank.deltaPercent || 0);
      const delta  = parseFloat(specificTank.delta || 0);
      const phys   = parseFloat(specificTank.netVolumePhysical || 0);
      const book   = parseFloat(specificTank.bookStock || 0);
      const name   = specificTank.tankName || specificTankId;
      const cls    = specificTank.classification;
      const status = specificTank.postingStatus || 'PENDING';

      // If already actioned — show current status
      if (status === 'REJECTED') {
        return `**Status for ${name} (${specificTankId}):**\n\n` +
          `✗ This posting has already been **REJECTED**.\n` +
          `Variance: ${pct.toFixed(2)}% — Physical: ${phys.toFixed(3)} TO, Book: ${book.toFixed(3)} TO\n\n` +
          `The rejection is recorded in the audit trail. To reconcile this tank correctly:\n` +
          `1. Record a fresh dip in **O4_TIGER** with the current actual measurement\n` +
          `2. Trigger a new reconciliation run\n` +
          `3. The new run will show the corrected variance`;
      }

      if (status === 'POSTED') {
        return `**Status for ${name} (${specificTankId}):**\n\n` +
          `✓ This posting has been **APPROVED and POSTED**.\n` +
          `Variance: ${pct.toFixed(2)}% — Material Document: ${specificTank.materialDocumentId || 'see audit trail'}\n\n` +
          `No further action required for this tank in the current run.`;
      }

      if (cls === 'URGENT' && pct > 500) {
        return `**Recommendation for ${name} (${specificTankId}):**\n\n` +
          `⚠️ Variance: **${pct.toFixed(2)}%** — Physical: ${phys.toFixed(3)} TO, Book: ${book.toFixed(3)} TO, Delta: ${delta.toFixed(3)} TO\n\n` +
          `This extremely large variance (>${pct.toFixed(0)}%) is almost certainly a **data quality issue**, not a physical stock loss:\n\n` +
          `1. The dip record in OIB_TANKDIP may be from a **previous period** (book stock was near zero at that time)\n` +
          `2. The **RELSTOCK** (book stock) in the dip was not updated correctly when the dip was recorded\n` +
          `3. A fresh dip needs to be recorded via **O4_TIGER** with current actual book stock\n\n` +
          `**Action: Reject this posting** and ask the terminal operator to record a fresh dip in O4_TIGER.`;
      }

      if (cls === 'URGENT' && pct <= 500) {
        return `**Recommendation for ${name} (${specificTankId}):**\n\n` +
          `Variance: **${pct.toFixed(2)}%** — Physical: ${phys.toFixed(3)} TO, Book: ${book.toFixed(3)} TO, Delta: ${delta.toFixed(3)} TO\n\n` +
          `This variance exceeds the FLAG threshold (${specificTank.toleranceFlagPct || 0.25}%).\n\n` +
          `Before approving or rejecting:\n` +
          `1. **Verify** the physical dip reading was taken correctly at the right time\n` +
          `2. **Check** if any goods movements (receipts/issues) occurred between the dip and book stock snapshot\n` +
          `3. **Review** if the VCF factor was applied correctly (current: ${specificTank.vcfFactor || 1.0})\n\n` +
          `If the variance is confirmed as legitimate → **Approve** with a comment explaining the cause.\n` +
          `If the reading appears incorrect → **Reject** and re-measure.`;
      }

      if (cls === 'FLAG') {
        return `**Recommendation for ${name} (${specificTankId}):**\n\n` +
          `Variance: **${pct.toFixed(2)}%** — within FLAG range. Physical: ${phys.toFixed(3)} TO, Book: ${book.toFixed(3)} TO.\n\n` +
          `FLAG variances post automatically but are worth monitoring. No immediate action required.`;
      }

      return `Tank **${name}** (${specificTankId}) is classified as **${cls}** with a variance of ${pct.toFixed(2)}%. No action required.`;
    }

    // General recommendation
    const urgentTanks = tanks.filter(t => t.classification === 'URGENT');
    if (urgentTanks.length === 0) return `All tanks are within tolerance in the latest run (${latestRun.runDate}). No action required.`;
    return `**${urgentTanks.length} URGENT tank(s)** require attention:\n\n` +
      urgentTanks.map(t => `- **${t.tankName || t.tankId}**: ${parseFloat(t.deltaPercent).toFixed(2)}% variance`).join('\n') +
      `\n\nGo to **✅ Approval Queue** to review each one.`;
  }

  // Specific tank status query — show status if NOT asking for recommendation
  if (specificTank && !q.includes('recommend') && !q.includes('advice') && !q.includes('suggest') && !q.includes('what should')) {
    const pct = parseFloat(specificTank.deltaPercent || 0);
    return `**${specificTank.tankName || specificTankId}** (${specificTankId}):\n` +
      `- Classification: **${specificTank.classification}**\n` +
      `- Physical: ${parseFloat(specificTank.netVolumePhysical || 0).toFixed(3)} ${specificTank.meins || 'TO'}\n` +
      `- Book Stock: ${parseFloat(specificTank.bookStock || 0).toFixed(3)} ${specificTank.meins || 'TO'}\n` +
      `- Delta: ${parseFloat(specificTank.delta || 0).toFixed(3)} (${pct.toFixed(4)}%)\n` +
      `- Posting Status: ${specificTank.postingStatus || 'PENDING'}\n` +
      `- VCF Source: ${specificTank.vcfSource || 'N/A'}`;
  }

  // Standard queries — each gives a different focused answer
  if (q.includes('urgent') || q.includes('critical')) {
    const urgentTanks = tanks.filter(t => t.classification === 'URGENT');
    const pendingTanks = urgentTanks.filter(t => t.postingStatus === 'PENDING');
    if (urgentTanks.length === 0) return `No URGENT variances in the latest run (${latestRun.runDate}).`;
    return `**URGENT variances in run ${latestRun.runDate}:**\n\n` +
      urgentTanks.map(t => `- **${t.tankName || t.tankId}**: ${parseFloat(t.deltaPercent).toFixed(2)}% [${t.postingStatus}]`).join('\n') +
      (pendingTanks.length > 0 ? `\n\n${pendingTanks.length} tank(s) still pending approval. Go to **✅ Approval Queue**.` : '\n\nAll URGENT tanks have been actioned.');
  }

  if (q.includes('flag')) {
    const flaggedTanks = tanks.filter(t => t.classification === 'FLAG');
    if (flaggedTanks.length === 0) return `No FLAG variances in the latest run (${latestRun.runDate}). All tanks are either OK or URGENT.`;
    return `**FLAG variances in run ${latestRun.runDate}:**\n\n` +
      flaggedTanks.map(t => `- **${t.tankName || t.tankId}**: ${parseFloat(t.deltaPercent).toFixed(2)}% — auto-posted`).join('\n') +
      `\n\nFLAG tanks post automatically but are worth monitoring.`;
  }

  if (q.includes('approve') || q.includes('approval') || q.includes('pending')) {
    const pendingTanks = tanks.filter(t => t.classification === 'URGENT' && t.postingStatus === 'PENDING');
    if (pendingTanks.length === 0) return `No tanks currently require approval. All URGENT variances have been actioned.`;
    return `**${pendingTanks.length} tank(s) pending approval:**\n\n` +
      pendingTanks.map(t => `- **${t.tankName || t.tankId}**: ${parseFloat(t.deltaPercent).toFixed(2)}%`).join('\n') +
      `\n\nGo to **✅ Approval Queue** in the sidebar to approve or reject.`;
  }

  if (q.includes('status') || q.includes('latest') || q.includes('last') || q.includes('overview'))
    return `**Latest Reconciliation (${latestRun.runDate}):**\n\n${tankSummary}`;

  if (q.includes('summar') || q.includes('today') || q.includes('result')) {
    const pendingCount  = tanks.filter(t => t.classification === 'URGENT' && t.postingStatus === 'PENDING').length;
    const rejectedCount = tanks.filter(t => t.postingStatus === 'REJECTED').length;
    const postedCount   = tanks.filter(t => t.postingStatus === 'POSTED').length;
    return `**Run Summary — ${latestRun.runDate}:**\n\n` +
      `- Total tanks: **${latestRun.tankCount || 0}**\n` +
      `- OK: **${latestRun.okCount || 0}**\n` +
      `- FLAG: **${latestRun.flagCount || 0}** (auto-posted)\n` +
      `- URGENT: **${tanks.filter(t => t.classification === 'URGENT').length}**\n` +
      (pendingCount  > 0 ? `  - Pending approval: **${pendingCount}**\n` : '') +
      (rejectedCount > 0 ? `  - Rejected: **${rejectedCount}**\n` : '') +
      (postedCount   > 0 ? `  - Posted: **${postedCount}**\n` : '') +
      `\nRun completed at ${latestRun.completedAt ? new Date(latestRun.completedAt).toLocaleTimeString() : 'N/A'}`;
  }

  if (q.includes('audit') || q.includes('history'))
    return `Click **📋 Audit Trail** in the sidebar to see the full M1→M6 milestone history.`;

  if (q.includes('trigger') || q.includes('start new'))
    return `Go to the **Dashboard**, select a date, and click **⚡ Trigger Run** to start a reconciliation.`;

  return `**Latest (${latestRun.runDate}):**\n\n${tankSummary}\n\nTry asking:\n` +
    `- "Recommendation for tank 00000000000000000023"\n` +
    `- "Which tanks need approval?"\n` +
    `- "Give me a summary of today's results"`;
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
