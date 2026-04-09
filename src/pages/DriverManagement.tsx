import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Search, Pencil, UserCheck, UserX, Copy } from 'lucide-react';
import DriverSummaryCards from '@/components/delivery/DriverSummaryCards';
import DashboardTodayCard from '@/components/delivery/DashboardTodayCard';
import DriverHistorySection from '@/components/delivery/DriverHistorySection';
import DriverRankingSection from '@/components/delivery/DriverRankingSection';
import DriverShiftsContent from '@/components/delivery/DriverShiftsContent';
import DriverTodaySection from '@/components/delivery/DriverTodaySection';

interface Driver {
  id: string;
  auth_user_id: string;
  nome: string;
  telefone: string;
  email: string;
  cnpj: string | null;
  pix: string | null;
  status: string;
  max_periodos_dia: number;
  notas: string | null;
  created_at: string;
}

function maskPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function maskCNPJ(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  ativo: { label: 'Ativo', variant: 'default' },
  inativo: { label: 'Inativo', variant: 'secondary' },
  suspenso: { label: 'Suspenso', variant: 'destructive' },
};

export default function DriverManagement() {
  const { isAdmin, loading: roleLoading } = useUserRole();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get('tab') || 'dashboard';
  const setActiveTab = (tab: string) => {
    setSearchParams({ tab }, { replace: true });
  };

  const [dashboardPeriod, setDashboardPeriod] = useState('30d');
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('todos');

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    nome: '', telefone: '', email: '', cnpj: '', password: '', notas: '',
  });
  const [creating, setCreating] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);

  const [editDriver, setEditDriver] = useState<Driver | null>(null);
  const [editForm, setEditForm] = useState({
    nome: '', telefone: '', cnpj: '', notas: '', status: 'ativo',
  });
  const [saving, setSaving] = useState(false);
  const [editPassword, setEditPassword] = useState('');
  const [resetPasswordResult, setResetPasswordResult] = useState<string | null>(null);

  const fetchDrivers = useCallback(async () => {
    const { data, error } = await supabase.from('delivery_drivers').select('*').order('nome');
    if (!error && data) setDrivers(data as Driver[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!roleLoading && !isAdmin) { navigate('/'); return; }
    if (!roleLoading && isAdmin) fetchDrivers();
  }, [roleLoading, isAdmin, navigate, fetchDrivers]);

  const invokeFunction = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('manage-drivers', { body });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const handleCreate = async () => {
    if (!createForm.nome || !createForm.telefone || !createForm.email) {
      toast.error('Nome, telefone e email são obrigatórios');
      return;
    }
    setCreating(true);
    try {
      const result = await invokeFunction({ action: 'create', ...createForm });
      setCreatedPassword(result.password);
      toast.success('Entregador criado com sucesso!');
      fetchDrivers();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar entregador');
    } finally {
      setCreating(false);
    }
  };

  const resetCreateForm = () => {
    setCreateForm({ nome: '', telefone: '', email: '', cnpj: '', password: '', notas: '' });
    setCreatedPassword(null);
  };

  const handleUpdate = async () => {
    if (!editDriver) return;
    setSaving(true);
    try {
      await invokeFunction({ action: 'update', driver_id: editDriver.id, ...editForm });
      if (editPassword.trim()) {
        await invokeFunction({ action: 'reset_password', driver_id: editDriver.id, new_password: editPassword.trim() });
        toast.success('Entregador e senha atualizados!');
      } else {
        toast.success('Entregador atualizado!');
      }
      setEditDriver(null);
      setEditPassword('');
      fetchDrivers();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao atualizar');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (driver: Driver) => {
    const newStatus = driver.status === 'ativo' ? 'inativo' : 'ativo';
    try {
      await invokeFunction({ action: 'update', driver_id: driver.id, status: newStatus });
      toast.success(`Entregador ${newStatus === 'ativo' ? 'reativado' : 'inativado'}`);
      fetchDrivers();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const openEdit = (d: Driver) => {
    setEditDriver(d);
    setEditForm({
      nome: d.nome, telefone: d.telefone, cnpj: d.cnpj || '',
      notas: d.notas || '', status: d.status,
    });
    setResetPasswordResult(null);
    setEditPassword('');
  };

  const filtered = drivers.filter(d => {
    if (statusFilter !== 'todos' && d.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return d.nome.toLowerCase().includes(s) || d.telefone.includes(s);
    }
    return true;
  });

  if (roleLoading || loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Entregadores</h1>
          {activeTab === 'cadastro' && (
            <Button onClick={() => { resetCreateForm(); setShowCreate(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Novo Entregador
            </Button>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="escala">Escala</TabsTrigger>
            <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6">
            <DriverSummaryCards />
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-3">Hoje</h2>
              <DriverTodaySection />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-3">Histórico de Presenças</h2>
              <DriverHistorySection />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-3">Ranking de Entregadores</h2>
              <DriverRankingSection />
            </div>
          </TabsContent>

          <TabsContent value="escala">
            <DriverShiftsContent />
          </TabsContent>

          <TabsContent value="cadastro" className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar por nome ou telefone…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="ativo">Ativos</SelectItem>
                  <SelectItem value="inativo">Inativos</SelectItem>
                  <SelectItem value="suspenso">Suspensos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead className="hidden md:table-cell">Email</TableHead>
                    <TableHead className="hidden lg:table-cell">CNPJ</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum entregador encontrado</TableCell></TableRow>
                  ) : filtered.map(d => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.nome}</TableCell>
                      <TableCell>{d.telefone}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-xs">{d.email}</TableCell>
                      <TableCell className="hidden lg:table-cell text-xs">{d.cnpj || '—'}</TableCell>
                      <TableCell>
                        <Badge
                          variant={statusConfig[d.status]?.variant || 'secondary'}
                          className="cursor-pointer hover:opacity-70 transition-opacity"
                          onClick={() => handleToggleStatus(d)}
                        >
                          {statusConfig[d.status]?.label || d.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(d)} title="Editar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleToggleStatus(d)} title={d.status === 'ativo' ? 'Inativar' : 'Reativar'}>
                            {d.status === 'ativo' ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* CREATE DIALOG */}
      <Dialog open={showCreate} onOpenChange={v => { if (!v) { setShowCreate(false); resetCreateForm(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{createdPassword ? 'Entregador Criado!' : 'Novo Entregador'}</DialogTitle></DialogHeader>
          {createdPassword ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Entregador cadastrado com sucesso. Compartilhe os dados de acesso:</p>
              <div className="bg-muted p-4 rounded-lg space-y-2">
                <p className="text-sm"><strong>Email:</strong> {createForm.email}</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm"><strong>Senha:</strong> {createdPassword}</p>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { navigator.clipboard.writeText(createdPassword); toast.success('Senha copiada!'); }}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => { setShowCreate(false); resetCreateForm(); }}>Fechar</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div><Label>Nome completo *</Label><Input value={createForm.nome} onChange={e => setCreateForm(f => ({ ...f, nome: e.target.value }))} /></div>
              <div><Label>Telefone *</Label><Input value={createForm.telefone} onChange={e => setCreateForm(f => ({ ...f, telefone: maskPhone(e.target.value) }))} placeholder="(XX) XXXXX-XXXX" /></div>
              <div><Label>Email *</Label><Input type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div><Label>CNPJ (MEI)</Label><Input value={createForm.cnpj} onChange={e => setCreateForm(f => ({ ...f, cnpj: maskCNPJ(e.target.value) }))} placeholder="XX.XXX.XXX/XXXX-XX" /></div>
              <div><Label>Senha *</Label><Input type="text" value={createForm.password} onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} placeholder="Digite a senha do entregador" /></div>
              <div><Label>Observações</Label><Textarea value={createForm.notas} onChange={e => setCreateForm(f => ({ ...f, notas: e.target.value }))} rows={2} /></div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setShowCreate(false); resetCreateForm(); }}>Cancelar</Button>
                <Button onClick={handleCreate} disabled={creating}>{creating ? 'Criando…' : 'Criar Entregador'}</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* EDIT DIALOG */}
      <Dialog open={!!editDriver} onOpenChange={v => { if (!v) { setEditDriver(null); setResetPasswordResult(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar Entregador</DialogTitle></DialogHeader>
          {editDriver && (
            <div className="space-y-4">
              <div><Label>Email (login)</Label><Input value={editDriver.email} disabled className="bg-muted" /></div>
              <div><Label>Nome completo</Label><Input value={editForm.nome} onChange={e => setEditForm(f => ({ ...f, nome: e.target.value }))} /></div>
              <div><Label>Telefone</Label><Input value={editForm.telefone} onChange={e => setEditForm(f => ({ ...f, telefone: maskPhone(e.target.value) }))} /></div>
              <div><Label>CNPJ (MEI)</Label><Input value={editForm.cnpj} onChange={e => setEditForm(f => ({ ...f, cnpj: maskCNPJ(e.target.value) }))} placeholder="XX.XXX.XXX/XXXX-XX" /></div>
              <div><Label>Status</Label>
                <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                    <SelectItem value="suspenso">Suspenso</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Observações</Label><Textarea value={editForm.notas} onChange={e => setEditForm(f => ({ ...f, notas: e.target.value }))} rows={2} /></div>
              <div className="border-t pt-3">
                <Label>Nova senha (deixe vazio para manter a atual)</Label>
                <Input type="text" value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder="Deixe vazio para manter a senha atual" className="mt-1" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setEditDriver(null); setResetPasswordResult(null); }}>Cancelar</Button>
                <Button onClick={handleUpdate} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
