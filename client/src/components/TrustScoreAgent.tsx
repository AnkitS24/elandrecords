'use client';

import React, { useState, useRef, useEffect } from 'react';

/**
 * TrustScoreAgent — AI Chat Agent for M8 Trust Score Explanation
 * 
 * This is the user-facing "AI Agent" that officials and users interact with.
 * 
 * FLOW:
 *   1. User types a question (e.g. "Why is my trust score 72?")
 *   2. Agent sends { applicationId, question } to POST /api/trust-score/explain
 *   3. That API hits Fabric API → Blockchain (Org2) → M8 Trust Indexer
 *   4. Gets back trustScore + trustDetails
 *   5. LLM interpretation engine generates explanation
 *   6. Agent displays the rich explanation in the chat
 * 
 * The agent has pre-built quick actions so users can click common questions
 * instead of typing them manually.
 */

interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: Date;
  trustScore?: number;
  isLoading?: boolean;
}

interface TrustScoreAgentProps {
  applicationId: string;
  isVisible: boolean;
  onClose?: () => void;
}

const QUICK_ACTIONS = [
  { label: '📊 Explain my trust score', question: 'Why is my trust score what it is? Explain the breakdown.' },
  { label: '📈 How to improve?', question: 'How can I improve my trust score?' },
  { label: '🛡️ Any fraud flags?', question: 'Are there any fraud flags on this application?' },
  { label: '🔍 What is integrity?', question: 'What does the integrity dimension measure and why is it important?' },
];

