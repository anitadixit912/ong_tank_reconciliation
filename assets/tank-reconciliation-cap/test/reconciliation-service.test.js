'use strict';

const cds = require('@sap/cds');
// Boot in-process server — must be called ONCE at top level before describe/it
cds.test(__dirname + '/..');

// ── Seed helpers ─────────────────────────────────────────────────────────────

async function db() { return cds.connect.to('db'); }

async function seedRun(runDate, overrides = {}) {
  const ID = cds.utils.uuid();
  const d = await db();
  await d.run(INSERT.into('tank.reconciliation.ReconciliationRun').entries(
    Object.assign({ ID, runDate, status: 'PENDING', triggeredBy: 'test', triggeredAt: new Date().toISOString() }, overrides)
  ));
  return ID;
}

async function seedUrgentTank(runId) {
  const ID = cds.utils.uuid();
  const d = await db();
  await d.run(INSERT.into('tank.reconciliation.TankResult').entries({
    ID, run_ID: runId, tankId: `TK-${ID.slice(0,5)}`, tankName: 'Test Tank',
    classification: 'URGENT', postingStatus: 'PENDING',
    netVolumePhysical: 1000.0, bookStock: 750.0, delta: 250.0, deltaPercent: 33.33
  }));
  return ID;
}

// ── triggerRun ────────────────────────────────────────────────────────────────

it('triggerRun: creates run and M1 audit log', async () => {
  const srv = cds.services['ReconciliationService'];
  const d = await db();

  const result = await srv.send('triggerRun', { runDate: '2099-03-01' });
  expect(result).toHaveProperty('runId');
  expect(result.status).toBe('PENDING');

  const run = await d.run(SELECT.one.from('tank.reconciliation.ReconciliationRun').where({ ID: result.runId }));
  expect(run).toBeTruthy();
  expect(run.status).toBe('PENDING');

  const log = await d.run(SELECT.one.from('tank.reconciliation.AuditLogEntry')
    .where({ run_ID: result.runId, milestone: 'M1' }));
  expect(log).toBeTruthy();
  expect(log.outcome).toBe('ACHIEVED');
});

it('triggerRun: rejects missing runDate', async () => {
  const srv = cds.services['ReconciliationService'];
  await expect(srv.send('triggerRun', {})).rejects.toThrow(/runDate/i);
});

it('triggerRun: rejects duplicate run for same date', async () => {
  const srv = cds.services['ReconciliationService'];
  await srv.send('triggerRun', { runDate: '2099-04-01' });
  await expect(srv.send('triggerRun', { runDate: '2099-04-01' })).rejects.toThrow(/already exists/i);
});

// ── approvePosting ─────────────────────────────────────────────────────────────

it('approvePosting: creates approval record and M4 audit log', async () => {
  const srv = cds.services['ReconciliationService'];
  const d = await db();
  const runId = await seedRun('2099-06-01', { status: 'AWAITING_APPROVAL' });
  const tankResultId = await seedUrgentTank(runId);

  const result = await srv.send('approvePosting', { tankResultId, comment: 'Variance verified' });
  expect(result.success).toBe(true);

  const approval = await d.run(SELECT.one.from('tank.reconciliation.ApprovalRecord')
    .where({ tankResult_ID: tankResultId }));
  expect(approval).toBeTruthy();
  expect(approval.decision).toBe('APPROVED');

  const log = await d.run(SELECT.one.from('tank.reconciliation.AuditLogEntry')
    .where({ run_ID: runId, milestone: 'M4' }));
  expect(log.outcome).toBe('ACHIEVED');
});

it('approvePosting: rejects missing tankResultId', async () => {
  const srv = cds.services['ReconciliationService'];
  await expect(srv.send('approvePosting', {})).rejects.toThrow(/tankResultId/i);
});

it('approvePosting: rejects non-existent tank', async () => {
  const srv = cds.services['ReconciliationService'];
  await expect(srv.send('approvePosting', { tankResultId: cds.utils.uuid() }))
    .rejects.toThrow(/not found/i);
});

