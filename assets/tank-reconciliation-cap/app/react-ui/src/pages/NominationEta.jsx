import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fetchOpenNominations } from '../api.js';
import {
  FlexBox,
  Title,
  Input,
  Button,
  BusyIndicator,
  Select,
  Option,
  Label,
} from '@ui5/webcomponents-react';

const EMPTY_FORM = {
  Nominationtype:  '',
  Transportsystem: '',
  Modeoftransport: '',
  Vehicleid:       '',
  Carrier:         '',
  CarrierName:     '',
  Shipper:         '',
  ShipperName:     '',
};

const SUGGESTIONS = [
  'List all open nominations',
  'What vessels are currently heading to USMOB?',
  'Propose an ETA for nomination 00000000000000000128',
  'Show historical nominations for BLK_GASOLINE 87 at USMOB via BARGE_1743',
];

const INITIAL_MESSAGE = {
  role: 'assistant',
  text: "Hello! I'm the Nomination ETA Proposal Agent. I can propose and update ETAs for TSW nominations using live Marine Traffic data and historical patterns.",
};

const SESSION_KEY = 'nomination_eta_chat_history';

function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))   return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`'))   return <code key={i} style={{ background: 'rgba(0,0,0,0.1)', borderRadius: '3px', padding: '1px 4px', fontSize: '0.82em', fontFamily: 'monospace' }}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function parseTableCells(line) {
  return line.split('|').slice(1, -1).map(c => c.trim());
}

function MarkdownText({ text }) {
  const lines = (text || '').split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Detect table: current line has |, next line is separator (|---|)
    if (line.trim().startsWith('|') && lines[i + 1] && lines[i + 1].match(/^\|[\s|:-]+\|$/)) {
      const headers = parseTableCells(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(parseTableCells(lines[i]));
        i++;
      }
      elements.push(
        <div key={`table-${i}`} style={{ overflowX: 'auto', margin: '0.5rem 0' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.82rem' }}>
            <thead>
              <tr>
                {headers.map((h, j) => (
                  <th key={j} style={{ padding: '0.4rem 0.75rem', background: '#0070f2', color: '#fff', textAlign: 'left', whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ background: ri % 2 === 0 ? '#f8f9fb' : '#fff' }}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: '0.35rem 0.75rem', borderBottom: '1px solid #e8eaed', whiteSpace: 'nowrap' }}>
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (line.startsWith('### ')) { elements.push(<div key={i} style={{ fontWeight: 700, fontSize: '0.95rem', marginTop: '0.75rem', marginBottom: '0.2rem' }}>{renderInline(line.slice(4))}</div>); }
    else if (line.startsWith('## ')) { elements.push(<div key={i} style={{ fontWeight: 700, fontSize: '1rem', marginTop: '0.75rem', marginBottom: '0.2rem', borderBottom: '1px solid rgba(0,0,0,0.1)', paddingBottom: '0.2rem' }}>{renderInline(line.slice(3))}</div>); }
    else if (line.startsWith('# '))  { elements.push(<div key={i} style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: '0.75rem', marginBottom: '0.2rem' }}>{renderInline(line.slice(2))}</div>); }
    else if (line.match(/^---+$/) || line.match(/^\*\*\*+$/)) { elements.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.12)', margin: '0.5rem 0' }} />); }
    else if (line.match(/^\s{2,}- /) || line.match(/^\s{2,}\* /)) { elements.push(<div key={i} style={{ paddingLeft: '2rem', display: 'flex', gap: '0.4rem', marginTop: '0.1rem' }}><span style={{ color: '#888' }}>◦</span><span>{renderInline(line.replace(/^\s+[-*]\s/, ''))}</span></div>); }
    else if (line.startsWith('- ') || line.startsWith('* ')) { elements.push(<div key={i} style={{ paddingLeft: '1rem', display: 'flex', gap: '0.5rem', marginTop: '0.15rem' }}><span>•</span><span>{renderInline(line.slice(2))}</span></div>); }
    else if (line.match(/^\d+\.\s/)) { elements.push(<div key={i} style={{ paddingLeft: '1rem', marginTop: '0.15rem' }}>{renderInline(line)}</div>); }
    else if (line.startsWith('> ')) { elements.push(<div key={i} style={{ borderLeft: '3px solid #0070f2', paddingLeft: '0.75rem', color: '#555', fontStyle: 'italic', margin: '0.25rem 0' }}>{renderInline(line.slice(2))}</div>); }
    else if (line.trim() === '') { elements.push(<div key={i} style={{ height: '0.5rem' }} />); }
    else { elements.push(<div key={i}>{renderInline(line)}</div>); }

    i++;
  }

  return <div style={{ lineHeight: '1.6' }}>{elements}</div>;
}

async function callNominationEtaAgent(userText, contextId) {
  const payload = {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        messageId: crypto.randomUUID(),
        parts: [{ kind: 'text', text: userText }],
        ...(contextId ? { contextId } : {}),
      },
    },
  };

  const res = await fetch('/nomination-eta/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Agent error: ${res.status}`);
  const data = await res.json();

  if (data?.error) throw new Error(data.error.message || 'Agent error');

  const result = data?.result;
  const newContextId = result?.contextId || contextId;

  // Extract reply: artifacts first, then status message, then history
  const artifact = result?.artifacts?.[0];
  if (artifact) {
    const text = artifact.parts?.find(p => p.kind === 'text')?.text || '';
    if (text) return { text, contextId: newContextId };
  }

  // Fall back to last agent message in history
  const history = result?.history || [];
  const lastAgent = [...history].reverse().find(m => m.role === 'agent');
  if (lastAgent) {
    const text = lastAgent.parts?.find(p => p.kind === 'text')?.text || '';
    if (text) return { text, contextId: newContextId };
  }

  return { text: 'No response received.', contextId: newContextId };
}

