import { useState } from 'react';
import { padPin } from '@/lib/pin-utils';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { User, Lock } from 'lucide-react';
import vigiaLogo from '@/assets/vigia-logo.png';

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: 'linear-gradient(160deg, #030914 0%, #061A33 100%)' }}>
        <div className="animate-spin h-8 w-8 border-4 border-gold-500 border-t-transparent rounded-full" />
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
    <div
      className="flex min-h-screen items-center justify-center px-4 py-10"
      style={{ background: 'radial-gradient(1200px 600px at 50% -10%, hsl(var(--navy-800)) 0%, hsl(var(--navy-900)) 45%, hsl(var(--navy-950)) 100%)' }}
    >
      {/* Subtle gold corner accents */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 w-[420px] h-[420px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(201,151,46,0.18), transparent 70%)' }} />
        <div className="absolute -bottom-40 -left-40 w-[420px] h-[420px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(38,59,122,0.35), transparent 70%)' }} />
      </div>

      <div className="relative w-full max-w-[420px] animate-fade-in flex flex-col items-center">
        {/* Ivory card */}
        <div
          className="w-full rounded-[18px] px-8 py-9 flex flex-col items-center"
          style={{
            background: '#F8F6F0',
            boxShadow: '0 24px 60px rgba(3,9,20,0.45), inset 0 0 0 1px rgba(201,151,46,0.18)',
          }}
        >
          <img src={vigiaLogo} alt="VIGIA" className="w-[180px] h-[180px] object-contain -mt-2" />

          <p className="mt-2 text-xs uppercase tracking-[0.2em]" style={{ color: '#6B7280' }}>
            Acesse sua conta
          </p>

          <form onSubmit={handleSubmit} className="w-full space-y-4 mt-4">
            <div className="space-y-1.5">
              <Label htmlFor="identifier" className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#101827' }}>
                Usuário
              </Label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: '#8A5A16' }} />
                <Input
                  id="identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  className="h-12 pl-11 rounded-xl transition-colors"
                  style={{ background: '#FFFFFF', border: '1px solid #E5D8B8', color: '#101827' }}
                  onFocus={(e) => { e.target.style.borderColor = '#C9972E'; e.target.style.boxShadow = '0 0 0 3px rgba(201,151,46,0.18)'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#E5D8B8'; e.target.style.boxShadow = 'none'; }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#101827' }}>
                Senha
              </Label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: '#8A5A16' }} />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 pl-11 rounded-xl transition-colors"
                  style={{ background: '#FFFFFF', border: '1px solid #E5D8B8', color: '#101827' }}
                  onFocus={(e) => { e.target.style.borderColor = '#C9972E'; e.target.style.boxShadow = '0 0 0 3px rgba(201,151,46,0.18)'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#E5D8B8'; e.target.style.boxShadow = 'none'; }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <Checkbox id="remember" checked={rememberMe} onCheckedChange={(v) => setRememberMe(v === true)} />
                <Label htmlFor="remember" className="text-sm font-normal cursor-pointer" style={{ color: '#6B7280' }}>
                  Lembrar minha senha
                </Label>
              </div>
              <button type="button" className="text-sm hover:underline" style={{ color: '#8A5A16' }} onClick={() => {}}>
                Esqueceu a senha?
              </button>
            </div>

            {error && (
              <p className="text-sm px-4 py-2.5 rounded-lg" style={{ color: '#B42318', background: 'rgba(180,35,24,0.08)', border: '1px solid rgba(180,35,24,0.2)' }}>
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-12 rounded-xl text-base font-semibold tracking-wide shadow-md hover:shadow-lg hover:brightness-110 transition-all"
              style={{ background: '#061A33', color: '#F8F6F0', border: '1px solid #C9972E' }}
            >
              {submitting ? 'Validando...' : 'Entrar'}
            </Button>
          </form>

          <p className="mt-6 text-[11px] italic text-center" style={{ color: '#8A5A16' }}>
            “VIGIA protege a operação antes que o erro vire prejuízo.”
          </p>
        </div>

        {/* Selo */}
        <p className="font-title italic text-sm mt-5 tracking-wide" style={{ color: '#E5D8B8' }}>
          by Propósito Soluções
        </p>
      </div>
    </div>
  );
}
