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
import caixaLoveLogo from '@/assets/caixa-love-logo.png';

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#1A1A1A' }}>
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
      {/* Left panel — logo on black */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center" style={{ background: '#0A0A0A' }}>
        <img
          src={caixaLoveLogo}
          alt="CAIXA LOVE"
          className="max-w-[420px] w-[70%]"
        />
      </div>

      {/* Right panel — dark form */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 lg:w-1/2" style={{ background: '#1A1A1A' }}>
        <div className="w-full max-w-md animate-fade-in">
          {/* Mobile header */}
          <div className="lg:hidden mb-8 -mx-6 -mt-12 flex items-center justify-center" style={{ background: '#0A0A0A', height: 150 }}>
            <img src={caixaLoveLogo} alt="CAIXA LOVE" className="max-h-[120px]" />
          </div>

          {/* Form card */}
          <div className="rounded-2xl p-8" style={{ background: '#242424', border: '1px solid #333' }}>
            <div className="mb-8">
              <h2 className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>Bem-vindo</h2>
              <p className="text-sm mt-1" style={{ color: '#999' }}>Entre com suas credenciais</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="identifier" className="text-sm font-medium" style={{ color: '#E5E5E5' }}>
                  Email ou Telefone
                </Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: '#999' }} />
                  <Input
                    id="identifier"
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    className="h-12 pl-11 rounded-xl transition-colors"
                    style={{ background: '#2D2D2D', border: '1px solid #444', color: '#FFFFFF' }}
                    onFocus={(e) => (e.target.style.borderColor = '#F97316')}
                    onBlur={(e) => (e.target.style.borderColor = '#444')}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium" style={{ color: '#E5E5E5' }}>
                  Senha
                </Label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: '#999' }} />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-12 pl-11 rounded-xl transition-colors"
                    style={{ background: '#2D2D2D', border: '1px solid #444', color: '#FFFFFF' }}
                    onFocus={(e) => (e.target.style.borderColor = '#F97316')}
                    onBlur={(e) => (e.target.style.borderColor = '#444')}
                  />
                </div>
                <div className="text-right">
                  <button type="button" className="text-xs hover:underline" style={{ color: '#F97316' }} onClick={() => {}}>
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
                <Label htmlFor="remember" className="text-sm font-normal cursor-pointer" style={{ color: '#AAA' }}>
                  Lembrar minha senha
                </Label>
              </div>

              {error && (
                <p className="text-sm px-4 py-2.5 rounded-lg" style={{ color: '#FF6B6B', background: 'rgba(255,107,107,0.1)' }}>
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-12 rounded-xl text-base font-bold shadow-md hover:shadow-lg hover:brightness-110 transition-all"
                style={{ background: '#F97316', color: '#FFFFFF' }}
              >
                {submitting ? 'Entrando...' : 'Entrar'}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
