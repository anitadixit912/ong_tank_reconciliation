import React from 'react';

export default function KpiTile({ label, value, className = '', onClick }) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      className={'kpi-tile' + (clickable ? ' kpi-tile--clickable' : '')}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${className}`}>{value ?? '–'}</span>
      {clickable && <span className="kpi-arrow">›</span>}
    </div>
  );
}
