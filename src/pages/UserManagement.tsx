import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, RotateCcw, Search } from "lucide-react";
import { MENU_STRUCTURE, ALL_MENU_KEYS } from "@/lib/menu-config";
import { usePermissions } from "@/contexts/PermissionsContext";

interface UserRow { id: string; full_name: string | null; email: string | null; phone: string | null; is_active: boolean | null; }
interface PermissionRow { menu_key: string; can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean; }

export default function UserManagement() {
  const { refetch: refetchGlobalPermissions } = usePermissions();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [tab, setTab] = useState<"active" | "inactive">("active");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [step, setStep] = useState(1);

  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);
  const [formPermissions, setFormPermissions] = useState<PermissionRow[]>([]);
  const [formSaving, setFormSaving] = useState(false);

  const [deletingUser, setDeletingUser] = useState<UserRow | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("profiles").select("id, full_name, email, phone, is_active").order("created_at", { ascending: false });
    setUsers((data ?? []) as UserRow[]);
    setLoading(false);
  }, []);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const matchesSearch = (u: UserRow) => !searchText || (u.full_name ?? "").toLowerCase().includes(searchText.toLowerCase()) || (u.email ?? "").toLowerCase().includes(searchText.toLowerCase());
  const activeUsers = users.filter((u) => u.is_active !== false);
  const inactiveUsers = users.filter((u) => u.is_active === false);
  const filtered = (tab === "active" ? activeUsers : inactiveUsers).filter(matchesSearch);

  const initPermissions = (existing?: PermissionRow[]): PermissionRow[] =>
    ALL_MENU_KEYS.map((key) => existing?.find((p) => p.menu_key === key) ?? { menu_key: key, can_view: false, can_create: false, can_edit: false, can_delete: false });

  const openCreateModal = () => {
    setEditingUser(null); setFormName(""); setFormEmail(""); setFormPhone(""); setFormPassword(""); setFormIsActive(true);
    setFormPermissions(initPermissions()); setStep(1); setModalOpen(true);
  };
  const openEditModal = async (user: UserRow) => {
    setEditingUser(user); setFormName(user.full_name ?? ""); setFormEmail(user.email ?? ""); setFormPhone(user.phone ?? "");
    setFormPassword(""); setFormIsActive(user.is_active !== false); setStep(1);
    const { data } = await supabase.from("menu_permissions").select("menu_key, can_view, can_create, can_edit, can_delete").eq("user_id", user.id);
    const perms = (data ?? []).map((d) => ({ menu_key: d.menu_key, can_view: d.can_view ?? false, can_create: d.can_create ?? false, can_edit: d.can_edit ?? false, can_delete: d.can_delete ?? false }));
    setFormPermissions(initPermissions(perms)); setModalOpen(true);
  };

  const togglePermission = (key: string, field: keyof PermissionRow) => setFormPermissions((prev) => prev.map((p) => p.menu_key === key ? { ...p, [field]: !p[field as keyof PermissionRow] } : p));
  const setAllPermissions = (value: boolean) => setFormPermissions((prev) => prev.map((p) => ({ ...p, can_view: value, can_create: value, can_edit: value, can_delete: value })));
  const toggleModule = (moduleItems: readonly { key: string }[], value: boolean) => { const keys = moduleItems.map((i) => i.key); setFormPermissions((prev) => prev.map((p) => keys.includes(p.menu_key) ? { ...p, can_view: value, can_create: value, can_edit: value, can_delete: value } : p)); };
  const isModuleAllChecked = (moduleItems: readonly { key: string }[]) => { const keys = moduleItems.map((i) => i.key); return formPermissions.filter((p) => keys.includes(p.menu_key)).every((p) => p.can_view && p.can_create && p.can_edit && p.can_delete); };

  const handleSave = async () => {
    if (!formName.trim()) { toast.error("Nome é obrigatório"); return; }
    setFormSaving(true);
    try {
      let userId = editingUser?.id;
      if (!editingUser) {
        if (!formEmail.trim() || !formPassword.trim()) { toast.error("E-mail e senha são obrigatórios"); setFormSaving(false); return; }
        if (formPassword.length < 6) { toast.error("Senha deve ter pelo menos 6 caracteres"); setFormSaving(false); return; }
        const { data, error } = await supabase.functions.invoke("admin-create-user", { body: { email: formEmail, password: formPassword, full_name: formName, phone: formPhone } });
        if (error || data?.error) { toast.error("Erro ao criar usuário", { description: data?.error || error?.message }); setFormSaving(false); return; }
        userId = data.user.id;
      } else {
        const emailChanged = !!formEmail.trim() && formEmail.trim() !== (editingUser.email ?? "");
        const wantsPassword = formPassword.trim().length > 0;
        if (emailChanged || wantsPassword) {
          if (wantsPassword && formPassword.length < 6) { toast.error("Senha deve ter pelo menos 6 caracteres"); setFormSaving(false); return; }
          const { data: upd, error: updErr } = await supabase.functions.invoke("admin-update-user", { body: { user_id: editingUser.id, email: emailChanged ? formEmail.trim() : undefined, password: wantsPassword ? formPassword : undefined } });
          if (updErr || upd?.error) { toast.error("Erro ao atualizar e-mail/senha", { description: upd?.error || updErr?.message }); setFormSaving(false); return; }
        }
        await supabase.from("profiles").update({ full_name: formName, phone: formPhone, is_active: formIsActive }).eq("id", editingUser.id);
      }
      if (userId) {
        await supabase.from("menu_permissions").delete().eq("user_id", userId);
        const rows = formPermissions.map((p) => ({ user_id: userId!, menu_key: p.menu_key, can_view: p.can_view, can_create: p.can_create, can_edit: p.can_edit, can_delete: p.can_delete }));
        await supabase.from("menu_permissions").insert(rows);
      }
      toast.success(editingUser ? "Usuário atualizado!" : "Usuário criado com sucesso!");
      setModalOpen(false); fetchUsers(); refetchGlobalPermissions();
    } catch (err: any) { toast.error("Erro", { description: err.message }); }
    setFormSaving(false);
  };

  const handleDeactivate = async () => {
    if (!deletingUser) return;
    await supabase.from("profiles").update({ is_active: false }).eq("id", deletingUser.id);
    toast.success(`Usuário ${deletingUser.full_name || deletingUser.email} desativado.`);
    setDeletingUser(null); fetchUsers();
  };
  const handleReactivate = async (u: UserRow) => {
    await supabase.from("profiles").update({ is_active: true }).eq("id", u.id);
    toast.success(`Usuário ${u.full_name || u.email} reativado.`);
    fetchUsers();
  };

  return (
    <AppLayout title="Usuários & Permissões" subtitle="Defina exatamente o que cada usuário pode acessar"
      headerActions={<Button onClick={openCreateModal}><Plus className="w-4 h-4 mr-2" /> Novo Usuário</Button>}>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "inactive")} className="mb-4">
        <TabsList>
          <TabsTrigger value="active">Ativos ({activeUsers.length})</TabsTrigger>
          <TabsTrigger value="inactive">Inativos ({inactiveUsers.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome ou e-mail..." value={searchText} onChange={(e) => setSearchText(e.target.value)} className="pl-10" />
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead className="hidden md:table-cell">Telefone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhum usuário encontrado.</TableCell></TableRow>
            ) : (
              filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell className="hidden md:table-cell">{u.phone || "—"}</TableCell>
                  <TableCell><Badge variant={u.is_active !== false ? "default" : "destructive"}>{u.is_active !== false ? "Ativo" : "Inativo"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEditModal(u)}><Pencil className="w-4 h-4" /></Button>
                      {u.is_active !== false ? (
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeletingUser(u)}><Trash2 className="w-4 h-4" /></Button>
                      ) : (
                        <Button size="icon" variant="ghost" className="text-green-600" onClick={() => handleReactivate(u)} title="Reativar"><RotateCcw className="w-4 h-4" /></Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingUser ? "Editar Usuário" : "Novo Usuário"} — Etapa {step} de 2</DialogTitle></DialogHeader>
          {step === 1 ? (
            <div className="space-y-4">
              <div className="space-y-2"><Label>Nome Completo *</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Nome completo" /></div>
              <div className="space-y-2"><Label>E-mail *</Label><Input value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="email@exemplo.com" />{editingUser && (<p className="text-xs text-muted-foreground">Alterar aqui troca o e-mail de login deste usuário.</p>)}</div>
              <div className="space-y-2"><Label>Telefone</Label><Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} placeholder="(00) 00000-0000" /></div>
              <div className="space-y-2"><Label>{editingUser ? "Nova Senha" : "Senha Inicial *"}</Label><Input type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder={editingUser ? "Deixe em branco para não alterar" : "Mínimo 6 caracteres"} autoComplete="new-password" />{editingUser && (<p className="text-xs text-muted-foreground">Preencha só se quiser redefinir a senha (mínimo 6 caracteres).</p>)}</div>
              {editingUser && (<div className="flex items-center gap-3"><Label>Ativo</Label><Switch checked={formIsActive} onCheckedChange={setFormIsActive} /></div>)}
              <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button><Button onClick={() => setStep(2)}>Próximo</Button></div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-2 mb-2"><Button size="sm" variant="outline" onClick={() => setAllPermissions(true)}>Marcar Todos</Button><Button size="sm" variant="outline" onClick={() => setAllPermissions(false)}>Desmarcar Todos</Button></div>
              {MENU_STRUCTURE.map((mod) => {
                const allChecked = isModuleAllChecked(mod.items);
                return (
                  <div key={mod.module} className="border border-border rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2"><Checkbox checked={allChecked} onCheckedChange={(v) => toggleModule(mod.items, !!v)} /><span className="font-semibold text-sm">{mod.module}</span></div>
                    <div className="space-y-1.5 ml-6">
                      {mod.items.map((item) => {
                        const perm = formPermissions.find((p) => p.menu_key === item.key);
                        if (!perm) return null;
                        const isOnlyView = "onlyView" in item && item.onlyView;
                        return (
                          <div key={item.key} className="flex items-center gap-4 text-sm">
                            <span className="w-36 text-muted-foreground">{item.label}</span>
                            <label className="flex items-center gap-1.5"><Checkbox checked={perm.can_view} onCheckedChange={() => togglePermission(item.key, "can_view")} /><span>Ver</span></label>
                            {!isOnlyView && (<>
                              <label className="flex items-center gap-1.5"><Checkbox checked={perm.can_create} onCheckedChange={() => togglePermission(item.key, "can_create")} /><span>Criar</span></label>
                              <label className="flex items-center gap-1.5"><Checkbox checked={perm.can_edit} onCheckedChange={() => togglePermission(item.key, "can_edit")} /><span>Editar</span></label>
                              <label className="flex items-center gap-1.5"><Checkbox checked={perm.can_delete} onCheckedChange={() => togglePermission(item.key, "can_delete")} /><span>Excluir</span></label>
                            </>)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div className="flex justify-between pt-2"><Button variant="outline" onClick={() => setStep(1)}>Voltar</Button><Button onClick={handleSave} disabled={formSaving}>{formSaving ? "Salvando..." : editingUser ? "Salvar Alterações" : "Criar Usuário"}</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingUser} onOpenChange={(open) => !open && setDeletingUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar Usuário</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja desativar o usuário <strong>{deletingUser?.full_name || deletingUser?.email}</strong>? Ele vai para a aba Inativos e pode ser reativado depois.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate} className="bg-destructive text-destructive-foreground">Desativar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
