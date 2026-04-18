import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { ArrowLeft } from 'lucide-react';

interface Props { title: string; }

export default function AuditPlaceholder({ title }: Props) {
  const navigate = useNavigate();
  return (
    <AppLayout title={title}>
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink onClick={() => navigate('/admin/auditoria')} className="cursor-pointer">
                Auditoria
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{title}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <p className="text-muted-foreground">
              Funcionalidade em desenvolvimento — será implementada no próximo prompt.
            </p>
            <Button variant="outline" onClick={() => navigate('/admin/auditoria')} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Voltar ao Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
