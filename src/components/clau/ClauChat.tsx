import { useState, useEffect, useRef } from 'react';
import { useUserRole } from '@/hooks/useUserRole';
import { useScreenContext } from '@/hooks/useScreenContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageCircle, Send, Plus, Pin, History } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';

const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: 'Rápido/barato' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', hint: 'Equilibrado' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7', hint: 'Mais capaz' },
];
const DEFAULT_MODEL = 'claude-sonnet-4-6';

type Message = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
};

type Conversation = {
  id: string;
  title: string | null;
  is_pinned: boolean;
  updated_at: string;
};

export default function ClauChat() {
  const { isAdmin } = useUserRole();
  const screenContext = useScreenContext();
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    loadConversations();
  }, [open]);

  useEffect(() => {
    if (!activeConv) {
      setMessages([]);
      setModel(DEFAULT_MODEL);
      return;
    }
    loadMessages(activeConv);
    // sync model from selected conversation
    supabase
      .from('clau_conversations')
      .select('model')
      .eq('id', activeConv)
      .maybeSingle()
      .then(({ data }) => {
        const m = data?.model;
        if (m && MODEL_OPTIONS.some((o) => o.value === m)) setModel(m);
      });
  }, [activeConv]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  if (!isAdmin) return null;

  async function loadConversations() {
    const { data } = await supabase
      .from('clau_conversations')
      .select('id, title, is_pinned, updated_at')
      .order('is_pinned', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(20);
    setConversations((data ?? []) as Conversation[]);
  }

  async function loadMessages(convId: string) {
    const { data } = await supabase
      .from('clau_messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    setMessages((data ?? []) as Message[]);
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('clau-chat', {
        body: {
          conversation_id: activeConv,
          user_message: userMsg,
          current_page: screenContext.page,
          screen_context: screenContext,
          model,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setActiveConv(data.conversation_id);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.assistant_message }]);
      loadConversations();
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `❌ Erro: ${e?.message ?? 'Falha ao conectar com Clau'}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function newConversation() {
    setActiveConv(null);
    setMessages([]);
    setShowHistory(false);
  }

  async function togglePin(convId: string, isPinned: boolean) {
    await supabase.from('clau_conversations').update({ is_pinned: !isPinned }).eq('id', convId);
    loadConversations();
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-orange-500 hover:bg-orange-600 text-white shadow-xl flex items-center justify-center transition-all hover:scale-105"
          aria-label="Abrir Clau"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:w-[420px] p-0 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-sm">
              C
            </div>
            <div>
              <h2 className="font-semibold text-sm">Clau</h2>
              <p className="text-xs text-muted-foreground">{screenContext.page}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setShowHistory(!showHistory)} title="Histórico">
              <History className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={newConversation} title="Nova conversa">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* History panel */}
        {showHistory && (
          <div className="border-b border-border max-h-64 overflow-y-auto bg-muted/30">
            {conversations.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4 text-center">Nenhuma conversa ainda</p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 hover:bg-accent cursor-pointer border-b border-border/50',
                    activeConv === c.id && 'bg-accent'
                  )}
                  onClick={() => {
                    setActiveConv(c.id);
                    setShowHistory(false);
                  }}
                >
                  <span className="flex-1 text-sm truncate">{c.title ?? 'Nova conversa'}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(c.id, c.is_pinned);
                    }}
                    className={cn('ml-2', c.is_pinned ? 'text-orange-500' : 'text-muted-foreground hover:text-foreground')}
                    title={c.is_pinned ? 'Desafixar' : 'Fixar'}
                  >
                    <Pin className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && !loading && (
            <div className="text-center py-12 space-y-2">
              <p className="text-base font-medium">Olá Lucas, eu sou a Clau.</p>
              <p className="text-sm text-muted-foreground">
                Me pergunta qualquer coisa sobre a operação ou tela atual.
              </p>
              <p className="text-xs text-muted-foreground pt-2">
                Tela atual: <span className="font-medium">{screenContext.page}</span>
              </p>
            </div>
          )}

          {messages.map((m, idx) => (
            <div key={idx} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                  m.role === 'user'
                    ? 'bg-orange-500/15 text-foreground border border-orange-500/30'
                    : 'bg-muted text-foreground'
                )}
              >
                <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-2 prose-headings:my-2">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-3 py-2">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border p-3">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Pergunta pra Clau..."
              className="min-h-[60px] resize-none"
              disabled={loading}
            />
            <Button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              size="icon"
              className="bg-orange-500 hover:bg-orange-600 text-white self-end"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Enter envia · Shift+Enter quebra linha</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
