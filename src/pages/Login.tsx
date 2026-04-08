import { useState } from 'react';
import { padPin } from '@/lib/pin-utils';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { Mail, Lock } from 'lucide-react';
import propositoLogo from '@/assets/proposito-logo.png';
import motoboyBg from '@/assets/motoboy-bg.jpg';

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

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
      {/* Left branding panel — motoboy background */}
      <div className="hidden lg:flex lg:w-1/2 relative flex-col items-center justify-start overflow-hidden">
        <img
          src={motoboyBg}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          width={960}
          height={1440}
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(180deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.45) 50%, rgba(0,0,0,0.8) 100%)',
          }}
        />

        {/* Title in upper third */}
        <div className="relative z-10 flex flex-col items-center text-center mt-[15%]">
          <h1
            className="text-6xl text-white"
            style={{
              fontFamily: "'Permanent Marker', cursive",
              textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
              letterSpacing: '0.08em',
            }}
          >
            CAIXA LOVE
          </h1>
        </div>

        {/* Footer */}
        <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center gap-2">
          <div className="h-6 w-6 rounded bg-white/10 border border-white/10 flex items-center justify-center p-0.5">
            <img src={propositoLogo} alt="Propósito Soluções" className="h-full w-full object-contain" />
          </div>
          <span className="text-[11px] text-white/30">By: Propósito Soluções</span>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 bg-background lg:w-1/2">
        <div className="w-full max-w-md animate-fade-in">
          {/* Mobile header with motoboy background */}
          <div className="lg:hidden mb-8 -mx-6 -mt-12">
            <div className="relative h-[200px] overflow-hidden flex items-center justify-center">
              <img
                src={motoboyBg}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                width={960}
                height={1440}
              />
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.8) 100%)',
                }}
              />
              <h1
                className="relative z-10 text-4xl text-white"
                style={{
                  fontFamily: "'Permanent Marker', cursive",
                  textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
                }}
              >
                CAIXA LOVE
              </h1>
            </div>
          </div>

          {/* Form card */}
          <div className="bg-card rounded-2xl border border-border shadow-sm p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">Bem-vindo</h2>
              <p className="text-sm text-muted-foreground mt-1">Entre com suas credenciais</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
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
                    required
                    className="h-12 pl-11 rounded-xl bg-white border-border focus-visible:ring-[hsl(var(--primary))] focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:border-[hsl(var(--primary))] transition-colors"
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
                    required
                    className="h-12 pl-11 rounded-xl bg-white border-border focus-visible:ring-[hsl(var(--primary))] focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:border-[hsl(var(--primary))] transition-colors"
                  />
                </div>
                <div className="text-right">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => {}}
                  >
                    Esqueceu a senha?
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(v) => setRememberMe(v === true)}
                />
                <Label htmlFor="remember" className="text-sm text-muted-foreground font-normal cursor-pointer">
                  Lembrar minha senha
                </Label>
              </div>

              {error && (
                <p className="text-sm text-destructive bg-destructive/10 px-4 py-2.5 rounded-lg">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-12 rounded-xl text-base font-bold shadow-md hover:shadow-lg hover:brightness-110 transition-all bg-primary text-primary-foreground"
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