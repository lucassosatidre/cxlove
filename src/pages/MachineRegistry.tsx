import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { Navigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Machine {
  id: string;
  serial_number: string;
  friendly_name: string;
  category: string;
  is_active: boolean;
}

export default function MachineRegistry() {
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Machine | null>(null);
  const [form, setForm] = useState({ serial_number: '', friendly_name: '', category: 'tele', is_active: true });
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<Machine | null>(null);

  const load = async () => {
    const { data } = await supabase.from('machine_registry').select('*').order('friendly_name');
    setMachines((data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (roleLoading) return <div className="flex min-h-screen items-center justify-center bg-background"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  if (!isAdmin) return <Navigate to="/" replace />;

  const openCreate = () => {
    setEditing(null);
    setForm({ serial_number: '', friendly_name: '', category: 'tele', is_active: true });
    setDialogOpen(true);
  };

  const openEdit = (m: Machine) => {
    setEditing(m);
    setForm({ serial_number: m.serial_number, friendly_name: m.friendly_name, category: m.category, is_active: m.is_active });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.serial_number.trim() || !form.friendly_name.trim()) {
      toast.error('Preencha todos os campos');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase.from('machine_registry').update({
          serial_number: form.serial_number.trim(),
          friendly_name: form.friendly_name.trim(),
          category: form.category,
          is_active: form.is_active,
          updated_at: new Date().toISOString(),
        }).eq('id', editing.id);
        if (error) throw error;
        toast.success('Maquininha atualizada');
      } else {
        const { error } = await supabase.from('machine_registry').insert({
          serial_number: form.serial_number.trim(),
          friendly_name: form.friendly_name.trim(),
          category: form.category,
          is_active: form.is_active,
        } as any);
        if (error) throw error;
        toast.success('Maquininha cadastrada');
      }
      setDialogOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase.from('machine_registry').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toast.success('Maquininha removida');
      setDeleteTarget(null);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Erro ao remover');
    }
  };

  return (
    <AppLayout title="Maquininhas">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">Cadastro de Maquininhas</h1>
          <Button onClick={openCreate} size="sm"><Plus className="h-4 w-4 mr-1" />Nova</Button>
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Serial Number</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-center">Ativo</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : machines.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhuma maquininha cadastrada</TableCell></TableRow>
              ) : machines.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="font-semibold">{m.friendly_name}</TableCell>
                  <TableCell className="font-mono text-xs">{m.serial_number}</TableCell>
                  <TableCell className="capitalize">{m.category}</TableCell>
                  <TableCell className="text-center">{m.is_active ? '✅' : '❌'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(m)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(m)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Editar Maquininha' : 'Nova Maquininha'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nome Amigável</label>
              <Input value={form.friendly_name} onChange={e => setForm(f => ({ ...f, friendly_name: e.target.value }))} placeholder="Ex: Tele 5" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Serial Number</label>
              <Input value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} placeholder="Ex: 158252515630" className="font-mono" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Categoria</label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tele">Tele</SelectItem>
                  <SelectItem value="frota">Frota</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
              <label className="text-sm">Ativa</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover maquininha?</AlertDialogTitle>
            <AlertDialogDescription>Remover "{deleteTarget?.friendly_name}" ({deleteTarget?.serial_number})? Isso não afeta leituras anteriores.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
