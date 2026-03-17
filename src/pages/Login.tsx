import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import propositoLogo from '@/assets/proposito-logo.png';

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[hsl(20,10%,8%)]">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (err: any) {
      setError(err.message || 'Usuário ou senha inválidos.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[hsl(20,10%,8%)] px-4">
      <div className="w-full max-w-sm">
        {/* Propósito Soluções logo */}
        <div className="flex justify-center mb-6">
          <img src={propositoLogo} alt="Propósito Soluções" className="h-16 object-contain" />
        </div>

        {/* Client name */}
        <div className="flex flex-col items-center mb-8">
          <h1 className="text-2xl font-bold text-white">Pizzaria Estrela da Ilha</h1>
          <p className="text-sm text-white/50 mt-1">Fechamento de caixa rápido e confiável</p>
        </div>

        <div className="bg-[hsl(20,10%,12%)] rounded-2xl border border-white/10 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-white/70 text-xs font-semibold uppercase tracking-wider">Usuário</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-primary focus:ring-primary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-white/70 text-xs font-semibold uppercase tracking-wider">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-primary focus:ring-primary"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" disabled={submitting}>
              {submitting ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
        </div>
      </div>

      <p className="mt-8 text-[10px] text-white/20">
        Desenvolvido por Propósito Soluções
      </p>
    </div>
  );
}
