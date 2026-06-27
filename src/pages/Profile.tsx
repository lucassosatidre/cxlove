import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { User, Lock, Save, Camera, Loader2 } from 'lucide-react';

export default function Profile() {
  const { user } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [memberSince, setMemberSince] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  useEffect(() => {
    if (!user) return;
    setEmail(user.email ?? '');
    setMemberSince(new Date(user.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }));
    supabase.from('profiles').select('full_name, phone, avatar_url').eq('id', user.id).single()
      .then(({ data }) => { if (data) { setFullName(data.full_name ?? ''); setPhone(data.phone ?? ''); setAvatarUrl(data.avatar_url ?? null); } });
  }, [user]);

  const initials = (fullName || email || 'U').split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase();

  const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith('image/')) { toast.error('Selecione uma imagem.'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Imagem muito grande (máx 5MB).'); return; }
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${user.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, cacheControl: '3600' });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = `${pub.publicUrl}?t=${Date.now()}`;
      await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
      setAvatarUrl(publicUrl);
      toast.success('Foto de perfil atualizada!');
    } catch (err: any) {
      toast.error('Erro ao enviar foto: ' + (err?.message ?? ''));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ full_name: fullName, phone }).eq('id', user.id);
    if (error) toast.error('Erro ao salvar: ' + error.message);
    else toast.success('Perfil atualizado com sucesso!');
    setSaving(false);
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) { toast.error('A nova senha deve ter pelo menos 6 caracteres'); return; }
    if (newPassword !== confirmPassword) { toast.error('As senhas não coincidem'); return; }
    setChangingPw(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) toast.error('Erro ao alterar senha: ' + error.message);
    else { toast.success('Senha alterada com sucesso!'); setNewPassword(''); setConfirmPassword(''); }
    setChangingPw(false);
  };

  return (
    <AppLayout title="Meu Perfil" subtitle="Seus dados e segurança">
      <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><User className="w-5 h-5" /> Meus Dados</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-center mb-2">
              <div className="relative">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="w-24 h-24 rounded-full object-cover border-2 border-border" />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-2xl font-bold">{initials}</div>
                )}
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="absolute bottom-0 right-0 h-8 w-8 rounded-full bg-gold-500 text-white flex items-center justify-center shadow-md hover:opacity-90">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarPick} />
              </div>
            </div>
            <div className="space-y-2"><Label>Nome Completo</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Seu nome" /></div>
            <div className="space-y-2"><Label>Telefone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" /></div>
            <div className="space-y-2"><Label>E-mail</Label><Input value={email} readOnly className="bg-muted" /></div>
            <div className="space-y-2"><Label>Membro desde</Label><Input value={memberSince} readOnly className="bg-muted" /></div>
            <Button onClick={handleSaveProfile} disabled={saving} className="w-full"><Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : 'Salvar Alterações'}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Lock className="w-5 h-5" /> Alterar Senha</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label>Nova Senha</Label><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" /></div>
            <div className="space-y-2"><Label>Confirmar Nova Senha</Label><Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repita a nova senha" /></div>
            <Button onClick={handleChangePassword} disabled={changingPw} variant="outline" className="w-full"><Lock className="w-4 h-4 mr-2" />{changingPw ? 'Alterando...' : 'Alterar Senha'}</Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
