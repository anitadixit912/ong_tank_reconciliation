using { tank.reconciliation as db } from '../db/schema';

// Human users: ReconciliationUser / Approver / Admin  |  OGS machine: OGSIntegration
service ReconciliationService @(path: '/reconciliation')
  @(requires: ['ReconciliationUser', 'ReconciliationApprover', 'ReconciliationAdmin', 'OGSIntegration']) {

  // ─── Reconciliation Runs ──────────────────────────────────────────────────
  @cds.redirection.target
  entity ReconciliationRuns as projection on db.ReconciliationRun {
    *,
    tankResults : redirected to TankResults,
    auditEntries : redirected to AuditLog
  };

  @(requires: ['ReconciliationAdmin', 'OGSIntegration'])
  action triggerRun(runDate : Date, plant : String(10)) returns {
    runId  : UUID;
    status : String;
  };

  // R11: Re-trigger Data Collection for a specific run (FAILED or PENDING)
  @(requires: ['ReconciliationAdmin', 'OGSIntegration'])
  action retriggerDataCollection(runId : UUID) returns {
    success : Boolean;
    message : String;
  };

  // ─── Tank Results ─────────────────────────────────────────────────────────
  @cds.redirection.target
  entity TankResults as projection on db.TankResult {
    *,
    run : redirected to ReconciliationRuns
  };

  @(requires: ['ReconciliationApprover', 'OGSIntegration'])
  action approvePosting(tankResultId : UUID, comment : String) returns {
    success : Boolean;
    message : String;
  };

  @(requires: ['ReconciliationApprover', 'OGSIntegration'])
  action rejectPosting(tankResultId : UUID, comment : String) returns {
    success : Boolean;
    message : String;
  };

  // ─── Approval Records (read-only) ─────────────────────────────────────────
  @readonly entity ApprovalRecords as projection on db.ApprovalRecord;

  // ─── Audit Log (read-only) ────────────────────────────────────────────────
  @readonly entity AuditLog as projection on db.AuditLogEntry;

  // ─── Tank Configuration (admin only) ────────────────────────────────────
  @(requires: ['ReconciliationAdmin', 'OGSIntegration'])
  entity TankConfigurations as projection on db.TankConfiguration;

  // R12: Tank Variance Trend - 30-day delta history per tank
  @readonly entity TankVarianceTrend as projection on db.TankVarianceTrend;

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

  // ─── Plant Value Help (live from S/4HANA) ────────────────────────────────
  action getPlants() returns array of {
    Plant     : String(4);
    PlantName : String(40);
  };
}

