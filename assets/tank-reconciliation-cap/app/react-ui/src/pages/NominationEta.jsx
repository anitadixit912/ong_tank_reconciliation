import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  FlexBox,
  Title,
  Input,
  Button,
  BusyIndicator,
} from '@ui5/webcomponents-react';

const SUGGESTIONS = [
  'Propose an ETA for nomination 4500001234',
  'Look up vessel ETA for nomination 4500001234',
  'What is the historical lead time for Diesel from USMOB via pipeline?',
  'Update events for nomination 4500001234 based on history',
];

const INITIAL_MESSAGE = {
  role: 'assistant',
  text: "Hello! I'm the Nomination ETA Proposal Agent. I can propose and update ETAs for TSW nominations using live Marine Traffic data and historical patterns.",
};

const SESSION_KEY = 'nomination_eta_chat_history';

function MarkdownText({ text }) {
  const lines = (text || '').split('\n');
  return (
    <div>
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <div key={i} style={{ fontWeight: 700, fontSize: '0.95rem', marginTop: '0.5rem' }}>{renderInline(line.slice(4))}</div>;
        if (line.startsWith('## '))  return <div key={i} style={{ fontWeight: 700, fontSize: '1rem', marginTop: '0.5rem' }}>{renderInline(line.slice(3))}</div>;
        if (line.startsWith('# '))   return <div key={i} style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: '0.5rem' }}>{renderInline(line.slice(2))}</div>;
        if (line.startsWith('- ') || line.startsWith('* ')) return <div key={i} style={{ paddingLeft: '1rem', display: 'flex', gap: '0.4rem' }}><span>•</span><span>{renderInline(line.slice(2))}</span></div>;
        if (line.match(/^\d+\.\s/)) return <div key={i} style={{ paddingLeft: '1rem' }}>{renderInline(line)}</div>;
        if (line.trim() === '') return <div key={i} style={{ height: '0.4rem' }} />;
        return <div key={i}>{renderInline(line)}</div>;
      })}
    </div>
  );
}

function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))   return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`'))   return <code key={i} style={{ background: 'rgba(0,0,0,0.08)', borderRadius: '3px', padding: '0 3px', fontSize: '0.85em' }}>{part.slice(1, -1)}</code>;
    return part;
  });
}

async function callNominationEtaAgent(userText, contextId) {
  const payload = {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'tasks/send',
    params: {
      id: crypto.randomUUID(),
      message: {
        role: 'user',
        parts: [{ type: 'text', text: userText }],
      },
      ...(contextId ? { contextId } : {}),
    },
  };

  const res = await fetch('/nomination-eta/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Agent error: ${res.status}`);
  const data = await res.json();

  const result = data?.result;
  const newContextId = result?.contextId || contextId;

  // Extract reply text from artifact or status message
  const artifact = result?.artifacts?.[0];
  if (artifact) {
    const text = artifact.parts?.find(p => p.type === 'text')?.text || '';
    return { text, contextId: newContextId };
  }
  const statusText = result?.status?.message?.parts?.find(p => p.type === 'text')?.text || 'No response received.';
  return { text: statusText, contextId: newContextId };
}

export default function NominationEta() {
  const [messages, setMessages] = useState(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      return saved ? JSON.parse(saved) : [INITIAL_MESSAGE];
    } catch (_) { return [INITIAL_MESSAGE]; }
  });
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [contextId, setContextId] = useState(null);
  const bottomRef               = useRef(null);

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

  return (
    <FlexBox direction="Column" style={{ height: 'calc(100vh - 120px)', padding: '1rem', gap: '1rem' }}>
      <div style={{ marginBottom: '0.25rem' }}>
        <Link to="/" style={{ color: '#0070f3', textDecoration: 'none', fontSize: '0.875rem' }}>← Dashboard</Link>
      </div>
      <FlexBox direction="Row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level="H3">🚢 Nomination ETA Agent</Title>
        <Button design="Transparent" style={{ fontSize: '0.8rem', color: '#888' }} onClick={clearChat}>
          🗑 Clear Chat
        </Button>
      </FlexBox>

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
                whiteSpace: 'pre-wrap',
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
