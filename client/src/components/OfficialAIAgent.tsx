'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * OfficialAIAgent — Chatbot for Officials
 * 
 * A conversational AI assistant that helps officials (Clerk, Superintendent,
 * MRO, Collector, etc.) quickly understand an application without manually
 * scrolling through multiple screens.
 * 
 * It summarizes: trust score, OCR match/mismatch, verification history,
 * applicant details, document status, and gives role-specific recommendations.
 * 
 * HOW IT WORKS:
 *   1. The component receives the full `application` object (already loaded by dashboard)
 *   2. When user asks a question, it POSTs { application, question, officialDesignation }
 *      to /api/ai-agent/summarize
 *   3. The API routes the question to the right analysis generator
 *   4. Returns a rich markdown response rendered in the chat
 * 
 * NO extra blockchain/API calls — uses data already on screen.
 */

interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: Date;
  isLoading?: boolean;
}

interface OfficialAIAgentProps {
  application: any;
  officialDesignation: string;
  officialName: string;
  isVisible: boolean;
  onClose?: () => void;
}

const QUICK_ACTIONS = [
  { label: '📋 Full Summary', question: 'Give me a complete summary of this application', icon: '📋' },
  { label: '📊 Trust Score', question: 'Analyze the trust score for this application', icon: '📊' },
  { label: '🔍 OCR Analysis', question: 'Show me the OCR match/mismatch analysis', icon: '🔍' },
  { label: '📜 History', question: 'Show the verification history timeline', icon: '📜' },
  { label: '📄 Documents', question: 'What is the document and security status?', icon: '📄' },
  { label: '🎯 What should I do?', question: 'What do you recommend I do with this application?', icon: '🎯' },
];