it('approvePosting: rejects non-URGENT classification', async () => {
  const srv = cds.services['ReconciliationService'];
  const d = await db();
  const runId = await seedRun('2099-07-01');
  const tankResultId = cds.utils.uuid();
  await d.run(INSERT.into('tank.reconciliation.TankResult').entries({
    ID: tankResultId, run_ID: runId, tankId: 'TK-OK', classification: 'OK', postingStatus: 'PENDING'
  }));
  await expect(srv.send('approvePosting', { tankResultId })).rejects.toThrow(/URGENT/i);
});

// ── rejectPosting ─────────────────────────────────────────────────────────────

it('rejectPosting: sets REJECTED status and stores reason', async () => {
  const srv = cds.services['ReconciliationService'];
  const d = await db();
  const runId = await seedRun('2099-08-01', { status: 'AWAITING_APPROVAL' });
  const tankResultId = await seedUrgentTank(runId);

  const result = await srv.send('rejectPosting', { tankResultId, comment: 'Meter calibration fault' });
  expect(result.success).toBe(true);

  const updated = await d.run(SELECT.one.from('tank.reconciliation.TankResult').where({ ID: tankResultId }));
  expect(updated.postingStatus).toBe('REJECTED');
  expect(updated.rejectionReason).toBe('Meter calibration fault');

  const approval = await d.run(SELECT.one.from('tank.reconciliation.ApprovalRecord')
    .where({ tankResult_ID: tankResultId }));
  expect(approval.decision).toBe('REJECTED');
});

it('rejectPosting: rejects empty comment', async () => {
  const srv = cds.services['ReconciliationService'];
  const runId = await seedRun('2099-09-01', { status: 'AWAITING_APPROVAL' });
  const tankResultId = await seedUrgentTank(runId);
  await expect(srv.send('rejectPosting', { tankResultId, comment: '' })).rejects.toThrow(/mandatory/i);
});

it('rejectPosting: rejects missing comment', async () => {
  const srv = cds.services['ReconciliationService'];
  const runId = await seedRun('2099-10-01', { status: 'AWAITING_APPROVAL' });
  const tankResultId = await seedUrgentTank(runId);
  await expect(srv.send('rejectPosting', { tankResultId })).rejects.toThrow(/mandatory/i);
});

// ── retriggerDataCollection (R11) ─────────────────────────────────────────────

it('retriggerDataCollection: resets FAILED run to PENDING and writes audit log', async () => {
  const srv = cds.services['ReconciliationService'];
  const d   = await db();
  const runId = await seedRun('2099-11-01', { status: 'FAILED' });

  const result = await srv.send('retriggerDataCollection', { runId });
  expect(result.success).toBe(true);

  const updated = await d.run(SELECT.one.from('tank.reconciliation.ReconciliationRun').where({ ID: runId }));
  expect(updated.status).toBe('PENDING');

  const log = await d.run(SELECT.one.from('tank.reconciliation.AuditLogEntry')
    .where({ run_ID: runId, step: 'INGEST' })
    .orderBy({ timestamp: 'desc' }));
  expect(log).toBeTruthy();
  expect(log.message).toMatch(/retrigger/i);
});

it('retriggerDataCollection: rejects missing runId', async () => {
  const srv = cds.services['ReconciliationService'];
  await expect(srv.send('retriggerDataCollection', {})).rejects.toThrow(/runId/i);
});

it('retriggerDataCollection: rejects non-existent run', async () => {
  const srv = cds.services['ReconciliationService'];
  await expect(srv.send('retriggerDataCollection', { runId: cds.utils.uuid() }))
    .rejects.toThrow(/not found/i);
});

it('retriggerDataCollection: rejects run in non-FAILED/PENDING status', async () => {
  const srv = cds.services['ReconciliationService'];
  const runId = await seedRun('2099-12-01', { status: 'COMPLETED' });
  await expect(srv.send('retriggerDataCollection', { runId }))
    .rejects.toThrow(/cannot be re-triggered/i);
});
