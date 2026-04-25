-- 1. Project memory (singleton per app)
CREATE TABLE IF NOT EXISTS public.clau_project_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_origin text NOT NULL DEFAULT 'cx-love',
  content text NOT NULL DEFAULT '',
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  CONSTRAINT one_memory_per_app UNIQUE (app_origin)
);

-- 2. Conversations
CREATE TABLE IF NOT EXISTS public.clau_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  app_origin text NOT NULL DEFAULT 'cx-love',
  title text,
  summary text,
  is_pinned boolean DEFAULT false,
  message_count integer DEFAULT 0,
  total_tokens_used integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clau_conv_user ON public.clau_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_clau_conv_pinned ON public.clau_conversations(user_id, is_pinned) WHERE is_pinned = true;

-- 3. Messages
CREATE TABLE IF NOT EXISTS public.clau_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.clau_conversations(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  context_snapshot jsonb,
  tokens_used integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clau_msg_conv ON public.clau_messages(conversation_id, created_at);

-- 4. RLS
ALTER TABLE public.clau_project_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clau_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clau_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_can_read_project_memory" ON public.clau_project_memory
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins_can_update_project_memory" ON public.clau_project_memory
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins_can_insert_project_memory" ON public.clau_project_memory
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "users_own_conversations" ON public.clau_conversations
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_own_messages" ON public.clau_messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.clau_conversations 
      WHERE id = clau_messages.conversation_id AND user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clau_conversations 
      WHERE id = clau_messages.conversation_id AND user_id = auth.uid()
    )
  );

-- 5. Seed memória padrão
INSERT INTO public.clau_project_memory (app_origin, content) VALUES (
  'cx-love',
  E'# Memória do Projeto Clau — CX Love\n\n## Sobre o usuário\n- Nome: Lucas\n- Empresa: Pizzaria Estrela da Ilha (Florianópolis/SC)\n- Função: dono e operador\n\n## Sobre o sistema\n- CX Love: app de gestão operacional (caixas, fechamentos, auditoria de taxas)\n- Stack: React + TS + Lovable Cloud (Supabase)\n- Integrações: Saipos POS, Maquinona iFood, Cresol, Banco do Brasil\n\n## Colegas relevantes\n- Lucas Menezes Alves (Lucas Menezes ADM): gerente, sector administrativo\n- Luana Tidre: financeiro/compras (tidreluana@gmail.com)\n\n## Contexto operacional\n- Pizzaria com tele-entrega + salão\n- Vouchers usados: Alelo, Ticket, Pluxee (Sodexo), VR\n- Bancos: Cresol (recebe iFood maquinona), BB (recebe vouchers)\n- Caixa fecha quase todo dia com divergência (~30-60 min pra investigar)\n\n## Como Lucas prefere conversar\n- Direto, sem bajulação\n- Sincero quando ideia não é boa\n- Avesso a tutoriais socráticos\n- Português brasileiro\n\n## Como atualizar essa memória\nLucas pode dizer "lembra disso" durante a conversa que vou registrar aqui.\nLucas também pode editar manualmente em /admin/clau/memoria.\n'
)
ON CONFLICT (app_origin) DO NOTHING;