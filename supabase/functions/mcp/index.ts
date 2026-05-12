// @ts-nocheck
// OpenClaw MCP Server — read-only access to cxlove backend
// Streamable HTTP transport via mcp-lite + Hono
import { Hono } from "npm:hono@4";
import { McpServer, StreamableHttpTransport } from "npm:mcp-lite@^0.10.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const SERVER_VERSION = "1.0.0";
const DEPLOYED_AT = new Date().toISOString();
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const SOFT_WINDOW_DAYS = 90;
const HARD_WINDOW_DAYS = 400;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_TOKEN = Deno.env.get("OPENCLAW_MCP_TOKEN") || "";

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ---------------- Auth ----------------
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function checkAuth(req: Request): { ok: boolean; reason?: string } {
  if (!MCP_TOKEN) return { ok: false, reason: "server_token_missing" };
  const auth = req.headers.get("authorization") || "";
  const xtok = req.headers.get("x-mcp-token") || "";
  let token = "";
  if (auth.toLowerCase().startsWith("bearer ")) token = auth.slice(7).trim();
  else if (xtok) token = xtok.trim();
  if (!token) return { ok: false, reason: "missing_token" };
  return timingSafeEqual(token, MCP_TOKEN) ? { ok: true } : { ok: false, reason: "bad_token" };
}

// ---------------- Cursor (keyset) ----------------
function encodeCursor(obj: any): string {
  return btoa(JSON.stringify(obj));
}
function decodeCursor(s?: string | null): any | null {
  if (!s) return null;
  try { return JSON.parse(atob(s)); } catch { return null; }
}

// ---------------- Window validation ----------------
function defaultDateTo(date_from: string): string {
  const d = new Date(date_from + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 31);
  return d.toISOString().slice(0, 10);
}
function diffDays(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}
function validateWindow(date_from?: string, date_to?: string): {
  date_from?: string; date_to?: string; warning?: string; error?: string;
} {
  if (!date_from) return {};
  if (!date_to) date_to = defaultDateTo(date_from);
  const days = diffDays(date_from, date_to);
  if (days < 0) return { error: "date_to must be >= date_from" };
  if (days > HARD_WINDOW_DAYS) return { error: `window > ${HARD_WINDOW_DAYS} days not allowed` };
  let warning;
  if (days > SOFT_WINDOW_DAYS) warning = `large window: ${days} days (soft limit ${SOFT_WINDOW_DAYS})`;
  return { date_from, date_to, warning };
}

// ---------------- Logger ----------------
async function logCall(opts: {
  tool_name: string; tool_input: any; output_rows: number;
  output_bytes: number; duration_ms: number; error?: string | null;
}) {
  try {
    await sb.from("clau_tool_logs").insert({
      tool_name: opts.tool_name,
      tool_input: opts.tool_input,
      output_rows: opts.output_rows,
      output_bytes: opts.output_bytes,
      duration_ms: opts.duration_ms,
      error: opts.error ?? null,
      caller: "openclaw",
    });
  } catch (_) { /* swallow logger errors */ }
}

// ---------------- Generic table tool ----------------
// Each tool: optional date column for date_from/date_to, optional eq filters.
type ToolCfg = {
  table: string;
  dateCol?: string;             // e.g. 'sale_date', 'created_at'
  orderBy: { col: string; dir?: "asc" | "desc" }[]; // stable sort, last col must be 'id'
  filters: Record<string, { col?: string; op?: "eq" | "ilike" }>; // input -> column
  description: string;
  inputProperties?: Record<string, any>; // extra per-tool props
  inputRequired?: string[];
};

