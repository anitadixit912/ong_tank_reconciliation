using { tank.reconciliation as db } from '../db/schema';

service ReconciliationService @(path: '/reconciliation')
  @(requires: 'authenticated-user') {

  // ─── Reconciliation Runs ──────────────────────────────────────────────────
  @cds.redirection.target
  entity ReconciliationRuns as projection on db.ReconciliationRun {
    *,
    tankResults : redirected to TankResults,
    auditEntries : redirected to AuditLog
  };

  action triggerRun(runDate : Date) returns {
    runId  : UUID;
    status : String;
  };

  // ─── Tank Results ─────────────────────────────────────────────────────────
  entity TankResults as projection on db.TankResult {
    *,
    run : redirected to ReconciliationRuns
  };

  @(requires: 'ReconciliationApprover')
  action approvePosting(tankResultId : UUID, comment : String) returns {
    success : Boolean;
    message : String;
  };

  @(requires: 'ReconciliationApprover')
  action rejectPosting(tankResultId : UUID, comment : String) returns {
    success : Boolean;
    message : String;
  };

  // ─── Approval Records (read-only) ─────────────────────────────────────────
  @readonly entity ApprovalRecords as projection on db.ApprovalRecord;

  // ─── Audit Log (read-only) ────────────────────────────────────────────────
  @readonly entity AuditLog as projection on db.AuditLogEntry;

  // ─── Tank Configuration (admin only) ────────────────────────────────────
  @(requires: 'ReconciliationAdmin')
  entity TankConfigurations as projection on db.TankConfiguration;

  // ─── Tank Variance Trend (R12: 30-day history per tank) ──────────────────
  @readonly entity TankVarianceTrend as projection on db.TankVarianceTrend;

  // ─── R11: Re-trigger Data Collection for a specific run ──────────────────
  action retriggerDataCollection(runId : UUID) returns {
    success : Boolean;
    message : String;
  };

  // ─── Dashboard Stats (virtual projection) ────────────────────────────────
  @readonly entity DashboardStats as select from db.ReconciliationRun {
    ID,
    runDate,
    status,
    tankCount,
    okCount,
    flagCount,
    urgentCount,
    vcfFallbackUsed,
    triggeredAt,
    completedAt
  } order by runDate desc;

  // ─── AI Chat ─────────────────────────────────────────────────────────────
  action chat(message : String(2000), sessionId : String(100)) returns {
    reply   : String(5000);
    sources : String(2000);
  };
}
