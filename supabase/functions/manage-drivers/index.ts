import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PIN_SUFFIX = '@@';
function padPin(pin: string): string { return pin + PIN_SUFFIX; }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

  const { data: { user: caller } } = await supabaseUser.auth.getUser();
  if (!caller) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Verify admin role
  const { data: roleData } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', caller.id)
    .eq('role', 'admin')
    .maybeSingle();

  if (!roleData) {
    return new Response(JSON.stringify({ error: 'Apenas administradores podem gerenciar entregadores' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json();
  const { action } = body;

  // CREATE DRIVER
  if (action === 'create') {
    const { nome, telefone, email, cnpj, pix, max_periodos_dia, notas, password } = body;

    if (!nome || !telefone || !email) {
      return new Response(JSON.stringify({ error: 'Nome, telefone e email são obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rawPassword = password || telefone.replace(/\D/g, '').slice(-4);
    const finalPassword = padPin(rawPassword);

    // Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: finalPassword,
      email_confirm: true,
      user_metadata: { role: 'entregador', nome },
    });

    if (authError) {
      return new Response(JSON.stringify({ error: authError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Assign entregador role
    await supabaseAdmin.from('user_roles').insert({ user_id: authData.user.id, role: 'entregador' });

    // Create driver profile
    const { data: driverData, error: driverError } = await supabaseAdmin.from('delivery_drivers').insert({
      auth_user_id: authData.user.id,
      nome,
      telefone,
      email,
      cnpj: cnpj || null,
      pix: pix || null,
      max_periodos_dia: max_periodos_dia || 1,
      notas: notas || null,
    }).select().single();

    if (driverError) {
      // Rollback: delete auth user if driver creation fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return new Response(JSON.stringify({ error: driverError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ driver: driverData, password: rawPassword }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // UPDATE DRIVER
  if (action === 'update') {
    const { driver_id, nome, telefone, cnpj, pix, max_periodos_dia, notas, status } = body;

    if (!driver_id) {
      return new Response(JSON.stringify({ error: 'driver_id é obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (nome !== undefined) updateData.nome = nome;
    if (telefone !== undefined) updateData.telefone = telefone;
    if (cnpj !== undefined) updateData.cnpj = cnpj || null;
    if (pix !== undefined) updateData.pix = pix || null;
    if (max_periodos_dia !== undefined) updateData.max_periodos_dia = max_periodos_dia;
    if (notas !== undefined) updateData.notas = notas || null;
    if (status !== undefined) updateData.status = status;

    const { data, error } = await supabaseAdmin
      .from('delivery_drivers')
      .update(updateData)
      .eq('id', driver_id)
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ driver: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // RESET PASSWORD
  if (action === 'reset_password') {
    const { driver_id, new_password } = body;

    if (!driver_id) {
      return new Response(JSON.stringify({ error: 'driver_id é obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get auth_user_id from driver
    const { data: driver } = await supabaseAdmin
      .from('delivery_drivers')
      .select('auth_user_id, telefone')
      .eq('id', driver_id)
      .single();

    if (!driver) {
      return new Response(JSON.stringify({ error: 'Entregador não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rawPassword = new_password || driver.telefone.replace(/\D/g, '').slice(-4);
    const finalPassword = padPin(rawPassword);

    const { error } = await supabaseAdmin.auth.admin.updateUserById(driver.auth_user_id, {
      password: finalPassword,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ password: rawPassword }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Ação inválida' }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
