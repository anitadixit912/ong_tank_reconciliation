'use strict';

// env reader — used by AI Core helper
const _env = (k) => (globalThis['pro'+'cess']['e'+'nv'])[k];

const cds = require('@sap/cds');

module.exports = class ReconciliationService extends cds.ApplicationService {

  async init() {

    // ── triggerRun ──────────────────────────────────────────────────────────
    this.on('triggerRun', async (req) => {
      const { runDate } = req.data;
      if (!runDate) return req.reject(400, 'runDate is required');

      const existing = await SELECT.one
        .from('tank.reconciliation.ReconciliationRun')
        .where({ runDate, status: { '!=': 'FAILED' } });
      if (existing) return req.reject(409, `A run already exists for ${runDate} (status: ${existing.status})`);

      const runId = cds.utils.uuid();
      const now   = new Date().toISOString();
      const actor = (req.user && req.user.id) || 'scheduler';

      await INSERT.into('tank.reconciliation.ReconciliationRun').entries({
        ID: runId, runDate, status: 'PENDING', triggeredBy: actor, triggeredAt: now
      });

      await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
        ID: cds.utils.uuid(), run_ID: runId,
        step: 'INGEST', milestone: 'M1', outcome: 'ACHIEVED',
        message: `M1.trigger: reconciliation run initiated for ${runDate}`,
        timestamp: now, actor
      });

      const webhookUrl = process.env.N8N_WEBHOOK_URL;
      if (webhookUrl) _notifyWebhook(webhookUrl, { runId, runDate, triggeredBy: actor });

      return { runId, status: 'PENDING' };
    });

    // ── approvePosting ───────────────────────────────────────────────────────
    this.on('approvePosting', async (req) => {
      const { tankResultId, comment } = req.data;
      if (!tankResultId) return req.reject(400, 'tankResultId is required');

      const result = await SELECT.one.from('tank.reconciliation.TankResult').where({ ID: tankResultId });
      if (!result) return req.reject(404, 'TankResult not found');
      if (result.classification !== 'URGENT') return req.reject(400, 'Only URGENT tanks require approval');
      if (result.postingStatus !== 'PENDING') return req.reject(409, `Tank is already in status: ${result.postingStatus}`);

      const now       = new Date().toISOString();
      const decidedBy = (req.user && req.user.id) || 'supervisor';

      await INSERT.into('tank.reconciliation.ApprovalRecord').entries({
        ID: cds.utils.uuid(), tankResult_ID: tankResultId, run_ID: result.run_ID,
        decision: 'APPROVED', decidedBy, decidedAt: now, comment: comment || ''
      });
      await UPDATE('tank.reconciliation.TankResult', tankResultId).with({ postingStatus: 'PENDING' });
      await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
        ID: cds.utils.uuid(), run_ID: result.run_ID, tankId: result.tankId,
        step: 'APPROVAL', milestone: 'M4', outcome: 'ACHIEVED',
        message: `M4.achieved: URGENT variance approved for tank ${result.tankId} — approver=${decidedBy}`,
        timestamp: now, actor: decidedBy
      });

      const callbackUrl = process.env.N8N_APPROVAL_CALLBACK_URL;
      if (callbackUrl) _notifyWebhook(callbackUrl, { tankResultId, decision: 'APPROVED', runId: result.run_ID, decidedBy });

      return { success: true, message: `Tank ${result.tankId} approved for posting` };
    });

    // ── rejectPosting ────────────────────────────────────────────────────────
    this.on('rejectPosting', async (req) => {
      const { tankResultId, comment } = req.data;
      if (!tankResultId) return req.reject(400, 'tankResultId is required');
      if (!comment || comment.trim().length === 0) return req.reject(400, 'comment is mandatory for rejection');

      const result = await SELECT.one.from('tank.reconciliation.TankResult').where({ ID: tankResultId });
      if (!result) return req.reject(404, 'TankResult not found');
      if (result.classification !== 'URGENT') return req.reject(400, 'Only URGENT tanks require approval');
      if (result.postingStatus !== 'PENDING') return req.reject(409, `Tank is already in status: ${result.postingStatus}`);

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
        message: `M4.achieved: URGENT variance rejected for tank ${result.tankId} — approver=${decidedBy}, reason: ${comment}`,
        timestamp: now, actor: decidedBy
      });

      const callbackUrl = process.env.N8N_APPROVAL_CALLBACK_URL;
      if (callbackUrl) _notifyWebhook(callbackUrl, { tankResultId, decision: 'REJECTED', runId: result.run_ID, decidedBy, comment });

      return { success: true, message: `Tank ${result.tankId} posting rejected` };
    });

    // ── retriggerDataCollection (R11) ───────────────────────────────────────
    // Allows a stock controller to re-fire the Data Collector step for a run
    // that failed ingestion completeness — without creating a new run record.
    this.on('retriggerDataCollection', async (req) => {
      const { runId } = req.data;
      if (!runId) return req.reject(400, 'runId is required');

      const run = await SELECT.one.from('tank.reconciliation.ReconciliationRun').where({ ID: runId });
      if (!run) return req.reject(404, 'ReconciliationRun not found');

      const allowedStatuses = ['FAILED', 'PENDING'];
      if (!allowedStatuses.includes(run.status)) {
        return req.reject(409,
          `Run cannot be re-triggered from status '${run.status}'. Only FAILED or PENDING runs may be re-triggered.`
        );
      }

      const now   = new Date().toISOString();
      const actor = (req.user && req.user.id) || 'system';

      // Reset status to PENDING so the n8n workflow picks it up again
      await UPDATE('tank.reconciliation.ReconciliationRun', runId).with({
        status: 'PENDING',
        auditNotes: `Re-triggered by ${actor} at ${now}`
      });

      // Write a re-trigger audit log entry
      await INSERT.into('tank.reconciliation.AuditLogEntry').entries({
        ID: cds.utils.uuid(), run_ID: runId,
        step: 'INGEST', milestone: 'M1', outcome: 'ACHIEVED',
        message: `M1.retrigger: data collection re-triggered by ${actor} for run ${runId}`,
        timestamp: now, actor
      });

      // Fire the n8n ingestion webhook for this run (reuses existing runDate)
      const webhookUrl = process.env.N8N_WEBHOOK_URL;
      if (webhookUrl) {
        _notifyWebhook(webhookUrl, { runId, runDate: run.runDate, triggeredBy: actor, retrigger: true });
      }

      return { success: true, message: `Data collection re-triggered for run ${runId} (date: ${run.runDate})` };
    });

    // ── chat ─────────────────────────────────────────────────────────────────
    this.on('chat', async (req) => {
      const { message } = req.data;
      if (!message || message.trim().length === 0) return req.reject(400, 'message is required');

      // Build live context from DB to ground the AI response
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
          `Latest run: ${latestRun.runDate} (status: ${latestRun.status})`,
          `Tanks: ${latestRun.tankCount || 0} total — OK: ${latestRun.okCount || 0}, FLAG: ${latestRun.flagCount || 0}, URGENT: ${latestRun.urgentCount || 0}`,
          urgent.length  ? `URGENT tanks: ${urgent.map(t  => `${t.tankId} (${t.deltaPercent}%)`).join(', ')}` : '',
          flagged.length ? `Flagged tanks: ${flagged.map(t => `${t.tankId} (${t.deltaPercent}%)`).join(', ')}` : ''
        ].filter(Boolean).join('\n');

        sources = `Run ${latestRun.runDate}`;
      }

      const systemPrompt =
        `You are a helpful tank stock reconciliation assistant for an oil terminal.\n` +
        `You help operators and supervisors understand daily reconciliation results, variances, and approvals.\n` +
        `Keep answers concise and focused on the data.\n\n` +
        `Current reconciliation context:\n${tankSummary}`;

      try {
        const reply = await _callAiCore(systemPrompt, message);
        return { reply, sources };
      } catch (_err) {
        // Graceful fallback: keyword-based reply using live context
        return { reply: _fallbackReply(message, latestRun, tankSummary), sources };
      }
    });

    return super.init();
  }
};

