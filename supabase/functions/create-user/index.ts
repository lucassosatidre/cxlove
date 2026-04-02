import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const ALL_PERMISSIONS = ['dashboard', 'import', 'reconciliation', 'delivery_reconciliation'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  console.log('[create-user] authHeader present:', !!authHeader);
  if (!authHeader) {
    console.error('[create-user] FAIL: missing Authorization header');
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user: caller }, error: callerError } = await supabaseUser.auth.getUser();
  console.log('[create-user] caller:', caller?.id, 'error:', callerError?.message);
  if (!caller) {
    console.error('[create-user] FAIL: getUser returned null, error:', callerError?.message);
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: roleData } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', caller.id)
    .eq('role', 'admin')
    .maybeSingle();

  if (!roleData) {
    return new Response(JSON.stringify({ error: 'Apenas administradores podem gerenciar usuários' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json();
  const { action } = body;

  // LIST USERS
  if (action === 'list') {
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: roles } = await supabaseAdmin.from('user_roles').select('*');
    const { data: permissions } = await supabaseAdmin.from('user_permissions').select('*');

    const enrichedUsers = users.map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      role: roles?.find(r => r.user_id === u.id)?.role || null,
      permissions: permissions?.filter(p => p.user_id === u.id).map(p => p.permission) || [],
    }));

    return new Response(JSON.stringify({ users: enrichedUsers }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // DELETE USER
  if (action === 'delete') {
    const { userId } = body;
    if (userId === caller.id) {
      return new Response(JSON.stringify({ error: 'Você não pode excluir a si mesmo' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    await supabaseAdmin.from('user_permissions').delete().eq('user_id', userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // UPDATE ROLE
  if (action === 'update_role') {
    const { userId, role } = body;
    await supabaseAdmin.from('user_roles').delete().eq('user_id', userId);
    if (role) {
      const { error } = await supabaseAdmin.from('user_roles').insert({ user_id: userId, role });
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // UPDATE PERMISSIONS
  if (action === 'update_permissions') {
    const { userId, permissions } = body;
    // Delete existing permissions
    await supabaseAdmin.from('user_permissions').delete().eq('user_id', userId);
    // Insert new permissions
    if (permissions && permissions.length > 0) {
      const rows = permissions.map((p: string) => ({ user_id: userId, permission: p }));
      const { error } = await supabaseAdmin.from('user_permissions').insert(rows);
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // CREATE USER (default action)
  const { email, password, role, permissions } = body;

  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'Email e senha são obrigatórios' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (role && data.user) {
    await supabaseAdmin.from('user_roles').insert({ user_id: data.user.id, role });
  }

  // Add permissions (default: all)
  if (data.user) {
    const perms = permissions && permissions.length > 0 ? permissions : ALL_PERMISSIONS;
    const rows = perms.map((p: string) => ({ user_id: data.user!.id, permission: p }));
    await supabaseAdmin.from('user_permissions').insert(rows);
  }

  return new Response(JSON.stringify({ user: data.user }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
