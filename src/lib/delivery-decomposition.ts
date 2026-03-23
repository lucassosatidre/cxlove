/**
 * Order payment decomposition for delivery reconciliation.
 * Classifies each order's value into: online, cash, machine-expected, structural.
 */

const ONLINE_KEYWORDS = [
  '(pago) online',
  'pago online',
  'pix online',
  'online ifood',
  'online - cartão',
  'anotaai',
];

const CASH_KEYWORDS = ['dinheiro'];

const VOUCHER_PARTNER_KEYWORDS = ['voucher parceiro desconto', 'voucher parceiro'];

function isOnlineMethod(method: string): boolean {
  const lower = method.toLowerCase().trim();
  return ONLINE_KEYWORDS.some(kw => lower.includes(kw));
}

function isCashMethod(method: string): boolean {
  const lower = method.toLowerCase().trim();
  return CASH_KEYWORDS.some(kw => lower === kw || lower.startsWith(kw));
}

function isVoucherPartner(method: string): boolean {
  const lower = method.toLowerCase().trim();
  return VOUCHER_PARTNER_KEYWORDS.some(kw => lower.includes(kw));
}

function isMachineMethod(method: string): boolean {
  return !isOnlineMethod(method) && !isCashMethod(method) && !isVoucherPartner(method);
}

export interface OrderDecomposition {
  totalAmount: number;
  onlineAmount: number;
  cashAmount: number;
  machineExpected: number;
  voucherPartnerAmount: number;
  isStructural: boolean;
  isFullyOnline: boolean;
  isFullyCash: boolean;
  category: 'online' | 'cash' | 'machine' | 'structural' | 'mixed';
  methods: string[];
}

interface DecompOrder {
  id: string;
  payment_method: string;
  total_amount: number;
}

interface DecompBreakdown {
  imported_order_id: string;
  payment_method_name: string;
  payment_type: string;
  amount: number;
}

export function decomposeOrder(order: DecompOrder, breakdowns: DecompBreakdown[]): OrderDecomposition {
  const bks = breakdowns.filter(b => b.imported_order_id === order.id);
  const methods = order.payment_method.split(',').map(m => m.trim()).filter(Boolean);

  let onlineAmount = 0;
  let cashAmount = 0;
  let machineExpected = 0;
  let voucherPartnerAmount = 0;
  let isStructural = false;

  if (bks.length > 0) {
    for (const b of bks) {
      if (isOnlineMethod(b.payment_method_name)) {
        onlineAmount += b.amount;
      } else if (isCashMethod(b.payment_method_name)) {
        cashAmount += b.amount;
      } else if (isVoucherPartner(b.payment_method_name)) {
        voucherPartnerAmount += b.amount;
        isStructural = true;
      } else {
        machineExpected += b.amount;
      }
    }
  } else {
    const hasVoucherPartner = methods.some(m => isVoucherPartner(m));
    const hasMachine = methods.some(m => isMachineMethod(m));

    if (hasVoucherPartner && hasMachine) {
      isStructural = true;
      // Can't determine split — mark full amount as structural
    } else if (hasVoucherPartner && !hasMachine) {
      // All voucher partner + maybe online/cash
      for (const m of methods) {
        if (isOnlineMethod(m)) onlineAmount += order.total_amount / methods.length;
        else if (isCashMethod(m)) cashAmount += order.total_amount / methods.length;
        else if (isVoucherPartner(m)) { voucherPartnerAmount += order.total_amount / methods.length; isStructural = true; }
      }
    } else {
      // No breakdowns, no voucher partner — classify by methods
      for (const m of methods) {
        const share = order.total_amount / methods.length;
        if (isOnlineMethod(m)) onlineAmount += share;
        else if (isCashMethod(m)) cashAmount += share;
        else machineExpected += share;
      }
    }
  }

  const isFullyOnline = onlineAmount > 0 && cashAmount === 0 && machineExpected === 0 && voucherPartnerAmount === 0 && !isStructural;
  const isFullyCash = cashAmount > 0 && onlineAmount === 0 && machineExpected === 0 && voucherPartnerAmount === 0 && !isStructural;

  let category: OrderDecomposition['category'] = 'machine';
  if (isStructural) category = 'structural';
  else if (isFullyOnline) category = 'online';
  else if (isFullyCash) category = 'cash';
  else if (onlineAmount > 0 || cashAmount > 0) category = 'mixed';

  return {
    totalAmount: order.total_amount,
    onlineAmount,
    cashAmount,
    machineExpected,
    voucherPartnerAmount,
    isStructural,
    isFullyOnline,
    isFullyCash,
    category,
    methods,
  };
}

export function getCategoryLabel(cat: OrderDecomposition['category']): string {
  switch (cat) {
    case 'online': return 'Online automático';
    case 'cash': return 'Dinheiro';
    case 'machine': return 'Maquininha';
    case 'structural': return 'Voucher Parceiro (estrutural)';
    case 'mixed': return 'Misto';
  }
}
