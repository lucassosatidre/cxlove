import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Zap, Copy, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const WEBHOOK_URL = 'https://hvpmkkxvvjnefayrlcjy.supabase.co/functions/v1/inter-webhook';

type Tipo = 'pix-pagamento' | 'boleto-pagamento';

const LABELS: Record<Tipo, string> = {
  'pix-pagamento': 'Pix pagamento',
  'boleto-pagamento': 'Boleto pagamento',
};

export default function InterWebhookCard() {
  const [loading, setLoading] = useState<Tipo | null>(null);
  const [activeTipos, setActiveTipos] = useState<Set<Tipo>>(new Set());
  const [copied, setCopied] = useState(false);

  async function activate(tipo: Tipo) {
    setLoading(tipo);
    try {
      const { data, error } = await supabase.functions.invoke('inter-webhook-register', {
        body: { tipo },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setActiveTipos((prev) => new Set(prev).add(tipo));
      toast.success(`Webhook Inter (${tipo}) ativado`);
    } catch (e: any) {
      toast.error(`Falha ao ativar webhook ${tipo}: ${e?.message || e}`);
    } finally {
      setLoading(null);
    }
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(WEBHOOK_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const tipos: Tipo[] = ['transacao', 'pix', 'boleto', 'ted'];

  return (
    <Card className="border-l-4" style={{ borderLeftColor: '#FF6B00' }}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Zap className="h-5 w-5" style={{ color: '#FF6B00' }} />
          Banco Inter — Automação
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Ative as notificações automáticas para receber movimentações do Inter em tempo real,
          sem precisar importar extrato manualmente.
        </p>

        <div className="flex flex-wrap gap-2">
          {tipos.map((t) => {
            const isActive = activeTipos.has(t);
            return (
              <Button
                key={t}
                variant={isActive ? 'secondary' : 'default'}
                size="sm"
                onClick={() => activate(t)}
                disabled={loading === t}
                style={!isActive ? { backgroundColor: '#FF6B00', color: '#fff' } : undefined}
              >
                {loading === t ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : isActive ? (
                  <Check className="h-3 w-3 mr-1" />
                ) : null}
                {isActive ? `Ativado (${t})` : `Ativar ${t}`}
              </Button>
            );
          })}
        </div>

        <div className="rounded-md border bg-muted/40 p-3 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            URL do webhook
          </div>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono flex-1 truncate">{WEBHOOK_URL}</code>
            <Button size="icon" variant="ghost" onClick={copyUrl} title="Copiar URL">
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <Alert className="bg-amber-50 text-amber-900 border-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-xs">
            Para ativar os webhooks, a conta Inter precisa ter esta funcionalidade habilitada no
            Portal do Desenvolvedor do Inter (developers.inter.co → Webhooks). Se o botão retornar
            erro, entre em contato com o suporte Inter para habilitar webhooks na conta empresarial.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