// Renders markdown-like text to HTML for chat bubbles
function renderMarkdown(text: string): string {
  return text
    // Tables — convert markdown tables to HTML
    .replace(/\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)*)/g, (_, header, body) => {
      const headers = header.split('|').filter((h: string) => h.trim()).map((h: string) =>
        `<th class="px-3 py-1.5 text-left text-xs font-semibold text-blue-300 uppercase tracking-wider border-b border-white/10">${h.trim()}</th>`
      ).join('');
      const rows = body.trim().split('\n').map((row: string) => {
        const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) =>
          `<td class="px-3 py-1.5 text-xs text-slate-300 border-b border-white/5">${c.trim()}</td>`
        ).join('');
        return `<tr class="hover:bg-white/5">${cells}</tr>`;
      }).join('');
      return `<div class="overflow-x-auto my-3"><table class="w-full"><thead><tr class="bg-white/5">${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
    })
    // Headers
    .replace(/^### (.+)$/gm, '<h4 class="text-sm font-bold text-blue-300 mt-4 mb-2 flex items-center gap-2">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="text-base font-bold text-white mt-3 mb-2">$1</h3>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<div class="border-l-2 border-blue-500/50 pl-3 my-2 text-sm text-blue-200/80 italic">$1</div>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    // Italic
    .replace(/_"(.+?)"_/g, '<em class="text-slate-400">"$1"</em>')
    // Inline code
    .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 bg-white/10 rounded text-[11px] font-mono text-emerald-300">$1</code>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr class="border-white/10 my-3" />')
    // List items with dash
    .replace(/^- (.+)$/gm, '<div class="flex gap-2 ml-1 my-0.5"><span class="text-blue-400 shrink-0 text-xs mt-0.5">•</span><span class="text-sm">$1</span></div>')
    // Line breaks
    .replace(/\n/g, '<br />');
}

export default function OfficialAIAgent({ application, officialDesignation, officialName, isVisible, onClose }: OfficialAIAgentProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isQuerying, setIsQuerying] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (!isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isMinimized]);

  // Welcome message
  useEffect(() => {
    if (isVisible && messages.length === 0) {
      const applicantName = application?.fullName || application?.ownerName || 'Unknown';
      setMessages([{
        id: 'welcome',
        role: 'system',
        content: `🤖 **AI Assistant Active** — Hello, ${officialName}!\n\nI'm your AI assistant for application **${application?.receiptNumber || 'N/A'}** by **${applicantName}**.\n\nI can help you with:\n- **Full Summary** — One-paragraph application overview\n- **Trust Score** — M8 Trust Indexer breakdown\n- **OCR Analysis** — Document field match/mismatch\n- **Verification History** — Who did what and when\n- **Recommendations** — Role-specific advice for ${officialDesignation}\n\nAsk me anything or use the quick actions below! 👇`,
        timestamp: new Date(),
      }]);
    }
  }, [isVisible, application, officialName, officialDesignation, messages.length]);

  const handleSendMessage = useCallback(async (question: string) => {
    if (!question.trim() || isQuerying) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: question,
      timestamp: new Date(),
    };

    const loadingMsg: Message = {
      id: `loading-${Date.now()}`,
      role: 'agent',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInput('');
    setIsQuerying(true);

    try {
      const response = await fetch('/api/ai-agent/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application,
          question,
          officialDesignation,
        }),
      });

      const data = await response.json();

      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== loadingMsg.id);
        return [...filtered, {
          id: `agent-${Date.now()}`,
          role: 'agent' as const,
          content: data.success
            ? data.response
            : `❌ ${data.error || 'Failed to generate response.'}`,
          timestamp: new Date(),
        }];
      });
    } catch {
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== loadingMsg.id);
        return [...filtered, {
          id: `error-${Date.now()}`,
          role: 'agent' as const,
          content: '❌ **Connection Error.** Could not reach the AI Agent API. Please try again.',
          timestamp: new Date(),
        }];
      });
    } finally {
      setIsQuerying(false);
    }
  }, [application, officialDesignation, isQuerying]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSendMessage(input);
  };

  if (!isVisible) return null;

  return (
    <div className={`relative bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-amber-500/20 shadow-2xl shadow-amber-900/10 flex flex-col transition-all duration-300 ${isMinimized ? 'h-14' : ''}`}
      style={{ maxHeight: isMinimized ? '56px' : '720px' }}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-gradient-to-r from-amber-600/10 to-orange-600/10 rounded-t-2xl cursor-pointer select-none"
        onClick={() => setIsMinimized(!isMinimized)}
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
              <span className="text-base">🤖</span>
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-slate-900 animate-pulse" />
          </div>
          <div>
            <h3 className="text-white font-bold text-sm">AI Application Assistant</h3>
            <p className="text-amber-300/60 text-[11px]">{officialDesignation} · {application?.receiptNumber || 'N/A'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Message count badge */}
          {messages.length > 1 && (
            <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">
              {messages.length - 1} msg{messages.length > 2 ? 's' : ''}
            </span>
          )}
          {/* Minimize / Expand */}
          <button
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-all text-xs"
            onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }}
          >
            {isMinimized ? '▲' : '▼'}
          </button>
          {onClose && (
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-red-500/20 flex items-center justify-center text-white/50 hover:text-red-300 transition-all text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Body (hidden when minimized) ────────────────────────────── */}
      {!isMinimized && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[180px] max-h-[420px]"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}
          >
            {messages.map(message => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-200`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-amber-600/20 border border-amber-500/30 text-amber-100'
                      : message.role === 'system'
                      ? 'bg-slate-800/80 border border-slate-600/30 text-slate-200'
                      : 'bg-white/[0.03] border border-white/10 text-slate-200'
                  }`}
                >
                  {/* Role badge */}
                  <div className={`text-[10px] uppercase tracking-widest font-bold mb-1.5 ${
                    message.role === 'user' ? 'text-amber-400/60' : message.role === 'system' ? 'text-blue-400/60' : 'text-emerald-400/60'
                  }`}>
                    {message.role === 'user' ? officialDesignation : message.role === 'system' ? 'AI Assistant' : 'AI Agent'}
                  </div>

                  {/* Loading dots */}
                  {message.isLoading ? (
                    <div className="flex items-center gap-3 py-2">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-sm text-amber-300/60 italic">Analyzing application data...</span>
                    </div>
                  ) : (
                    <div
                      className="text-[13px] leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                    />
                  )}

                  {/* Timestamp */}
                  <div className="text-[10px] text-white/15 mt-2">
                    {message.timestamp.toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Actions */}
          <div className="px-4 py-2 border-t border-white/5">
            <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {QUICK_ACTIONS.map((action, i) => (
                <button
                  key={i}
                  onClick={() => handleSendMessage(action.question)}
                  disabled={isQuerying}
                  className="shrink-0 px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-amber-500/15 border border-white/8 hover:border-amber-500/30 text-[11px] text-white/60 hover:text-amber-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-white/10 bg-white/[0.02] rounded-b-2xl">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask about this application..."
                disabled={isQuerying}
                className="flex-1 bg-white/5 border border-white/10 focus:border-amber-500/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/25 outline-none transition-all disabled:opacity-40"
              />
              <button
                type="submit"
                disabled={isQuerying || !input.trim()}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-semibold text-sm shadow-lg shadow-amber-500/20 transition-all hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {isQuerying ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                ) : 'Ask'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
