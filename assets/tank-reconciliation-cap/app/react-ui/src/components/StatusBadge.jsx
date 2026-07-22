import React from 'react';

const MAP = {
  // New threshold-based classification
  GREEN:  'badge-ok',
  AMBER:  'badge-flag',
  RED:    'badge-urgent',
  // Legacy (keep for backward compatibility)
  OK:     'badge-ok',
  FLAG:   'badge-flag',
  URGENT: 'badge-urgent',
  // Posting status
  PENDING:           'badge-pending',
  POSTED:            'badge-posted',
  REJECTED:          'badge-rejected',
  FAILED:            'badge-failed',
  VARIANCE:          'badge-variance',
  AWAITING_APPROVAL: 'badge-awaiting',
  APPROVED:          'badge-posted',
  COMPLETE:          'badge-posted'
};

const LABELS = {
  GREEN:  '🟢 Green',
  AMBER:  '🟡 Amber',
  RED:    '🔴 Red',
  OK:     'OK',
  FLAG:   'Flag',
  URGENT: 'Urgent',
  AWAITING_APPROVAL: 'Awaiting Approval',
  PENDING:  'Pending',
  POSTED:   'Posted',
  REJECTED: 'Rejected',
  FAILED:   'Failed',
  VARIANCE: 'Variance',
  APPROVED: 'Approved',
  COMPLETE: 'Complete'
};

export default function StatusBadge({ value }) {
  const cls = MAP[value] || 'badge-pending';
  const label = LABELS[value] || value;
  return <span className={`badge ${cls}`}>{label}</span>;
}
