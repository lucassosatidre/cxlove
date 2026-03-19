import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import propositoLogo from '@/assets/proposito-logo.png';
import estrelaLogo from '@/assets/estrela-logo.png';

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
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
              <Label htmlFor="email" className="text-foreground text-sm">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
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
                minLength={6}
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
