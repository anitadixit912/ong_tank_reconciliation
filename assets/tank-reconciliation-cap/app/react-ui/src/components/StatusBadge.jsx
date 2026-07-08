import React from 'react';

const MAP = {
  OK: 'badge-ok',
  FLAG: 'badge-flag',
  URGENT: 'badge-urgent',
  PENDING: 'badge-pending',
  POSTED: 'badge-posted',
  REJECTED: 'badge-rejected',
  FAILED: 'badge-failed',
  VARIANCE: 'badge-variance',
  AWAITING_APPROVAL: 'badge-awaiting',
  APPROVED: 'badge-posted',
  COMPLETE: 'badge-posted'
};

const LABELS = {
  AWAITING_APPROVAL: 'Awaiting Approval',
  OK: 'OK',
  FLAG: 'Flag',
  URGENT: 'Urgent',
  PENDING: 'Pending',
  POSTED: 'Posted',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
  VARIANCE: 'Variance',
  APPROVED: 'Approved',
  COMPLETE: 'Complete'
};

export default function StatusBadge({ value }) {
  const cls = MAP[value] || 'badge-pending';
  const label = LABELS[value] || value;
  return <span className={`badge ${cls}`}>{label}</span>;
}
