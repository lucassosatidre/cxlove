import {
  LayoutDashboard, Phone, Utensils, Bike, CreditCard, Search, FileSpreadsheet,
  Receipt, Ticket, ShoppingBag, FileBarChart, Wallet, Sparkles, ShieldCheck, Settings,
} from "lucide-react";

export interface MenuItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  menuKey?: string;
  onlyView?: boolean;
  children?: MenuItem[];
}

export const allMenuItems: MenuItem[] = [
  {
    label: "Operação",
    icon: LayoutDashboard,
    children: [
      { label: "Painel", icon: LayoutDashboard, path: "/", menuKey: "dashboard", onlyView: true, children: [
        { label: "Controle de Caixa", icon: Wallet, menuKey: "dashboard.controle_caixa", onlyView: true },
        { label: "Abrir Caixa", icon: CreditCard, menuKey: "dashboard.abrir_caixa", onlyView: true },
      ] },
      { label: "Tele", icon: Phone, path: "/tele", menuKey: "op.tele", children: [
        { label: "Conciliação Delivery", icon: Bike, menuKey: "op.tele.conciliacao", onlyView: true },
      ] },
      { label: "Salão", icon: Utensils, path: "/salon", menuKey: "op.salao", children: [
        { label: "Conciliação Salão", icon: Utensils, menuKey: "op.salao.conciliacao", onlyView: true },
      ] },
      { label: "Entregadores", icon: Bike, path: "/admin/entregadores", menuKey: "op.entregadores" },
      { label: "Maquininhas", icon: CreditCard, path: "/admin/maquininhas", menuKey: "op.maquininhas" },
    ],
  },
  {
    label: "Auditoria de Taxas",
    icon: Search,
    children: [
      { label: "Importações", icon: FileSpreadsheet, path: "/admin/auditoria-v2/importacoes", menuKey: "audit.importacoes" },
      { label: "Maquinona", icon: Receipt, path: "/admin/auditoria-v2/maquinona", menuKey: "audit.maquinona" },
      { label: "Vouchers", icon: Ticket, path: "/admin/auditoria-v2/vouchers", menuKey: "audit.vouchers" },
      { label: "Brendi", icon: ShoppingBag, path: "/admin/auditoria-v2/brendi", menuKey: "audit.brendi" },
      { label: "iFood", icon: Utensils, path: "/admin/auditoria-v2/ifood-marketplace", menuKey: "audit.ifood" },
      { label: "Relatórios", icon: FileBarChart, path: "/admin/auditoria-v2/relatorios", menuKey: "audit.relatorios" },
    ],
  },
  {
    label: "Financeiro",
    icon: Wallet,
    children: [
      { label: "Fluxo de Caixa", icon: Wallet, path: "/admin/fluxo-caixa", menuKey: "fluxo_caixa" },
      { label: "Notas de Serviços", icon: Receipt, path: "/admin/notas-servicos", menuKey: "financeiro.nfse" },
    ],
  },
  {
    label: "Configurações",
    icon: Settings,
    children: [
      { label: "Usuários & Permissões", icon: ShieldCheck, path: "/users", menuKey: "config.usuarios" },
      { label: "Memória da Clau", icon: Sparkles, path: "/admin/clau/memoria", menuKey: "clau.memoria" },
    ],
  },
];

export const EXTRA_ROUTES: Record<string, string> = {
  "op.tele.import": "/import",
  "op.tele.tele_import": "/tele/import",
  "op.tele.pickngo": "/tele/pickngo",
  "op.tele.recon": "/reconciliation",
  "op.tele.recon_legacy": "/reconciliation-legacy",
  "op.tele.etiquetas": "/etiquetas",
  "op.salao.import": "/salon/import",
  "op.salao.closing": "/salon/closing",
};
