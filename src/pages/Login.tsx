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
      <div className="w-full max-w-sm">
        <div className="bg-card rounded-2xl border border-border shadow-sm p-8">
          {/* Propósito logo */}
          <div className="flex justify-center mb-5">
            <div className="h-20 w-20 rounded-2xl bg-muted/50 border border-border flex items-center justify-center p-2">
              <img src={propositoLogo} alt="Propósito Soluções" className="h-full w-full object-contain" />
            </div>
          </div>

          {/* App name */}
          <h1 className="text-2xl font-bold text-foreground text-center">CX Love</h1>

          {/* Subtitle + dev credit */}
          <p className="text-sm text-primary font-medium text-center mt-1">Fechamento de caixa</p>
          <p className="text-xs text-muted-foreground text-center mt-0.5">Propósito Soluções</p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 mt-6">
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
