import React from 'react';

export default function KpiTile({ label, value, className = '' }) {
  return (
    <div className="kpi-tile">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${className}`}>{value ?? '–'}</span>
    </div>
  );
}