function NominationsListModal({ nominations, nomsLoading, onRefresh, onClose }) {
  const [expanded, setExpanded] = useState({});

  // Group items by nomination number
  const grouped = nominations.reduce((acc, n) => {
    const key = n.Nominationnumber || '–';
    if (!acc[key]) acc[key] = { header: n, items: [] };
    acc[key].items.push(n);
    return acc;
  }, {});
  const groups = Object.values(grouped);
  const totalNoms = groups.length;

  const toggle = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const statusBadge = (s) =>
    s === '1' ? <span style={{ color: '#1a7a1a', fontWeight: 600 }}>🟢 Open</span>
    : s === '2' ? <span style={{ color: '#b36b00', fontWeight: 600 }}>🟡 Transmitted</span>
    : s ? <span style={{ color: '#c00', fontWeight: 600 }}>🔴 Closed</span>
    : '–';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', width: '960px', maxWidth: '97vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <Title level="H4">📋 TSW Nominations ({totalNoms})</Title>
          <FlexBox direction="Row" style={{ gap: '0.5rem' }}>
            <Button design="Transparent" icon="refresh" onClick={onRefresh} disabled={nomsLoading}>
              {nomsLoading ? 'Loading…' : 'Refresh'}
            </Button>
            <Button design="Transparent" onClick={onClose}>✕</Button>
          </FlexBox>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {nomsLoading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>Loading nominations…</div>
          ) : groups.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>No nominations found.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f0f4ff', borderBottom: '2px solid #c8d4f0', position: 'sticky', top: 0 }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', width: '28px' }}></th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Nomination #</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Transport System</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Type</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Mode</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Items</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, gi) => {
                  const nomKey  = g.header.Nominationnumber || '–';
                  const nomDisp = nomKey.replace(/^[$0]+/, '') || nomKey;
                  const isOpen  = expanded[nomKey];
                  const rowBg   = gi % 2 === 0 ? '#fff' : '#f7f9ff';
                  return [
                    /* ── Nomination header row ── */
                    <tr key={'h-' + gi}
                      onClick={() => toggle(nomKey)}
                      style={{ background: rowBg, borderBottom: isOpen ? 'none' : '1px solid #e8eaf0', cursor: 'pointer' }}>
                      <td style={{ padding: '8px 6px 8px 12px', color: '#555', fontSize: '0.8rem' }}>
                        {isOpen ? '▾' : '▸'}
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: '#1a4e9c' }}>{nomDisp}</td>
                      <td style={{ padding: '8px 10px' }}>{g.header.Transportsystem || '–'}</td>
                      <td style={{ padding: '8px 10px' }}>{g.header.Nominationtype || '–'}</td>
                      <td style={{ padding: '8px 10px' }}>{g.header.Modeoftransport || '–'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#555' }}>{g.items.length}</td>
                      <td style={{ padding: '8px 10px' }}>{statusBadge(g.header.Nomstatus)}</td>
                    </tr>,
                    /* ── Expanded items sub-table ── */
                    isOpen && (
                      <tr key={'items-' + gi} style={{ background: rowBg }}>
                        <td colSpan={7} style={{ padding: '0 0 8px 36px', borderBottom: '1px solid #e8eaf0' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                            <thead>
                              <tr style={{ background: '#eef1fa' }}>
                                <th style={{ padding: '5px 8px', textAlign: 'left', color: '#555', fontWeight: 600 }}>Item</th>
                                <th style={{ padding: '5px 8px', textAlign: 'left', color: '#555', fontWeight: 600 }}>Material</th>
                                <th style={{ padding: '5px 8px', textAlign: 'right', color: '#555', fontWeight: 600 }}>Qty</th>
                                <th style={{ padding: '5px 8px', textAlign: 'left', color: '#555', fontWeight: 600 }}>UoM</th>
                                <th style={{ padding: '5px 8px', textAlign: 'left', color: '#555', fontWeight: 600 }}>Sched. Date</th>
                                <th style={{ padding: '5px 8px', textAlign: 'left', color: '#555', fontWeight: 600 }}>Location</th>
                                <th style={{ padding: '5px 8px', textAlign: 'left', color: '#555', fontWeight: 600 }}>Item Type</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.items.map((it, ii) => (
                                <tr key={ii} style={{ borderTop: '1px solid #dde', background: ii % 2 === 0 ? '#fff' : '#f4f6fd' }}>
                                  <td style={{ padding: '5px 8px', color: '#666' }}>{it.Itemnumber?.replace(/^0+/, '') || '–'}</td>
                                  <td style={{ padding: '5px 8px' }}>{it.Demandmaterial || '–'}</td>
                                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>{parseFloat(it.Nominatedqty || 0).toLocaleString()}</td>
                                  <td style={{ padding: '5px 8px' }}>{it.Quantityunit || '–'}</td>
                                  <td style={{ padding: '5px 8px' }}>{it.Scheduleddate || '–'}</td>
                                  <td style={{ padding: '5px 8px' }}>{it.Locationid || '–'}</td>
                                  <td style={{ padding: '5px 8px' }}>{it.Itemtype === 'O' ? '📤 Origin' : it.Itemtype === 'D' ? '📥 Dest' : it.Itemtype || '–'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )
                  ];
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NominationEta() {
  const [messages, setMessages] = useState(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      return saved ? JSON.parse(saved) : [INITIAL_MESSAGE];
    } catch (_) { return [INITIAL_MESSAGE]; }
  });
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [contextId, setContextId]   = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [items, setItems]           = useState([{ Itemtype: '', Locationid: '', Demandmaterial: '', Nominatedqty: '', Quantityunit: '', Scheduleddate: '' }]);
  const [creating, setCreating]     = useState(false);
  const [createMsg, setCreateMsg]   = useState(null);
  const [valueHelps, setValueHelps] = useState({ locations: [], materials: [], transportSystems: [], quantityUnits: [], nominationTypes: [], itemTypes: [], modesOfTransport: [] });
  const [nominations, setNominations]         = useState([]);
  const [nomsLoading, setNomsLoading]         = useState(false);
  const [showNominationsList, setShowNominationsList] = useState(false);
  const bottomRef                   = useRef(null);

  const refreshNominations = useCallback(() => {
    setNomsLoading(true);
    fetchOpenNominations()
      .then(noms => setNominations(noms))
      .catch(() => setNominations([]))
      .finally(() => setNomsLoading(false));
  }, []);

  useEffect(() => {
    fetch('/reconciliation/getNominationValueHelps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.json())
      .then(d => {
        const vh = d?.value || d;
        if (vh?.locations) setValueHelps(vh);
      })
      .catch(() => {});
    refreshNominations();
  }, [refreshNominations]);

  const onTransportsystemChange = async (ts) => {
    setForm(f => ({ ...f, Transportsystem: ts, Carrier: '', CarrierName: '', Shipper: '', ShipperName: '' }));
    if (!ts) return;
    try {
      const res = await fetch('/reconciliation/getCarrierShipperByTS', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Transportsystem: ts })
      });
      const data = await res.json();
      const val = data?.value || data;
      if (val) setForm(f => ({ ...f, Carrier: val.Carrier || '', CarrierName: val.CarrierName || '', Shipper: val.Shipper || '', ShipperName: val.ShipperName || '' }));
    } catch(_) {}
  };

  const addItem    = () => setItems(prev => [...prev, { Itemtype: '', Locationid: '', Demandmaterial: '', Nominatedqty: '', Quantityunit: '', Scheduleddate: '' }]);
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));
  const setItemField = (idx, field, value) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));

  useEffect(() => {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages)); } catch (_) {}
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage(text) {
    const userText = (text || input).trim();
    if (!userText) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setLoading(true);
    try {
      const { text: reply, contextId: newCtxId } = await callNominationEtaAgent(userText, contextId);
      setContextId(newCtxId);
      setMessages(prev => [...prev, { role: 'assistant', text: reply }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: 'Sorry, there was an error reaching the Nomination ETA Agent. Please try again.',
        isError: true,
      }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearChat() {
    setMessages([INITIAL_MESSAGE]);
    setContextId(null);
    sessionStorage.removeItem(SESSION_KEY);
  }

  function setField(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  async function submitCreateNomination() {
    // Frontend validation
    const errors = [];
    if (!form.Nominationtype)  errors.push('Nomination Type is required');
    if (!form.Transportsystem) errors.push('Transport System is required');
    items.forEach((item, idx) => {
      const n = idx + 1;
      if (!item.Itemtype)      errors.push(`Item ${n}: Item Type is required`);
      if (!item.Locationid)    errors.push(`Item ${n}: Location is required`);
      if (!item.Demandmaterial) errors.push(`Item ${n}: Material is required`);
      if (!item.Scheduleddate) errors.push(`Item ${n}: Scheduled Date is required`);
      if (!item.Nominatedqty)  errors.push(`Item ${n}: Quantity is required`);
      if (!item.Quantityunit)  errors.push(`Item ${n}: Unit is required`);
    });
    if (errors.length > 0) {
      setCreateMsg({ ok: false, text: '❌ Please fix the following:\n• ' + errors.join('\n• ') });
      return;
    }

    setCreating(true);
    setCreateMsg(null);
    try {
      const res = await fetch('/reconciliation/createNomination', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Nominationtype:  form.Nominationtype,
          Transportsystem: form.Transportsystem,
          Modeoftransport: form.Modeoftransport,
          Vehicleid:       form.Vehicleid,
          Carrier:         form.Carrier,
          Shipper:         form.Shipper,
          Items:           JSON.stringify(items),
        }),
      });
      const data = await res.json();
      const result = data?.value || data;
      if (result?.success) {
        const nomNum = result.Nominationnumber || '–';
        const itemLines = items.map((it, idx) =>
          `  - **Item ${idx + 1}:** ${it.Demandmaterial || '–'} | Qty: ${parseFloat(it.Nominatedqty || 0).toLocaleString()} ${it.Quantityunit || ''} | Location: ${it.Locationid || '–'} | Date: ${it.Scheduleddate || '–'} | Type: ${it.Itemtype || '–'}`
        ).join('\n');
        setCreateMsg({ ok: true, text: `✅ Nomination ${nomNum} created successfully!` });
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: [
            `✅ **Nomination Created Successfully**`,
            ``,
            `- **Nomination #:** ${nomNum}`,
            `- **Transport System:** ${form.Transportsystem}`,
            `- **Nomination Type:** ${form.Nominationtype}`,
            `- **Mode of Transport:** ${form.Modeoftransport || '–'}`,
            `- **Vehicle ID:** ${form.Vehicleid || '–'}`,
            `- **Carrier:** ${form.Carrier ? `${form.Carrier}${form.CarrierName ? ' — ' + form.CarrierName : ''}` : '–'}`,
            `- **Shipper:** ${form.Shipper ? `${form.Shipper}${form.ShipperName ? ' — ' + form.ShipperName : ''}` : '–'}`,
            `- **Items (${items.length}):**`,
            itemLines,
            ``,
            `Would you like me to propose an ETA for nomination **${nomNum}**?`,
          ].join('\n'),
        }]);
        setTimeout(() => { setShowCreate(false); setForm(EMPTY_FORM); setItems([{ Itemtype: '', Locationid: '', Demandmaterial: '', Nominatedqty: '', Quantityunit: '', Scheduleddate: '' }]); setCreateMsg(null); refreshNominations(); }, 1500);
      } else {
        setCreateMsg({ ok: false, text: `❌ ${result?.message || 'Failed to create nomination'}` });
      }
    } catch (e) {
      setCreateMsg({ ok: false, text: `❌ Error: ${e.message}` });
    } finally {
      setCreating(false);
    }
  }

  return (
    <FlexBox direction="Column" style={{ height: 'calc(100vh - 120px)', padding: '1rem', gap: '1rem' }}>
      <div style={{ marginBottom: '0.25rem' }}>
        <Link to="/" style={{ color: '#0070f3', textDecoration: 'none', fontSize: '0.875rem' }}>← Dashboard</Link>
      </div>
      <FlexBox direction="Row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level="H3">🚢 TSW Nomination Agent</Title>
        <FlexBox direction="Row" style={{ gap: '0.5rem' }}>
          <Button design="Default" icon="list" onClick={() => { setShowNominationsList(true); refreshNominations(); }}>
            Open Nominations {nominations.length > 0 ? `(${nominations.length})` : ''}
          </Button>
          <Button design="Emphasized" icon="add" onClick={() => { setShowCreate(true); setCreateMsg(null); }}>
            Create Nomination
          </Button>
          <Button design="Transparent" style={{ fontSize: '0.8rem', color: '#888' }} onClick={clearChat}>
            🗑 Clear Chat
          </Button>
        </FlexBox>
      </FlexBox>

      {/* Open Nominations Modal */}
      {showNominationsList && (
        <NominationsListModal
          nominations={nominations}
          nomsLoading={nomsLoading}
          onRefresh={refreshNominations}
          onClose={() => setShowNominationsList(false)}
        />
      )}

      {/* Create Nomination Modal */}
      {showCreate && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}>
          <div style={{
            background: '#fff', borderRadius: '12px', padding: '1.5rem',
            width: '680px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            <FlexBox direction="Row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <Title level="H4">Create Nomination</Title>
              <Button design="Transparent" onClick={() => setShowCreate(false)}>✕</Button>
            </FlexBox>

            {/* ── Header Section ── */}
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#0064d9', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Header</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <Label>Nomination Type *</Label>
                <Select style={{ width: '100%' }} onChange={e => setField('Nominationtype', e.detail.selectedOption.value)}>
                  <Option value="">-- Select --</Option>
                  {(valueHelps.nominationTypes || []).map(t => (
                    <Option key={t.Nominationtype} value={t.Nominationtype} selected={form.Nominationtype === t.Nominationtype}>
                      {t.Nominationtype}{t.Description && t.Description !== t.Nominationtype ? ` — ${t.Description}` : ''}
                    </Option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Transport System *</Label>
                <Select style={{ width: '100%' }} onChange={e => onTransportsystemChange(e.detail.selectedOption.value)}>
                  <Option value="">-- Select --</Option>
                  {valueHelps.transportSystems.map(t => (
                    <Option key={t.Transportsystem} value={t.Transportsystem} selected={form.Transportsystem === t.Transportsystem}>{t.Transportsystem}</Option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Mode of Transport</Label>
                <Select style={{ width: '100%' }} onChange={e => setField('Modeoftransport', e.detail.selectedOption.value)}>
                  <Option value="">-- Select --</Option>
                  {(valueHelps.modesOfTransport || []).map(m => (
                    <Option key={m.ModeOfTransport} value={m.ModeOfTransport} selected={form.Modeoftransport === m.ModeOfTransport}>
                      {m.ModeOfTransport}{m.Description ? ` — ${m.Description}` : ''}
                    </Option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Vehicle Number</Label>
                <Input style={{ width: '100%' }} value={form.Vehicleid || ''}
                  onInput={e => setField('Vehicleid', e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <Label>Carrier</Label>
                <Input style={{ width: '100%' }} value={form.Carrier ? `${form.Carrier}${form.CarrierName ? ' — ' + form.CarrierName : ''}` : ''}
                  readonly placeholder="Auto-populated from Transport System" />
              </div>
              <div>
                <Label>Shipper</Label>
                <Input style={{ width: '100%' }} value={form.Shipper ? `${form.Shipper}${form.ShipperName ? ' — ' + form.ShipperName : ''}` : ''}
                  readonly placeholder="Auto-populated from Transport System" />
              </div>
            </div>

            {/* ── Items Section ── */}
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#0064d9', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Nomination Items
            </div>
            {items.map((item, idx) => (
              <div key={idx} style={{ border: '1px solid #e0e0e0', borderRadius: '8px', padding: '0.75rem', marginBottom: '0.75rem', position: 'relative' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#555', marginBottom: '0.5rem' }}>Item {idx + 1}</div>
                {items.length > 1 && (
                  <Button design="Transparent" style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', fontSize: '0.75rem' }}
                    onClick={() => removeItem(idx)}>✕ Remove</Button>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                  <div>
                    <Label>Item Type *</Label>
                    <Select style={{ width: '100%' }} onChange={e => setItemField(idx, 'Itemtype', e.detail.selectedOption.value)}>
                      <Option value="">-- Select --</Option>
                      {(valueHelps.itemTypes || []).map(t => (
                        <Option key={t.Itemtype} value={t.Itemtype} selected={item.Itemtype === t.Itemtype}>
                          {t.Itemtype}{t.Description ? ` — ${t.Description}` : ''}
                        </Option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label>Location *</Label>
                    <Select style={{ width: '100%' }} onChange={e => setItemField(idx, 'Locationid', e.detail.selectedOption.value)}>
                      <Option value="">-- Select --</Option>
                      {valueHelps.locations.map(l => (
                        <Option key={l.Locationid} value={l.Locationid} selected={item.Locationid === l.Locationid}>
                          {l.Locationid}{l.Description && l.Description !== l.Locationid ? ` — ${l.Description}` : ''}
                        </Option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label>Material *</Label>
                    <Select style={{ width: '100%' }} onChange={e => setItemField(idx, 'Demandmaterial', e.detail.selectedOption.value)}>
                      <Option value="">-- Select --</Option>
                      {valueHelps.materials.map(m => (
                        <Option key={m.Demandmaterial} value={m.Demandmaterial} selected={item.Demandmaterial === m.Demandmaterial}>{m.Demandmaterial}</Option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label>Scheduled Date *</Label>
                    <Input type="Date" style={{ width: '100%' }} value={item.Scheduleddate}
                      onInput={e => setItemField(idx, 'Scheduleddate', e.target.value)} />
                  </div>
                  <div>
                    <Label>Quantity *</Label>
                    <Input type="Number" placeholder="e.g. 1000" style={{ width: '100%' }} value={item.Nominatedqty}
                      onInput={e => setItemField(idx, 'Nominatedqty', e.target.value)} />
                  </div>
                  <div>
                    <Label>Unit *</Label>
                    <Select style={{ width: '100%' }} onChange={e => setItemField(idx, 'Quantityunit', e.detail.selectedOption.value)}>
                      <Option value="">-- Select --</Option>
                      {valueHelps.quantityUnits.map(u => (
                        <Option key={u.Unit} value={u.Unit} selected={item.Quantityunit === u.Unit}>{u.Unit} ({u.Description})</Option>
                      ))}
                    </Select>
                  </div>
                </div>
              </div>
            ))}
            <Button design="Default" onClick={addItem} style={{ marginBottom: '1rem' }}>+ Add Item</Button>

            {createMsg && (
              <div style={{
                marginTop: '0.75rem', padding: '0.6rem 1rem', borderRadius: '6px',
                background: createMsg.ok ? '#e8f5e9' : '#fdecea',
                color: createMsg.ok ? '#2e7d32' : '#c62828',
                fontSize: '0.85rem',
              }}>
                {createMsg.text}
              </div>
            )}

            <FlexBox direction="Row" style={{ gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
              <Button design="Transparent" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</Button>
              <Button design="Emphasized" onClick={submitCreateNomination} disabled={creating ||
                !form.Nominationtype || !form.Transportsystem ||
                items.some(it => !it.Itemtype || !it.Locationid || !it.Demandmaterial || !it.Scheduleddate || !it.Nominatedqty || !it.Quantityunit)}>
                {creating ? 'Creating…' : 'Create Nomination'}
              </Button>
            </FlexBox>
          </div>
        </div>
      )}

      {/* Chat window */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        border: '1px solid #dde', borderRadius: '8px',
        background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem',
        }}>
          {messages.map((msg, i) => (
            <FlexBox key={i} direction="Row" justifyContent={msg.role === 'user' ? 'End' : 'Start'}>
              <div style={{
                maxWidth: '75%',
                padding: '0.6rem 1rem',
                borderRadius: msg.role === 'user' ? '1rem 1rem 0.25rem 1rem' : '1rem 1rem 1rem 0.25rem',
                background: msg.role === 'user' ? '#0070f2' : msg.isError ? '#ffd0d0' : '#f0f2f5',
                color: msg.role === 'user' ? '#ffffff' : '#1d2d3e',
                boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                whiteSpace: msg.role === 'user' ? 'pre-wrap' : 'normal',
                fontSize: '0.875rem',
                lineHeight: '1.5',
              }}>
                {msg.role === 'assistant' ? <MarkdownText text={msg.text} /> : msg.text}
              </div>
            </FlexBox>
          ))}
          {loading && (
            <FlexBox direction="Row" justifyContent="Start">
              <div style={{ padding: '0.6rem 1rem', borderRadius: '1rem', background: '#f5f5f5' }}>
                <BusyIndicator size="Small" active />
              </div>
            </FlexBox>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Suggestions */}
      <FlexBox direction="Row" wrap="Wrap" style={{ gap: '0.5rem' }}>
        {SUGGESTIONS.map((s, i) => (
          <Button
            key={i}
            design="Transparent"
            style={{ fontSize: '0.78rem', border: '1px solid var(--sapField_BorderColor)', borderRadius: '1rem' }}
            onClick={() => sendMessage(s)}
            disabled={loading}
          >
            {s}
          </Button>
        ))}
      </FlexBox>

      {/* Input row */}
      <FlexBox direction="Row" style={{ gap: '0.5rem' }}>
        <Input
          style={{ flex: 1 }}
          placeholder="Ask about nomination ETAs, vessel tracking, or historical lead times…"
          value={input}
          onInput={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={loading}
        />
        <Button
          design="Emphasized"
          icon="paper-plane"
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
        >
          Send
        </Button>
      </FlexBox>
    </FlexBox>
  );
}
