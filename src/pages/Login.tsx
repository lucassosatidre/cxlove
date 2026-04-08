import { useState } from 'react';
import { padPin } from '@/lib/pin-utils';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { Mail, Lock } from 'lucide-react';
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

  const signInDriver = async (email: string, rawPassword: string) => {
    try {
      await signIn(email, padPin(rawPassword));
    } catch {
      await signIn(email, rawPassword);
      supabase.auth.updateUser({ password: padPin(rawPassword) }).catch(() => {});
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const trimmed = identifier.trim();

      if (isEmail(trimmed)) {
        if (trimmed.endsWith('@entregador.cx')) {
          await signInDriver(trimmed, password);
        } else {
          await signIn(trimmed, password);
        }
      } else {
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

        await signInDriver(data.email, password);
      }
    } catch (err: any) {
      setError(err.message || 'Usuário ou senha inválidos.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left branding panel — hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12 overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #1A1A1A 0%, #2D2D2D 100%)' }}
      >
        {/* Subtle pattern overlay */}
        <div className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: '32px 32px',
          }}
        />

        {/* Decorative shapes */}
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-[0.06]"
          style={{ background: 'radial-gradient(circle, #F97316 0%, transparent 70%)' }}
        />
        <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full opacity-[0.04]"
          style={{ background: 'radial-gradient(circle, #F97316 0%, transparent 70%)' }}
        />

        <div className="relative z-10 flex flex-col gap-2">
          <div className="flex items-center gap-3 mb-8">
            <div className="h-12 w-12 rounded-xl overflow-hidden border border-white/10">
              <img src={estrelaLogo} alt="Pizzaria Estrela da Ilha" className="h-full w-full object-cover" />
            </div>
          </div>

          <h1 className="text-5xl font-bold text-white tracking-tight">CX Love</h1>
          <p className="text-lg text-white/50 mt-2">Plataforma de finanças</p>
        </div>

        <div className="relative z-10 flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center p-1">
            <img src={propositoLogo} alt="Propósito Soluções" className="h-full w-full object-contain" />
          </div>
          <span className="text-xs text-white/30">By: Propósito Soluções</span>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 bg-background lg:w-1/2">
        <div className="w-full max-w-md animate-fade-in">
          {/* Mobile branding */}
          <div className="flex flex-col items-center gap-3 mb-10 lg:hidden">
            <div className="h-16 w-16 rounded-2xl overflow-hidden shadow-md">
              <img src={estrelaLogo} alt="Pizzaria Estrela da Ilha" className="h-full w-full object-cover" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold text-foreground">CX Love</h1>
              <p className="text-sm text-muted-foreground">Plataforma de finanças</p>
            </div>
          </div>

          {/* Active client badge */}
          <div className="flex items-center gap-2.5 mb-8 px-4 py-2.5 rounded-full bg-muted/50 border border-border w-fit mx-auto lg:mx-0">
            <div className="h-6 w-6 rounded-full overflow-hidden shrink-0">
              <img src={estrelaLogo} alt="" className="h-full w-full object-cover" />
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              Pizzaria Estrela da Ilha
            </span>
          </div>

          {/* Form card */}
          <div className="bg-card rounded-2xl border border-border shadow-sm p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">Bem-vindo de volta</h2>
              <p className="text-sm text-muted-foreground mt-1">Entre com suas credenciais</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="identifier" className="text-foreground text-sm font-medium">
                  Email ou Telefone
                </Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="identifier"
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="seu@email.com ou (XX) XXXXX-XXXX"
                    required
                    className="h-12 pl-11 rounded-xl bg-background border-border focus-visible:ring-[#F97316] focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:border-[#F97316] transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-foreground text-sm font-medium">
                  Senha
                </Label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="h-12 pl-11 rounded-xl bg-background border-border focus-visible:ring-[#F97316] focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:border-[#F97316] transition-colors"
                  />
                </div>
              </div>

              {error && (
                <p className="text-sm text-destructive bg-destructive/10 px-4 py-2.5 rounded-lg">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-12 rounded-xl text-base font-bold shadow-md hover:shadow-lg transition-all"
                style={{ backgroundColor: '#F97316', color: 'white' }}
              >
                {submitting ? 'Entrando...' : 'Entrar'}
              </Button>
            </form>
          </div>

          {/* Mobile footer */}
          <div className="flex items-center justify-center gap-2 mt-8 lg:hidden">
            <div className="h-5 w-5 rounded bg-muted/50 flex items-center justify-center p-0.5">
              <img src={propositoLogo} alt="" className="h-full w-full object-contain" />
            </div>
            <span className="text-[10px] text-muted-foreground">By: Propósito Soluções</span>
          </div>
        </div>
      </div>
    </div>
  );
}
