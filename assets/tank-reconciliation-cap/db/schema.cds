namespace tank.reconciliation;

using { cuid, managed, sap.common.CodeList } from '@sap/cds/common';

// ─── Status Code Lists ─────────────────────────────────────────────────────

entity RunStatus : CodeList {
  key code : String(20);
}

entity Classification : CodeList {
  key code : String(10);
}

entity PostingStatus : CodeList {
  key code : String(20);
}

entity VcfSource : CodeList {
  key code : String(20);
}

entity ApprovalDecision : CodeList {
  key code : String(20);
}

entity AuditStep : CodeList {
  key code : String(20);
}

entity MilestoneOutcome : CodeList {
  key code : String(10);
}

// ─── Core Entities ─────────────────────────────────────────────────────────

entity ReconciliationRun : cuid, managed {
  runDate       : Date          @mandatory;
  status        : String(20)    @mandatory  default 'PENDING';
  triggeredBy   : String(100)   @mandatory  default 'scheduler';
  triggeredAt   : Timestamp     @mandatory;
  completedAt   : Timestamp;
  tankCount     : Integer       default 0;
  okCount       : Integer       default 0;
  flagCount     : Integer       default 0;
  urgentCount   : Integer       default 0;
  vcfFallbackUsed : Boolean     default false;
  auditNotes    : String(500);
  tankResults   : Composition of many TankResult on tankResults.run = $self;
  auditEntries  : Composition of many AuditLogEntry on auditEntries.run = $self;
}

entity TankResult : cuid {
  run                : Association to ReconciliationRun  @mandatory;
  tankId             : String(20)    @mandatory;
  tankName           : String(100);
  materialId         : String(40);
  plant              : String(10);
  storageLocation    : String(10);
  uom                : String(3);
  grossVolumeObserved: Decimal(15,3);
  temperature        : Decimal(7,3);
  strappingFactor    : Decimal(10,6);
  vcfFactor          : Decimal(10,6);
  netVolumePhysical  : Decimal(15,3);
  bookStock          : Decimal(15,3);
  delta              : Decimal(15,3);
  deltaPercent       : Decimal(7,4);
  classification     : String(10)  default 'OK';
  toleranceOkPct     : Decimal(5,2);
  toleranceFlagPct   : Decimal(5,2);
  postingStatus      : String(20)  default 'PENDING';
  materialDocumentId : String(20);
  rejectionReason    : String(500);
  vcfSource          : String(20)  default 'API';
  approvalRecord     : Composition of many ApprovalRecord on approvalRecord.tankResult = $self;
}

entity ApprovalRecord : cuid {
  tankResult : Association to TankResult         @mandatory;
  run        : Association to ReconciliationRun  @mandatory;
  decision   : String(20)   @mandatory;
  decidedBy  : String(100)  @mandatory;
  decidedAt  : Timestamp    @mandatory;
  comment    : String(1000);
}

entity AuditLogEntry : cuid {
  run          : Association to ReconciliationRun  @mandatory;
  tankId       : String(20);
  step         : String(20)   @mandatory;
  milestone    : String(5)    @mandatory;
  outcome      : String(10)   @mandatory;
  message      : String(2000) @mandatory;
  timestamp    : Timestamp    @mandatory;
  actor        : String(100)  @mandatory  default 'system';
  inputSummary : String(1000);
  outputSummary: String(1000);
}

// R13: Multi-terminal support — terminalId/terminalName scope each tank to a site
entity TankConfiguration {
  key tankId         : String(20);
  tankName           : String(100)  @mandatory;
  materialId         : String(40);
  plant              : String(10);
  storageLocation    : String(10);
  toleranceOkPct     : Decimal(5,2) default 0.10;
  toleranceFlagPct   : Decimal(5,2) default 0.25;
  atgEndpoint        : String(500);
  active             : Boolean      default true;
  terminalId         : String(50)   default 'DEFAULT';
  terminalName       : String(100);
}

// R12: Variance trend view — delta history per tank across completed runs
view TankVarianceTrend as
  select from TankResult {
    key ID,
    tankId,
    tankName,
    delta,
    deltaPercent,
    classification,
    vcfSource,
    run.runDate    as runDate,
    run.status     as runStatus
  }
  where run.status = 'COMPLETED'
  order by tankId, runDate desc;
