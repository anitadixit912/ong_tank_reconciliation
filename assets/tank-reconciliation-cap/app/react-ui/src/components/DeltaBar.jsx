import React from 'react';

/**
 * Visual delta % bar.  pct = 0-100, thresholds from TankConfiguration or defaults
 */
export default function DeltaBar({ pct = 0, flagThreshold = 0.5, urgentThreshold = 1.0 }) {
  const abs = Math.abs(pct);
  const cls = abs >= urgentThreshold ? 'delta-urgent'
            : abs >= flagThreshold   ? 'delta-flag'
            :                          'delta-ok';
  const fillColor = abs >= urgentThreshold ? '#dc3545'
                  : abs >= flagThreshold   ? '#e09d12'
                  :                          '#28a745';
  const fillWidth = Math.min(100, (abs / Math.max(urgentThreshold * 2, 0.01)) * 100);

  return (
    <div className="bar-container">
      <span className={cls} style={{ minWidth: '4rem', textAlign: 'right' }}>
        {pct >= 0 ? '+' : ''}{pct?.toFixed(2)}%
      </span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${fillWidth}%`, background: fillColor }} />
      </div>
    </div>
  );
}
