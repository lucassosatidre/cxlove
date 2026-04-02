import { useState } from 'react';
import { padPin } from '@/lib/pin-utils';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import propositoLogo from '@/assets/proposito-logo.png';
import estrelaLogo from '@/assets/estrela-logo.png';

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const isEmail = (value: string) => value.includes('@');

  const cleanPhone = (value: string) => value.replace(/\D/g, '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const trimmed = identifier.trim();

      if (isEmail(trimmed)) {
        await signIn(trimmed, password);
      } else {
        // Phone login — lookup email via edge function
        const phone = cleanPhone(trimmed);
        if (phone.length < 10) {
          setError('Telefone inválido. Digite com DDD.');
          setSubmitting(false);
          return;
        }

        const { data, error: fnError } = await supabase.functions.invoke('lookup-driver-email', {
          body: { telefone: phone },
        });

        if (fnError || !data?.email) {
          setError(data?.error || 'Telefone não cadastrado. Verifique com a administração.');
          setSubmitting(false);
          return;
        }

        await signIn(data.email, password);
      }
    } catch (err: any) {
      setError(err.message || 'Usuário ou senha inválidos.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-4">
        {/* App Card */}
        <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 rounded-xl bg-muted/50 border border-border flex items-center justify-center p-2 shrink-0">
              <img src={propositoLogo} alt="Propósito Soluções" className="h-full w-full object-contain" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">CX Love</h1>
              <p className="text-sm text-primary font-medium mt-0.5">Plataforma de finanças</p>
              <p className="text-xs text-muted-foreground mt-0.5">By: Propósito Soluções</p>
            </div>
          </div>
        </div>

        {/* Client Card */}
        <div className="bg-card rounded-2xl border border-border shadow-sm px-5 py-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg overflow-hidden shrink-0">
            <img src={estrelaLogo} alt="Pizzaria Estrela da Ilha" className="h-full w-full object-cover" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Cliente Ativo</p>
            <p className="text-sm font-semibold text-foreground">Pizzaria Estrela da Ilha</p>
          </div>
        </div>

        {/* Login Card */}
        <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="identifier" className="text-foreground text-sm">Email ou Telefone</Label>
              <Input
                id="identifier"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="seu@email.com ou (XX) XXXXX-XXXX"
                required
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-foreground text-sm">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="bg-background"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full font-semibold" disabled={submitting}>
              {submitting ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
