import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
  const bottomRef                   = useRef(null);

  useEffect(() => {
    fetch('/reconciliation/getNominationValueHelps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.json())
      .then(d => {
        const vh = d?.value || d;
        if (vh?.locations) setValueHelps(vh);
      })
      .catch(() => {});
  }, []);

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
        setCreateMsg({ ok: true, text: `✅ Nomination ${result.Nominationnumber || ''} created successfully!` });
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: `✅ **Nomination Created**\n\n- **Nomination #:** ${result.Nominationnumber}\n- **Transport System:** ${form.Transportsystem}\n- **Type:** ${form.Nominationtype}\n- **Items:** ${items.length}\n\nWould you like me to propose an ETA for this nomination?`,
        }]);
        setTimeout(() => { setShowCreate(false); setForm(EMPTY_FORM); setItems([{ Itemtype: '', Locationid: '', Demandmaterial: '', Nominatedqty: '', Quantityunit: '', Scheduleddate: '' }]); setCreateMsg(null); }, 1500);
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
          <Button design="Emphasized" icon="add" onClick={() => { setShowCreate(true); setCreateMsg(null); }}>
            Create Nomination
          </Button>
          <Button design="Transparent" style={{ fontSize: '0.8rem', color: '#888' }} onClick={clearChat}>
            🗑 Clear Chat
          </Button>
        </FlexBox>
      </FlexBox>

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
