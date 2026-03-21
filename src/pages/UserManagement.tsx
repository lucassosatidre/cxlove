import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { ALL_PERMISSIONS } from '@/hooks/useUserPermissions';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, Shield, UserCog, Settings2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ManagedUser {
  id: string;
  email: string;
  created_at: string;
  role: string | null;
  permissions: string[];
}

export default function UserManagement() {
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { toast } = useToast();

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<string>('caixa_tele');
  const [newPermissions, setNewPermissions] = useState<string[]>(ALL_PERMISSIONS.map(p => p.key));
  const [creating, setCreating] = useState(false);

  // Delete dialog
  const [deleteUser, setDeleteUser] = useState<ManagedUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Role edit
  const [editingRole, setEditingRole] = useState<ManagedUser | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>('caixa_tele');
  const [updatingRole, setUpdatingRole] = useState(false);

  // Permissions edit
  const [editingPerms, setEditingPerms] = useState<ManagedUser | null>(null);
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [updatingPerms, setUpdatingPerms] = useState(false);

  useEffect(() => {
    if (!roleLoading && !isAdmin) navigate('/');
  }, [roleLoading, isAdmin, navigate]);

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin]);

  const callFunction = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('create-user', { body });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const loadUsers = async () => {
    try {
      const data = await callFunction({ action: 'list' });
      setUsers(data.users || []);
    } catch (err: any) {
      toast({ title: 'Erro ao carregar usuários', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newEmail || !newPassword) return;
    setCreating(true);
    try {
      await callFunction({ email: newEmail, password: newPassword, role: newRole, permissions: newPermissions });
      toast({ title: 'Usuário criado com sucesso' });
      setCreateOpen(false);
      setNewEmail('');
      setNewPassword('');
      setNewRole('caixa_tele');
      setNewPermissions(ALL_PERMISSIONS.map(p => p.key));
      loadUsers();
    } catch (err: any) {
      toast({ title: 'Erro ao criar usuário', description: err.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteUser) return;
    setDeleting(true);
    try {
      await callFunction({ action: 'delete', userId: deleteUser.id });
      toast({ title: 'Usuário excluído' });
      setDeleteUser(null);
      loadUsers();
    } catch (err: any) {
      toast({ title: 'Erro ao excluir', description: err.message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const handleUpdateRole = async () => {
    if (!editingRole) return;
    setUpdatingRole(true);
    try {
      await callFunction({ action: 'update_role', userId: editingRole.id, role: selectedRole });
      toast({ title: 'Papel atualizado' });
      setEditingRole(null);
      loadUsers();
    } catch (err: any) {
      toast({ title: 'Erro ao atualizar', description: err.message, variant: 'destructive' });
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleUpdatePermissions = async () => {
    if (!editingPerms) return;
    setUpdatingPerms(true);
    try {
      await callFunction({ action: 'update_permissions', userId: editingPerms.id, permissions: selectedPerms });
      toast({ title: 'Permissões atualizadas' });
      setEditingPerms(null);
      loadUsers();
    } catch (err: any) {
      toast({ title: 'Erro ao atualizar permissões', description: err.message, variant: 'destructive' });
    } finally {
      setUpdatingPerms(false);
    }
  };

  const togglePermission = (perms: string[], key: string, setter: (v: string[]) => void) => {
    setter(perms.includes(key) ? perms.filter(p => p !== key) : [...perms, key]);
  };

  const roleLabel = (role: string | null) => {
    if (role === 'admin') return 'Administrador';
    if (role === 'caixa_tele') return 'Caixa Tele';
    if (role === 'caixa_salao') return 'Caixa Salão';
    return 'Sem papel';
  };

  const roleBadgeClass = (role: string | null) => {
    if (role === 'admin') return 'bg-primary/15 text-primary border-primary/30';
    if (role === 'caixa_tele') return 'bg-blue-500/15 text-blue-600 border-blue-500/30';
    if (role === 'caixa_salao') return 'bg-amber-500/15 text-amber-600 border-amber-500/30';
    return 'bg-muted text-muted-foreground';
  };

  const permLabel = (key: string) => ALL_PERMISSIONS.find(p => p.key === key)?.label || key;

  if (roleLoading || (!isAdmin && !roleLoading)) {
    return (
      <AppLayout title="Usuários">
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Gestão de Usuários"
      subtitle="Cadastre e gerencie os acessos do sistema"
      headerActions={
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Usuário
        </Button>
      }
    >
      <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-16">
            <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Nenhum usuário cadastrado</h3>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-mail</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Permissões</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={roleBadgeClass(u.role)}>
                      {roleLabel(u.role)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.role === 'admin' ? (
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs">
                          Acesso total
                        </Badge>
                      ) : u.role === 'caixa_tele' ? (
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">
                          Tele
                        </Badge>
                      ) : u.role === 'caixa_salao' ? (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs">
                          Salão
                        </Badge>
                      ) : u.permissions.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Nenhuma</span>
                      ) : (
                        u.permissions.map(p => (
                          <Badge key={p} variant="outline" className="text-xs">
                            {permLabel(p)}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(u.created_at).toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingPerms(u);
                          setSelectedPerms(u.permissions || []);
                        }}
                        title="Permissões"
                        disabled={u.role === 'admin'}
                      >
                        <Settings2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingRole(u);
                          setSelectedRole(u.role || 'caixa_tele');
                        }}
                        title="Alterar papel"
                      >
                        <UserCog className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteUser(u)}
                        className="text-destructive hover:text-destructive"
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Usuário</DialogTitle>
            <DialogDescription>Preencha os dados para criar um novo acesso.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="usuario@exemplo.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
            </div>
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="caixa_tele">Caixa Tele</SelectItem>
                  <SelectItem value="caixa_salao">Caixa Salão</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newRole === 'operador' && (
              <div className="space-y-3">
                <Label>Permissões de acesso</Label>
                <div className="space-y-2">
                  {ALL_PERMISSIONS.map(p => (
                    <div key={p.key} className="flex items-center gap-2">
                      <Checkbox
                        id={`new-${p.key}`}
                        checked={newPermissions.includes(p.key)}
                        onCheckedChange={() => togglePermission(newPermissions, p.key, setNewPermissions)}
                      />
                      <label htmlFor={`new-${p.key}`} className="text-sm cursor-pointer">{p.label}</label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating || !newEmail || !newPassword}>
              {creating ? 'Criando...' : 'Criar Usuário'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog open={!!editingRole} onOpenChange={(open) => !open && setEditingRole(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar Papel</DialogTitle>
            <DialogDescription>{editingRole?.email}</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Administrador</SelectItem>
                <SelectItem value="caixa_tele">Caixa Tele</SelectItem>
                <SelectItem value="caixa_salao">Caixa Salão</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRole(null)}>Cancelar</Button>
            <Button onClick={handleUpdateRole} disabled={updatingRole}>
              {updatingRole ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Permissions Dialog */}
      <Dialog open={!!editingPerms} onOpenChange={(open) => !open && setEditingPerms(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permissões de Acesso</DialogTitle>
            <DialogDescription>{editingPerms?.email}</DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">Selecione as telas que o usuário pode acessar:</p>
            {ALL_PERMISSIONS.map(p => (
              <div key={p.key} className="flex items-center gap-2">
                <Checkbox
                  id={`edit-${p.key}`}
                  checked={selectedPerms.includes(p.key)}
                  onCheckedChange={() => togglePermission(selectedPerms, p.key, setSelectedPerms)}
                />
                <label htmlFor={`edit-${p.key}`} className="text-sm cursor-pointer">{p.label}</label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPerms(null)}>Cancelar</Button>
            <Button onClick={handleUpdatePermissions} disabled={updatingPerms}>
              {updatingPerms ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteUser} onOpenChange={(open) => !open && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              O usuário <strong>{deleteUser?.email}</strong> será removido permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
