import React, { Component, ErrorInfo } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-6">
          <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center mb-6">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Ocorreu um erro inesperado</h1>
          <p className="text-muted-foreground text-center mb-6 max-w-md">
            Algo deu errado ao carregar esta página. Tente recarregar ou voltar à tela inicial.
          </p>
          {this.state.error && (
            <pre className="text-xs text-muted-foreground bg-muted rounded-lg p-3 mb-6 max-w-lg overflow-auto">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-3">
            <Button variant="outline" onClick={this.handleGoHome}>
              Voltar ao início
            </Button>
            <Button onClick={this.handleReload}>
              Recarregar página
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
