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

  // ─── Reason Codes (live from T157D/T157E via OGS) ────────────────────────
  action getReasonCodes() returns array of {
    Grund : String(4);
    Bwart : String(3);
    Grtxt : String(40);
  };

  // ─── Open Nominations (live from TSW via OGS) ─────────────────────────────
  action getOpenNominations() returns array of {
    Nominationnumber : String(20);
    Itemnumber       : String(10);
    Itemstatus       : String(1);
    Itemtype         : String(2);
    Scheduleddate    : String(10);
    Locationid       : String(10);
    Demandmaterial   : String(40);
    Nominatedqty     : Decimal(13,3);
    Quantityunit     : String(3);
    Nomstatus        : String(1);
    Transportsystem  : String(10);
  };

  // ─── Value helps for nomination creation ─────────────────────────────────
  action getNominationValueHelps() returns {
    locations        : array of { Locationid: String(10); Description: String(40) };
    materials        : array of { Demandmaterial: String(40) };
    transportSystems : array of { Transportsystem: String(10) };
    quantityUnits    : array of { Unit: String(3); Description: String(20) };
    nominationTypes  : array of { Nominationtype: String(4); Description: String(36) };
    itemTypes        : array of { Itemtype: String(2); Description: String(60) };
    modesOfTransport : array of { ModeOfTransport: String(2); Description: String(20) };
  };

  // ─── Get Carrier and Shipper for a Transport System ──────────────────────
  action getCarrierShipperByTS(Transportsystem: String(10)) returns {
    Carrier         : String(10);
    CarrierName     : String(35);
    Shipper         : String(10);
    ShipperName     : String(35);
  };

  // ─── Create Nomination in S/4HANA OGS TSW ────────────────────────────────
  action createNomination(
    Nominationtype  : String(4),
    Transportsystem : String(10),
    Modeoftransport : String(2),
    Vehicleid       : String(10),
    Carrier         : String(10),
    Shipper         : String(10),
    Items           : String(5000)
  ) returns {
    success          : Boolean;
    Nominationnumber : String(20);
    message          : String;
  };

  // ─── Probe standard SAP TSW OData services ───────────────────────────────
  action probeStandardTSWServices() returns String;
  action getNominationVesselDetails(nominationNumber : String(20), itemNumber : String(10)) returns {
    Nominationnumber : String(20);
    Itemnumber       : String(10);
    Vesselname       : String(40);
    Imonumber        : String(10);
    Callsign         : String(10);
    Originport       : String(10);
    Destinationport  : String(10);
    rawJson          : String;
  };
}

