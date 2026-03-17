import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ClipboardCheck } from 'lucide-react';

export default function Login() {
  const { user, loading, signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);

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
      if (isSignUp) {
        await signUp(email, password);
        setSignUpSuccess(true);
      } else {
        await signIn(email, password);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao autenticar.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center mb-4">
            <ClipboardCheck className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Saipos Conferência</h1>
          <p className="text-sm text-muted-foreground mt-1">Fechamento de caixa rápido e confiável</p>
        </div>

        <div className="bg-card rounded-lg shadow-card p-6">
          {signUpSuccess ? (
            <div className="text-center py-4">
              <p className="text-success font-medium">Conta criada com sucesso!</p>
              <p className="text-sm text-muted-foreground mt-2">Verifique seu email para confirmar.</p>
              <Button className="mt-4 w-full" onClick={() => { setIsSignUp(false); setSignUpSuccess(false); }}>
                Voltar ao login
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Carregando...' : isSignUp ? 'Criar conta' : 'Entrar'}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                {isSignUp ? 'Já tem conta?' : 'Não tem conta?'}{' '}
                <button type="button" className="text-primary hover:underline font-medium" onClick={() => { setIsSignUp(!isSignUp); setError(''); }}>
                  {isSignUp ? 'Entrar' : 'Criar conta'}
                </button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
