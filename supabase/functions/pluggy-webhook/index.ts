import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let payload: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text && text.trim().length > 0) {
        payload = JSON.parse(text);
      }
    } catch (e) {
      console.error('pluggy-webhook: falha ao parsear JSON', e);
    }

    const event = (payload?.event as string) ?? null;
    const itemId =
      (payload?.itemId as string) ??
      (payload?.item_id as string) ??
      ((payload?.item as Record<string, unknown> | undefined)?.id as string) ??
      null;

    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      const { error } = await supabase.from('pluggy_events').insert({
        event,
        item_id: itemId,
        payload,
      });
      if (error) console.error('pluggy-webhook: erro ao salvar evento', error);
    } catch (e) {
      console.error('pluggy-webhook: exceção ao salvar evento', e);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('pluggy-webhook: erro inesperado', e);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
