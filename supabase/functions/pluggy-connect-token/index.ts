import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const clientId = Deno.env.get('PLUGGY_CLIENT_ID');
    const clientSecret = Deno.env.get('PLUGGY_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({ error: 'Credenciais Pluggy não configuradas no servidor.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let clientUserId: string | undefined;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        if (body && typeof body.clientUserId === 'string') clientUserId = body.clientUserId;
      } catch (_) { /* body opcional */ }
    }

    // Passo A: obter apiKey
    const authRes = await fetch('https://api.pluggy.ai/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    if (!authRes.ok) {
      const t = await authRes.text();
      console.error('Pluggy /auth falhou:', authRes.status, t);
      return new Response(
        JSON.stringify({ error: 'Falha ao autenticar na Pluggy.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const { apiKey } = await authRes.json();

    // Passo B: connect_token
    const ctRes = await fetch('https://api.pluggy.ai/connect_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify(clientUserId ? { clientUserId } : {}),
    });
    if (!ctRes.ok) {
      const t = await ctRes.text();
      console.error('Pluggy /connect_token falhou:', ctRes.status, t);
      return new Response(
        JSON.stringify({ error: 'Falha ao gerar token de conexão Pluggy.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const { accessToken } = await ctRes.json();

    return new Response(
      JSON.stringify({ accessToken }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('pluggy-connect-token erro:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