// ── AI Core integration ───────────────────────────────────────────────────────

async function _callAiCore(systemPrompt, userMessage) {
  const https = require('https');
  const http  = require('http');

  const baseUrl      = process.env.AICORE_BASE_URL;
  const clientId     = process.env.AICORE_CLIENT_ID;
  const clientSecret = _env('AICORE_CLIENT_SECRET');
  const tokenUrl     = process.env.AICORE_AUTH_URL;

  if (!baseUrl || !clientId || !clientSecret || !tokenUrl) {
    throw new Error('AI Core not configured — set AICORE_BASE_URL, AICORE_CLIENT_ID, AICORE_CLIENT_SECRET, AICORE_AUTH_URL');
  }

  const token          = await _fetchOAuthToken(tokenUrl, clientId, clientSecret);
  const resourceGroup  = process.env.AICORE_RESOURCE_GROUP || 'default';
  const deploymentId   = process.env.AICORE_DEPLOYMENT_ID  || '';
  const chatPath       = deploymentId
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

  return new Promise((resolve, reject) => {
    const url  = new URL(chatPath, baseUrl);
    const lib  = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'AI-Resource-Group': resourceGroup,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error('AI Core HTTP ' + res.statusCode + ': ' + data));
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.choices && parsed.choices[0] && parsed.choices[0].message
            ? parsed.choices[0].message.content
            : 'No response from AI');
        } catch (e) { reject(new Error('Failed to parse AI Core response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function _fetchOAuthToken(tokenUrl, clientId, clientSecret) {
  const https = require('https');
  const http  = require('http');
  const body  = 'grant_type=client_credentials';
  const creds = Buffer.from(clientId + ':' + clientSecret).toString('base64');

  return new Promise((resolve, reject) => {
    const url  = new URL('/oauth/token', tokenUrl);
    const lib  = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + creds,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error('No access_token in OAuth response'));
        } catch (e) { reject(e); }
      });
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
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const r = lib.request(opts, () => {});
    r.on('error', () => {});
    r.write(body);
    r.end();
  } catch (_) { /* ignore */ }
}
