/**
 * R12: Tank Variance Trend — 30-day delta history per tank.
 *
 * Renders a simple SVG sparkline chart per tank showing deltaPercent
 * over the last 30 completed reconciliation runs.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { fetchVarianceTrend, fetchTankConfigurations } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const DAYS = 30;
const CHART_W = 320;
const CHART_H = 80;
const PADDING = 8;

function Sparkline({ points, maxAbs }) {
  if (!points || points.length < 2) {
    return <span style={{ fontSize: '0.75rem', color: '#adb5bd' }}>Not enough data</span>;
  }

  const range = maxAbs || 1;
  const midY  = CHART_H / 2;
  const step  = (CHART_W - PADDING * 2) / (points.length - 1);

  const coords = points.map((p, i) => {
    const x = PADDING + i * step;
    const y = midY - (p.deltaPercent / range) * (midY - PADDING);
    return { x, y, p };
  });

  const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  return (
    <svg width={CHART_W} height={CHART_H} style={{ display: 'block', overflow: 'visible' }}>
      {/* Zero line */}
      <line x1={PADDING} y1={midY} x2={CHART_W - PADDING} y2={midY}
            stroke="#dee2e6" strokeWidth="1" strokeDasharray="4 2" />
      {/* Tolerance band ±0.25% shaded */}
      <rect x={PADDING} y={midY - (0.25 / range) * (midY - PADDING)}
            width={CHART_W - PADDING * 2}
            height={(0.25 / range) * (midY - PADDING) * 2}
            fill="#d4edda" fillOpacity="0.4" />
      {/* Sparkline */}
      <path d={pathD} fill="none" stroke="#0070f3" strokeWidth="2" strokeLinejoin="round" />
      {/* Data points */}
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={3}
          fill={c.p.classification === 'URGENT' ? '#dc3545' : c.p.classification === 'FLAG' ? '#fd7e14' : '#28a745'} />
      ))}
    </svg>
  );
}

export default function TrendChart() {
  const [tankConfigs, setTankConfigs]   = useState([]);
  const [trendData, setTrendData]       = useState({});   // tankId → sorted points[]
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [selectedTank, setSelectedTank] = useState('');   // '' = all tanks

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configs, rows] = await Promise.all([
        fetchTankConfigurations(),
        fetchVarianceTrend(selectedTank || null, DAYS)
      ]);
      setTankConfigs(configs);

      // Group rows by tankId, sort ascending by runDate
      const grouped = {};
      for (const row of rows) {
        if (!grouped[row.tankId]) grouped[row.tankId] = [];
        grouped[row.tankId].push(row);
      }
      for (const tid of Object.keys(grouped)) {
        grouped[tid].sort((a, b) => a.runDate < b.runDate ? -1 : 1);
      }
      setTrendData(grouped);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedTank]);

  useEffect(() => { load(); }, [load]);

  const tankIds = Object.keys(trendData).sort();

  return (
    <div>
      <h1 className="page-title">30-Day Variance Trend</h1>
      <p style={{ color: '#6c757d', fontSize: '0.875rem', marginBottom: '1rem' }}>
        Delta % history per tank over the last {DAYS} days. Green band = OK tolerance (±0.25%).
        Coloured dots: <span style={{ color: '#28a745' }}>● OK</span> /
        <span style={{ color: '#fd7e14' }}> ● FLAG</span> /
        <span style={{ color: '#dc3545' }}> ● URGENT</span>
      </p>

      {/* Filter */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-body">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Filter by Tank</label>
              <select className="input" value={selectedTank}
                      onChange={e => setSelectedTank(e.target.value)}>
                <option value="">All Tanks</option>
                {tankConfigs.map(c => (
                  <option key={c.tankId} value={c.tankId}>{c.tankId} — {c.tankName}</option>
                ))}
              </select>
            </div>
            <button className="btn btn-outline" onClick={load}>↻ Refresh</button>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading">Loading trend data…</div>
      ) : tankIds.length === 0 ? (
        <div className="empty-state">
          No completed runs found in the last {DAYS} days. Complete some reconciliation runs first.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '1rem' }}>
          {tankIds.map(tid => {
            const points = trendData[tid];
            const maxAbs = Math.max(...points.map(p => Math.abs(p.deltaPercent || 0)), 1);
            const latest = points[points.length - 1];
            const avgDelta = points.reduce((s, p) => s + (p.deltaPercent || 0), 0) / points.length;

            return (
              <div key={tid} className="card">
                <div className="card-header">
                  {tid}
                  <StatusBadge value={latest?.classification} />
                </div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <Sparkline points={points} maxAbs={maxAbs} />
                  <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: '#495057' }}>
                    <div>
                      <div className="form-label">Latest Δ%</div>
                      <strong style={{ color: Math.abs(latest?.deltaPercent) > 0.25 ? '#dc3545' : '#28a745' }}>
                        {latest?.deltaPercent != null ? `${latest.deltaPercent >= 0 ? '+' : ''}${latest.deltaPercent.toFixed(2)}%` : '–'}
                      </strong>
                    </div>
                    <div>
                      <div className="form-label">30-Day Avg Δ%</div>
                      <strong>{avgDelta >= 0 ? '+' : ''}{avgDelta.toFixed(2)}%</strong>
                    </div>
                    <div>
                      <div className="form-label">Runs</div>
                      <strong>{points.length}</strong>
                    </div>
                    <div>
                      <div className="form-label">VCF Source</div>
                      <span style={{ color: latest?.vcfSource === 'ASTM_FALLBACK' ? '#fd7e14' : '#28a745' }}>
                        {latest?.vcfSource === 'ASTM_FALLBACK' ? '⚠ Fallback' : 'API'}
                      </span>
                    </div>
                  </div>
                  {/* Mini table of last 5 runs */}
                  <table className="data-table" style={{ fontSize: '0.75rem' }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Δ%</th>
                        <th>Classification</th>
                      </tr>
                    </thead>
                    <tbody>
                      {points.slice(-5).reverse().map((p, i) => (
                        <tr key={i}>
                          <td>{p.runDate}</td>
                          <td>
                            <span style={{ color: p.classification === 'URGENT' ? '#dc3545' : p.classification === 'FLAG' ? '#fd7e14' : '#28a745' }}>
                              {p.deltaPercent >= 0 ? '+' : ''}{p.deltaPercent?.toFixed(2)}%
                            </span>
                          </td>
                          <td><StatusBadge value={p.classification} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
