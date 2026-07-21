import { useState, useRef, useEffect } from 'react';
import {
  FlexBox,
  Title,
  Text,
  Input,
  Button,
  Card,
  CardHeader,
  BusyIndicator,
  Icon
} from '@ui5/webcomponents-react';
import { chat } from '../api';

const SUGGESTIONS = [
  'What is the status of the latest reconciliation run?',
  'Are there any urgent variances requiring approval?',
  'Which tanks are flagged today?',
  'Give me a summary of today\'s results.'
];

const INITIAL_MESSAGE = { role: 'assistant', text: 'Hello! I\'m your Tank Reconciliation Assistant. Ask me about variance results, tank status, or pending approvals.' };
const SESSION_KEY = 'tank_recon_chat_history';

export default function AiChat() {
  const [messages, setMessages] = useState(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      return saved ? JSON.parse(saved) : [INITIAL_MESSAGE];
    } catch (_) { return [INITIAL_MESSAGE]; }
  });
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [sessionId]               = useState(() => crypto.randomUUID());
  const bottomRef                 = useRef(null);

  // Save messages to sessionStorage whenever they change
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
      const data = await chat(userText, sessionId);
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: data.value?.reply || data.reply || 'Sorry, I could not generate a response.',
        sources: data.value?.sources || data.sources || ''
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: 'Sorry, there was an error reaching the assistant. Please try again.',
        isError: true
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

  return (
    <FlexBox direction="Column" style={{ height: 'calc(100vh - 120px)', padding: '1rem', gap: '1rem' }}>
      <FlexBox direction="Row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level="H3">AI Reconciliation Assistant</Title>
        <Button design="Transparent" style={{ fontSize: '0.8rem', color: '#888' }}
          onClick={() => { setMessages([INITIAL_MESSAGE]); sessionStorage.removeItem(SESSION_KEY); }}>
          🗑 Clear Chat
        </Button>
      </FlexBox>

      {/* Chat window */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        border: '1px solid #dde', borderRadius: '8px',
        background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
      }}>
        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem'
        }}>
          {messages.map((msg, i) => (
            <FlexBox
              key={i}
              direction="Row"
              justifyContent={msg.role === 'user' ? 'End' : 'Start'}
            >
              <div style={{
                maxWidth: '75%',
                padding: '0.6rem 1rem',
                borderRadius: msg.role === 'user' ? '1rem 1rem 0.25rem 1rem' : '1rem 1rem 1rem 0.25rem',
                background: msg.role === 'user'
                  ? '#0070f2'
                  : msg.isError
                    ? '#ffd0d0'
                    : '#f0f2f5',
                color: msg.role === 'user' ? '#ffffff' : '#1d2d3e',
                boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                whiteSpace: 'pre-wrap',
                fontSize: '0.875rem',
                lineHeight: '1.5'
              }}>
                {msg.text}
                {msg.sources && (
                  <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', opacity: 0.6 }}>
                    Source: {msg.sources}
                  </div>
                )}
              </div>
            </FlexBox>
          ))}

          {loading && (
            <FlexBox direction="Row" justifyContent="Start">
              <div style={{ padding: '0.6rem 1rem', borderRadius: '1rem', background: 'var(--sapTile_Background, #f5f5f5)' }}>
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
          placeholder="Ask about tank variances, approvals, or reconciliation status…"
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