const TOOLS: Record<string, ToolCfg> = {
  // ===== CONCILIAÇÃO =====
  list_audit_periods: {
    table: "audit_periods",
    orderBy: [{ col: "year", dir: "desc" }, { col: "month", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { status: { col: "status" }, year: { col: "year" }, month: { col: "month" } },
    description: "Períodos de auditoria mensais. Filtros: status, year, month, ou date_from/date_to (mapeia para make_date(year,month,1)).",
    inputProperties: {
      year: { type: "integer", description: "Filtro direto por ano (atalho)" },
      month: { type: "integer", description: "Filtro direto por mês 1-12 (atalho)" },
      status: { type: "string", description: "draft | finalizado | reaberto" },
    },
  },
  list_audit_imports: {
    table: "audit_imports",
    dateCol: "created_at",
    orderBy: [{ col: "created_at", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { audit_period_id: { col: "audit_period_id" }, file_type: { col: "file_type" } },
    description: "Histórico de importações de arquivos por período de auditoria.",
    inputProperties: {
      audit_period_id: { type: "string", format: "uuid" },
      file_type: { type: "string", description: "cresol|bb|alelo|ticket|pluxee|vr|brendi|saipos|ifood_orders|ifood_conta_csv|ifood_extrato_detalhado" },
    },
  },
  list_audit_card_transactions: {
    table: "audit_card_transactions",
    dateCol: "sale_date",
    orderBy: [{ col: "sale_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: {
      audit_period_id: { col: "audit_period_id" },
      payment_method: { col: "payment_method" },
      brand: { col: "brand" },
      deposit_group: { col: "deposit_group" },
      is_competencia: { col: "is_competencia" },
    },
    description: "Vendas declaradas na maquininha (Maquinona) dentro de um período. date_col = sale_date.",
    inputProperties: {
      audit_period_id: { type: "string", format: "uuid" },
      payment_method: { type: "string" },
      brand: { type: "string" },
      deposit_group: { type: "string", description: "ifood | local" },
      is_competencia: { type: "boolean" },
    },
  },
  list_audit_voucher_lots: {
    table: "audit_voucher_lots",
    dateCol: "data_credito", // override below
    orderBy: [{ col: "data_credito", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { audit_period_id: { col: "audit_period_id" }, brand: { col: "brand" } },
    description: "Lotes de voucher (Alelo/Ticket/Pluxee/VR). competencia_field escolhe se filtra por data_credito (default) ou data_corte.",
    inputProperties: {
      audit_period_id: { type: "string", format: "uuid" },
      brand: { type: "string", description: "alelo | ticket | pluxee | vr" },
      competencia_field: { type: "string", enum: ["data_credito", "data_corte"], default: "data_credito" },
    },
  },
  list_audit_voucher_lot_items: {
    table: "audit_voucher_lot_items",
    dateCol: "data_transacao",
    orderBy: [{ col: "data_transacao", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { audit_period_id: { col: "audit_period_id" }, lot_id: { col: "lot_id" } },
    description: "Itens individuais de cada lote de voucher.",
    inputProperties: {
      audit_period_id: { type: "string", format: "uuid" },
      lot_id: { type: "string", format: "uuid" },
    },
  },
  list_audit_bank_deposits: {
    table: "audit_bank_deposits",
    dateCol: "deposit_date",
    orderBy: [{ col: "deposit_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: {
      audit_period_id: { col: "audit_period_id" },
      bank: { col: "bank" },
      category: { col: "category" },
      match_status: { col: "match_status" },
    },
    description: "Depósitos bancários (Cresol/BB) e seu status de match com competência.",
    inputProperties: {
      audit_period_id: { type: "string", format: "uuid" },
      bank: { type: "string", description: "cresol | bb" },
      category: { type: "string", description: "ifood | alelo | ticket | pluxee | vr" },
      match_status: { type: "string", description: "pending | matched | fora_periodo" },
    },
  },
  list_audit_daily_matches: {
    table: "audit_daily_matches",
    dateCol: "match_date",
    orderBy: [{ col: "match_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { audit_period_id: { col: "audit_period_id" } },
    description: "Resultados diários de matching (vendas vs depósitos) por período.",
    inputProperties: { audit_period_id: { type: "string", format: "uuid" } },
  },
  list_audit_brendi_orders: {
    table: "audit_brendi_orders",
    dateCol: "sale_date",
    orderBy: [{ col: "sale_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { audit_period_id: { col: "audit_period_id" }, import_id: { col: "import_id" } },
    description: "Pedidos Brendi importados para auditoria.",
    inputProperties: {
      audit_period_id: { type: "string", format: "uuid" },
      import_id: { type: "string", format: "uuid" },
    },
  },
  list_audit_saipos_orders: {
    table: "audit_saipos_orders",
    dateCol: "sale_date",
    orderBy: [{ col: "sale_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { audit_period_id: { col: "audit_period_id" }, import_id: { col: "import_id" } },
    description: "Pedidos Saipos consolidados para auditoria.",
    inputProperties: {
      audit_period_id: { type: "string", format: "uuid" },
      import_id: { type: "string", format: "uuid" },
    },
  },
  // get_audit_period_summary handled separately

  // ===== iFOOD =====
  list_audit_ifood_lancamentos: {
    table: "audit_ifood_lancamentos",
    dateCol: "data_repasse_esperada",
    orderBy: [{ col: "data_repasse_esperada", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { audit_period_id: { col: "audit_period_id" }, store_id_curto: { col: "store_id_curto" }, import_id: { col: "import_id" } },
    description: "Lançamentos do extrato detalhado iFood. date_col = data_repasse_esperada.",
    inputProperties: {
      audit_period_id: { type: "string", format: "uuid" },
      store_id_curto: { type: "string" },
      import_id: { type: "string", format: "uuid" },
    },
  },
  list_audit_ifood_conta_movimentos: {
    table: "audit_ifood_conta_movimentos",
    dateCol: "data",
    orderBy: [{ col: "data", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { audit_period_id: { col: "audit_period_id" }, import_id: { col: "import_id" } },
    description: "Movimentos da conta iFood (CSV).",
    inputProperties: {
      audit_period_id: { type: "string", format: "uuid" },
      import_id: { type: "string", format: "uuid" },
    },
  },
  list_audit_ifood_orders: {
    table: "audit_ifood_orders",
    dateCol: "data_pedido",
    orderBy: [{ col: "data_pedido", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { audit_period_id: { col: "audit_period_id" }, store_id: { col: "store_id" } },
    description: "Pedidos iFood (orders).",
    inputProperties: {
      audit_period_id: { type: "string", format: "uuid" },
      store_id: { type: "string" },
    },
  },
  list_audit_ifood_repasses: {
    table: "audit_ifood_repasses",
    dateCol: "data_repasse_esperada",
    orderBy: [{ col: "data_repasse_esperada", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { audit_period_id: { col: "audit_period_id" }, store_id_curto: { col: "store_id_curto" } },
    description: "Repasses iFood agregados por loja/data.",
    inputProperties: {
      audit_period_id: { type: "string", format: "uuid" },
      store_id_curto: { type: "string" },
    },
  },

  // ===== PEDIDOS =====
  list_imported_orders: {
    table: "imported_orders",
    dateCol: "sale_date",
    orderBy: [{ col: "sale_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: {
      daily_closing_id: { col: "daily_closing_id" },
      origin: { col: "origin" },
      payment_method: { col: "payment_method" },
    },
    description: "Pedidos importados (operação Tele/Delivery).",
    inputProperties: {
      daily_closing_id: { type: "string", format: "uuid" },
      origin: { type: "string" },
      payment_method: { type: "string" },
    },
  },
  list_order_payment_breakdowns: {
    table: "order_payment_breakdowns",
    dateCol: "created_at",
    orderBy: [{ col: "created_at", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { imported_order_id: { col: "imported_order_id" } },
    description: "Quebra de pagamento por pedido (split de métodos).",
    inputProperties: { imported_order_id: { type: "string", format: "uuid" } },
  },
  list_label_orders: {
    table: "label_orders",
    dateCol: "shift_date",
    orderBy: [{ col: "shift_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { shift_date: { col: "shift_date" }, status: { col: "status" } },
    description: "Etiquetas de pedidos impressas/persistidas.",
    inputProperties: { shift_date: { type: "string", format: "date" }, status: { type: "string" } },
  },
  list_imports: {
    table: "imports",
    dateCol: "created_at",
    orderBy: [{ col: "created_at", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { source: { col: "source" }, daily_closing_id: { col: "daily_closing_id" } },
    description: "Importações brutas (Excel/Saipos) anexadas a um fechamento.",
    inputProperties: {
      source: { type: "string" },
      daily_closing_id: { type: "string", format: "uuid" },
    },
  },
  list_sync_logs: {
    table: "sync_logs",
    dateCol: "executed_at",
    orderBy: [{ col: "executed_at", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { source: { col: "source" }, status: { col: "status" } },
    description: "Log de execuções de sync (Saipos etc).",
    inputProperties: { source: { type: "string" }, status: { type: "string" } },
  },

  // ===== SALÃO =====
  list_salon_closings: {
    table: "salon_closings",
    dateCol: "closing_date",
    orderBy: [{ col: "closing_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { status: { col: "status" } },
    description: "Fechamentos diários do Salão.",
    inputProperties: { status: { type: "string" } },
  },
  list_salon_orders: {
    table: "salon_orders",
    dateCol: "sale_date",
    orderBy: [{ col: "sale_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { salon_closing_id: { col: "salon_closing_id" }, waiter: { col: "waiter" } },
    description: "Pedidos do Salão (consolidados).",
    inputProperties: {
      salon_closing_id: { type: "string", format: "uuid" },
      waiter: { type: "string" },
    },
  },
  list_salon_card_transactions: {
    table: "salon_card_transactions",
    dateCol: "sale_date",
    orderBy: [{ col: "sale_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: {
      salon_closing_id: { col: "salon_closing_id" },
      payment_method: { col: "payment_method" },
      brand: { col: "brand" },
      machine_serial: { col: "machine_serial" },
    },
    description: "Transações de cartão do Salão.",
    inputProperties: {
      salon_closing_id: { type: "string", format: "uuid" },
      payment_method: { type: "string" },
      brand: { type: "string" },
      machine_serial: { type: "string" },
    },
  },
  list_salon_order_payments: {
    table: "salon_order_payments",
    dateCol: "created_at",
    orderBy: [{ col: "created_at", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { salon_order_id: { col: "salon_order_id" }, payment_method: { col: "payment_method" } },
    description: "Pagamentos individuais de pedidos do Salão.",
    inputProperties: {
      salon_order_id: { type: "string", format: "uuid" },
      payment_method: { type: "string" },
    },
  },
  list_salon_imports: {
    table: "salon_imports",
    dateCol: "created_at",
    orderBy: [{ col: "created_at", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { salon_closing_id: { col: "salon_closing_id" } },
    description: "Importações Excel do Salão.",
    inputProperties: { salon_closing_id: { type: "string", format: "uuid" } },
  },

  // ===== DELIVERY =====
  list_delivery_shifts: {
    table: "delivery_shifts",
    dateCol: "data",
    orderBy: [{ col: "data", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { data: { col: "data" } },
    description: "Turnos de entregadores (escalas).",
    inputProperties: { data: { type: "string", format: "date" } },
  },
  list_delivery_checkins: {
    table: "delivery_checkins",
    dateCol: "created_at",
    orderBy: [{ col: "created_at", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: {
      shift_id: { col: "shift_id" },
      driver_id: { col: "driver_id" },
      status: { col: "status" },
    },
    description: "Check-ins de entregadores em turnos.",
    inputProperties: {
      shift_id: { type: "string", format: "uuid" },
      driver_id: { type: "string", format: "uuid" },
      status: { type: "string" },
    },
  },
  list_delivery_drivers: {
    table: "delivery_drivers",
    dateCol: "created_at",
    orderBy: [{ col: "created_at", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { ativo: { col: "ativo" } },
    description: "Cadastro de entregadores.",
    inputProperties: { ativo: { type: "boolean" } },
  },

  // ===== CAIXA / DIVERSOS =====
  list_daily_closings: {
    table: "daily_closings",
    dateCol: "closing_date",
    orderBy: [{ col: "closing_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { status: { col: "status" }, operator_id: { col: "operator_id" } },
    description: "Fechamentos diários (operação Tele).",
    inputProperties: { status: { type: "string" }, operator_id: { type: "string", format: "uuid" } },
  },
  list_card_transactions: {
    table: "card_transactions",
    dateCol: "sale_date",
    orderBy: [{ col: "sale_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: {
      daily_closing_id: { col: "daily_closing_id" },
      machine_id: { col: "machine_id" },
      payment_method: { col: "payment_method" },
    },
    description: "Transações de cartão da operação (não-auditoria).",
    inputProperties: {
      daily_closing_id: { type: "string", format: "uuid" },
      machine_id: { type: "string" },
      payment_method: { type: "string" },
    },
  },
  list_cash_snapshots: {
    table: "cash_snapshots",
    dateCol: "created_at",
    orderBy: [{ col: "created_at", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { daily_closing_id: { col: "daily_closing_id" } },
    description: "Snapshots de contagem de caixa.",
    inputProperties: { daily_closing_id: { type: "string", format: "uuid" } },
  },
  list_cash_expectations: {
    table: "cash_expectations",
    dateCol: "closing_date",
    orderBy: [{ col: "closing_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { closing_date: { col: "closing_date" } },
    description: "Expectativa de caixa (esperado por dia).",
    inputProperties: { closing_date: { type: "string", format: "date" } },
  },
  list_vault_misc_expenses: {
    table: "vault_misc_expenses",
    dateCol: "expense_date",
    orderBy: [{ col: "expense_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: { category: { col: "category" } },
    description: "Despesas avulsas pagas pelo cofre.",
    inputProperties: { category: { type: "string" } },
  },
  list_machine_readings: {
    table: "machine_readings",
    dateCol: "created_at",
    orderBy: [{ col: "created_at", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: {
      daily_closing_id: { col: "daily_closing_id" },
      machine_serial: { col: "machine_serial" },
      delivery_person: { col: "delivery_person" },
    },
    description: "Leituras de maquininha por turno/entregador.",
    inputProperties: {
      daily_closing_id: { type: "string", format: "uuid" },
      machine_serial: { type: "string" },
      delivery_person: { type: "string" },
    },
  },
  list_vault_daily_closings: {
    table: "vault_daily_closings",
    dateCol: "closing_date",
    orderBy: [{ col: "closing_date", dir: "desc" }, { col: "id", dir: "desc" }],
    filters: {},
    description: "Fechamentos diários do cofre.",
  },
};

// ---------------- Build inputSchema for a tool ----------------
function buildInputSchema(cfg: ToolCfg) {
  const props: Record<string, any> = {
    date_from: { type: "string", format: "date", description: "YYYY-MM-DD (obrigatório se a tool tem date_col)" },
    date_to: { type: "string", format: "date", description: "YYYY-MM-DD (default: date_from + 31d). Janela > 90d é permitida até 400d (loga warning)." },
    limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
    cursor: { type: "string", description: "Opaque keyset cursor para próxima página" },
    ...(cfg.inputProperties || {}),
  };
  const required: string[] = [];
  if (cfg.dateCol) required.push("date_from");
  if (cfg.inputRequired) required.push(...cfg.inputRequired);
  return { type: "object", properties: props, required, additionalProperties: false };
}

// ---------------- Generic table query ----------------
async function runTableTool(toolName: string, cfg: ToolCfg, args: any) {
  const limit = Math.min(Math.max(parseInt(args.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  let warning: string | undefined;

  // window
  let date_from = args.date_from;
  let date_to = args.date_to;
  if (cfg.dateCol || toolName === "list_audit_periods") {
    const w = validateWindow(date_from, date_to);
    if (w.error) throw new Error(w.error);
    date_from = w.date_from;
    date_to = w.date_to;
    warning = w.warning;
  }

  // voucher_lots competencia_field override
  let dateCol = cfg.dateCol;
  let orderBy = cfg.orderBy;
  if (toolName === "list_audit_voucher_lots" && args.competencia_field === "data_corte") {
    dateCol = "data_corte";
    orderBy = [{ col: "data_corte", dir: "desc" }, { col: "id", dir: "desc" }];
  }

  let q = sb.from(cfg.table).select("*", { count: "exact" });

  // date filter
  if (toolName === "list_audit_periods") {
    // map year/month to date range OR use direct year/month filters
    if (args.year != null) q = q.eq("year", args.year);
    if (args.month != null) q = q.eq("month", args.month);
    if (date_from && args.year == null && args.month == null) {
      // make_date(year, month, 1) BETWEEN date_from AND date_to
      // Use SQL-side computed filter via .or() on (year,month) tuple
      const [yf, mf] = date_from.split("-").map((x: string) => parseInt(x));
      const [yt, mt] = date_to!.split("-").map((x: string) => parseInt(x));
      const fromKey = yf * 100 + mf;
      const toKey = yt * 100 + mt;
      // use OR clauses across years
      q = q.or(`and(year.gt.${yf},year.lt.${yt}),and(year.eq.${yf},month.gte.${mf}),and(year.eq.${yt},month.lte.${mt})`);
      // simpler: filter in JS after fetch is impossible at scale; rely on or() above
      // also handle same-year case
      if (yf === yt) {
        q = sb.from(cfg.table).select("*", { count: "exact" })
          .eq("year", yf).gte("month", mf).lte("month", mt);
      }
      // unused vars
      void fromKey; void toKey;
    }
  } else if (dateCol && date_from) {
    q = q.gte(dateCol, date_from).lte(dateCol, date_to + "T23:59:59.999Z");
  }

  // eq filters
  for (const [key, mapping] of Object.entries(cfg.filters)) {
    if (args[key] !== undefined && args[key] !== null) {
      q = q.eq(mapping.col || key, args[key]);
    }
  }

  // ordering
  for (const o of orderBy) {
    q = q.order(o.col, { ascending: (o.dir || "desc") === "asc" });
  }

  // keyset cursor
  const cur = decodeCursor(args.cursor);
  if (cur && cur.last_id != null) {
    if (dateCol && cur.last_ts) {
      // (date, id) < (last_ts, last_id) descending
      q = q.or(`${dateCol}.lt.${cur.last_ts},and(${dateCol}.eq.${cur.last_ts},id.lt.${cur.last_id})`);
    } else {
      q = q.lt("id", cur.last_id);
    }
  }

  q = q.limit(limit + 1); // fetch +1 to detect next page

  const { data, error, count } = await q;
  if (error) throw new Error(error.message);

  let rows = data || [];
  let hasMore = false;
  if (rows.length > limit) {
    hasMore = true;
    rows = rows.slice(0, limit);
  }

  // size truncation
  let bytes = 0;
  let truncated = false;
  const out: any[] = [];
  for (const r of rows) {
    const s = JSON.stringify(r);
    if (bytes + s.length > MAX_BYTES) { truncated = true; break; }
    bytes += s.length + 1;
    out.push(r);
  }

  let next_cursor: string | null = null;
  if (hasMore && out.length > 0) {
    const last = out[out.length - 1];
    next_cursor = encodeCursor({
      last_id: last.id,
      last_ts: dateCol ? last[dateCol] : undefined,
    });
  }

  return {
    rows: out,
    count: out.length,
    total: count ?? null,
    truncated,
    next_cursor,
    warning,
  };
}

// ---------------- Special tools ----------------
async function getAuditPeriodSummary(args: any) {
  if (!args.period_id) throw new Error("period_id required");
  const [totals, deposits] = await Promise.all([
    sb.rpc("get_audit_period_totals", { p_period_id: args.period_id }),
    sb.rpc("get_audit_period_deposits", { p_period_id: args.period_id }),
  ]);
  if (totals.error) throw new Error(totals.error.message);
  if (deposits.error) throw new Error(deposits.error.message);
  return {
    rows: [{ totals: totals.data?.[0] ?? null, deposits: deposits.data ?? [] }],
    count: 1,
    truncated: false,
    next_cursor: null,
  };
}

async function describeSchema(args: any) {
  const tables = args.tables as string[] | undefined;
  let q = sb.rpc("openclaw_run_sql_select", {
    p_sql: `
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema='public'
      ${tables && tables.length > 0
        ? `AND table_name IN (${tables.map(t => `'${t.replace(/'/g, "''")}'`).join(",")})`
        : ""}
      ORDER BY table_name, ordinal_position
    `,
  });
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data as any[]) || [];
  return { rows, count: rows.length, truncated: false, next_cursor: null };
}

let SCHEMA_HASH_CACHE: string | null = null;
async function computeSchemaHash(): Promise<string> {
  if (SCHEMA_HASH_CACHE) return SCHEMA_HASH_CACHE;
  try {
    const { data } = await sb.rpc("openclaw_run_sql_select", {
      p_sql: `
        SELECT table_name, string_agg(column_name, ',' ORDER BY ordinal_position) AS cols
        FROM information_schema.columns
        WHERE table_schema='public'
        GROUP BY table_name ORDER BY table_name
      `,
    });
    const text = ((data as any[]) || []).map((r: any) => `${r.table_name}|${r.cols}`).join("\n");
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    SCHEMA_HASH_CACHE = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    return SCHEMA_HASH_CACHE;
  } catch { return "unavailable"; }
}

async function runSqlSelect(args: any) {
  if (!args.sql || typeof args.sql !== "string") throw new Error("sql required");
  const { data, error } = await sb.rpc("openclaw_run_sql_select", { p_sql: args.sql });
  if (error) throw new Error(error.message);
  let rows = (data as any[]) || [];
  let bytes = 0;
  let truncated = false;
  const out: any[] = [];
  for (const r of rows) {
    const s = JSON.stringify(r);
    if (bytes + s.length > MAX_BYTES) { truncated = true; break; }
    bytes += s.length + 1;
    out.push(r);
  }
  return { rows: out, count: out.length, truncated, next_cursor: null };
}

// ---------------- MCP server ----------------
const mcp = new McpServer({ name: "openclaw-cxlove-mcp", version: SERVER_VERSION });

// register all table tools
for (const [name, cfg] of Object.entries(TOOLS)) {
  mcp.tool({
    name,
    description: cfg.description,
    inputSchema: buildInputSchema(cfg),
    handler: async (args: any) => {
      const t0 = Date.now();
      let payload: any;
      let err: string | null = null;
      try {
        payload = await runTableTool(name, cfg, args || {});
      } catch (e: any) {
        err = e?.message || String(e);
        payload = { error: err };
      }
      const took_ms = Date.now() - t0;
      const text = JSON.stringify({ ...payload, took_ms });
      await logCall({
        tool_name: name, tool_input: args || {},
        output_rows: payload?.count ?? 0,
        output_bytes: text.length,
        duration_ms: took_ms, error: err,
      });
      return { content: [{ type: "text", text }] };
    },
  });
}

mcp.tool({
  name: "get_audit_period_summary",
  description: "Resumo agregado de um período de auditoria (totais + depósitos). Combina get_audit_period_totals + get_audit_period_deposits.",
  inputSchema: {
    type: "object",
    properties: { period_id: { type: "string", format: "uuid" } },
    required: ["period_id"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const t0 = Date.now();
    let payload: any; let err: string | null = null;
    try { payload = await getAuditPeriodSummary(args || {}); }
    catch (e: any) { err = e?.message || String(e); payload = { error: err }; }
    const took_ms = Date.now() - t0;
    const text = JSON.stringify({ ...payload, took_ms });
    await logCall({ tool_name: "get_audit_period_summary", tool_input: args || {}, output_rows: payload?.count ?? 0, output_bytes: text.length, duration_ms: took_ms, error: err });
    return { content: [{ type: "text", text }] };
  },
});

mcp.tool({
  name: "describe_schema",
  description: "Retorna colunas (tipo, nullable) das tabelas do schema public. Filtro opcional 'tables' (array de nomes).",
  inputSchema: {
    type: "object",
    properties: { tables: { type: "array", items: { type: "string" } } },
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const t0 = Date.now();
    let payload: any; let err: string | null = null;
    try { payload = await describeSchema(args || {}); }
    catch (e: any) { err = e?.message || String(e); payload = { error: err }; }
    const took_ms = Date.now() - t0;
    const text = JSON.stringify({ ...payload, took_ms });
    await logCall({ tool_name: "describe_schema", tool_input: args || {}, output_rows: payload?.count ?? 0, output_bytes: text.length, duration_ms: took_ms, error: err });
    return { content: [{ type: "text", text }] };
  },
});

mcp.tool({
  name: "get_server_info",
  description: "Versão do servidor MCP, timestamp do deploy e hash do schema atual.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  handler: async () => {
    const schema_hash = await computeSchemaHash();
    const text = JSON.stringify({
      name: "openclaw-cxlove-mcp",
      version: SERVER_VERSION,
      deployed_at: DEPLOYED_AT,
      schema_hash,
      tool_count: Object.keys(TOOLS).length + 4,
    });
    return { content: [{ type: "text", text }] };
  },
});

mcp.tool({
  name: "run_sql_select",
  description: "Executa SELECT/WITH read-only no schema public via role openclaw_readonly (timeout 10s, limite 10MB). Sem janela máxima — só o limit/time-out seguram. Use describe_schema para descobrir colunas.",
  inputSchema: {
    type: "object",
    properties: { sql: { type: "string", description: "SELECT ou WITH ... SELECT (1 statement)" } },
    required: ["sql"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const t0 = Date.now();
    let payload: any; let err: string | null = null;
    try { payload = await runSqlSelect(args || {}); }
    catch (e: any) { err = e?.message || String(e); payload = { error: err }; }
    const took_ms = Date.now() - t0;
    const text = JSON.stringify({ ...payload, took_ms });
    await logCall({ tool_name: "run_sql_select", tool_input: { sql: (args?.sql || "").slice(0, 500) }, output_rows: payload?.count ?? 0, output_bytes: text.length, duration_ms: took_ms, error: err });
    return { content: [{ type: "text", text }] };
  },
});

// ---------------- HTTP server ----------------
const transport = new StreamableHttpTransport();
const app = new Hono();

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-mcp-token, x-client-info, apikey, accept, mcp-session-id",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-expose-headers": "mcp-session-id",
};

app.options("/*", (c) => new Response(null, { headers: corsHeaders }));

app.all("/*", async (c) => {
  const auth = checkAuth(c.req.raw);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "unauthorized", reason: auth.reason }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="mcp"',
        ...corsHeaders,
      },
    });
  }
  const resp = await transport.handleRequest(c.req.raw, mcp);
  // attach CORS to response
  const newHeaders = new Headers(resp.headers);
  for (const [k, v] of Object.entries(corsHeaders)) newHeaders.set(k, v);
  return new Response(resp.body, { status: resp.status, headers: newHeaders });
});

Deno.serve(app.fetch);