// Simple markdown-to-HTML renderer for the chat
function renderMarkdown(text: string): string {
  return text
    // Headers
    .replace(/^### (.+)$/gm, '<h4 class="text-base font-bold text-blue-300 mt-4 mb-2">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="text-lg font-bold text-white mt-4 mb-2">$1</h3>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    // Inline code
    .replace(/`(.+?)`/g, '<code class="px-1.5 py-0.5 bg-white/10 rounded text-xs font-mono text-emerald-300">$1</code>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr class="border-white/10 my-3" />')
    // List items
    .replace(/^- (.+)$/gm, '<div class="flex gap-2 ml-2 my-1"><span class="text-blue-400 shrink-0">•</span><span>$1</span></div>')
    .replace(/^\d+\. (.+)$/gm, '<div class="flex gap-2 ml-2 my-1"><span class="text-blue-400 shrink-0 font-mono text-xs">$&</span></div>')
    // Line breaks
    .replace(/\n/g, '<br />');
}

export default function TrustScoreAgent({ applicationId, isVisible, onClose }: TrustScoreAgentProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isQuerying, setIsQuerying] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Welcome message on mount
  useEffect(() => {
    if (isVisible && messages.length === 0) {
      setMessages([{
        id: 'welcome',
        role: 'system',
        content: `🤖 **M8 Trust Indexer Agent Active**\n\nI can analyze the blockchain trust score for application **${applicationId}**.\n\nI interpret data from the M8 Trust Indexer running on Org2 (Revenue Department). I evaluate three dimensions:\n- **Integrity** — Ledger ↔ IPFS hash verification\n- **Veracity** — Multi-signature endorsement tracking\n- **Symmetry** — AI-OCR match analysis\n\nAsk me anything about this application's trust score, or use the quick actions below.`,
        timestamp: new Date(),
      }]);
    }
  }, [isVisible, applicationId, messages.length]);

  const handleSendMessage = async (question: string) => {
    if (!question.trim() || isQuerying) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: question,
      timestamp: new Date(),
    };

    const loadingMessage: Message = {
      id: `loading-${Date.now()}`,
      role: 'agent',
      content: 'Querying M8 Trust Indexer on Org2 blockchain...',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages(prev => [...prev, userMessage, loadingMessage]);
    setInput('');
    setIsQuerying(true);

    try {
      // Call the explainTrustScore API
      const response = await fetch('/api/trust-score/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, question }),
      });

      const data = await response.json();

      // Remove loading message and add real response
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== loadingMessage.id);
        return [...filtered, {
          id: `agent-${Date.now()}`,
          role: 'agent',
          content: data.success
            ? data.explanation
            : `❌ **Error:** ${data.error || 'Failed to analyze trust score. Please ensure the Fabric API is running.'}`,
          timestamp: new Date(),
          trustScore: data.trustScore,
        }];
      });

    } catch (error) {
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== loadingMessage.id);
        return [...filtered, {
          id: `error-${Date.now()}`,
          role: 'agent',
          content: '❌ **Connection Error:** Could not reach the Trust Indexer. Please verify that the Fabric API server is running on port 3001.',
          timestamp: new Date(),
        }];
      });
    } finally {
      setIsQuerying(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSendMessage(input);
  };

  if (!isVisible) return null;

  return (
    <div className="relative overflow-hidden bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-cyan-500/20 shadow-2xl shadow-cyan-900/20 flex flex-col" style={{ maxHeight: '700px' }}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-gradient-to-r from-cyan-600/10 to-blue-600/10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
              <span className="text-lg">🧠</span>
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-slate-900 animate-pulse" />
          </div>
          <div>
            <h3 className="text-white font-bold text-sm">M8 Trust Score Agent</h3>
            <p className="text-cyan-300/60 text-xs">Org2 · Revenue Department · Live</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-all"
          >
            ✕
          </button>
        )}
      </div>

      {/* ── Messages ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[200px] max-h-[450px]" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                message.role === 'user'
                  ? 'bg-blue-600/30 border border-blue-500/30 text-blue-100'
                  : message.role === 'system'
                  ? 'bg-cyan-600/10 border border-cyan-500/20 text-cyan-100'
                  : 'bg-white/5 border border-white/10 text-slate-200'
              }`}
            >
              {/* Role label */}
              <div className={`text-[10px] uppercase tracking-widest font-bold mb-1.5 ${
                message.role === 'user' ? 'text-blue-300/60' : message.role === 'system' ? 'text-cyan-400/60' : 'text-emerald-400/60'
              }`}>
                {message.role === 'user' ? 'You' : message.role === 'system' ? 'System' : 'M8 Agent'}
              </div>

              {/* Loading animation */}
              {message.isLoading ? (
                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-sm text-cyan-300/70 italic">{message.content}</span>
                </div>
              ) : (
                <div
                  className="text-sm leading-relaxed prose-invert"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                />
              )}

              {/* Trust score badge */}
              {message.trustScore !== undefined && !message.isLoading && (
                <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2">
                  <span className="text-xs text-white/40">Trust Score:</span>
                  <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${
                    message.trustScore >= 90 ? 'bg-emerald-500/20 text-emerald-300' :
                    message.trustScore >= 75 ? 'bg-blue-500/20 text-blue-300' :
                    message.trustScore >= 50 ? 'bg-yellow-500/20 text-yellow-300' :
                    'bg-red-500/20 text-red-300'
                  }`}>
                    {message.trustScore.toFixed(1)}
                  </span>
                </div>
              )}

              {/* Timestamp */}
              <div className="text-[10px] text-white/20 mt-2">
                {message.timestamp.toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Quick Actions ───────────────────────────────────────────── */}
      <div className="px-4 py-2 border-t border-white/5 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {QUICK_ACTIONS.map((action, i) => (
          <button
            key={i}
            onClick={() => handleSendMessage(action.question)}
            disabled={isQuerying}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-500/30 text-xs text-white/70 hover:text-cyan-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {action.label}
          </button>
        ))}
      </div>

      {/* ── Input ───────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-white/10 bg-white/5">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about the trust score..."
            disabled={isQuerying}
            className="flex-1 bg-white/5 border border-white/10 focus:border-cyan-500/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-all disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isQuerying || !input.trim()}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-sm shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {isQuerying ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>...</span>
              </span>
            ) : (
              'Ask'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
