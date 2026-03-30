import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { LogOut, Truck } from 'lucide-react';

export default function EntregadorPortal() {
  const { signOut } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-6 p-8">
        <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
          <Truck className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Portal do Entregador</h1>
        <p className="text-muted-foreground">Em construção — em breve você poderá consultar seus turnos e check-ins aqui.</p>
        <Button variant="outline" onClick={signOut}>
          <LogOut className="h-4 w-4 mr-2" />
          Sair
        </Button>
      </div>
    </div>
  );
}
