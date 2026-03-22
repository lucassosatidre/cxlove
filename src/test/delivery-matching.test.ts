import { describe, expect, it } from 'vitest';

import { matchTransactionsToOrders } from '@/lib/delivery-matching';

describe('delivery matching strict method compatibility', () => {
  it('bloqueia match automático quando o valor é igual, mas o método é incompatível', () => {
    const matches = matchTransactionsToOrders(
      [
        {
          id: 'tx-debito',
          gross_amount: 157.49,
          payment_method: 'Debito',
          machine_serial: 'SERIAL-1',
          sale_time: '13:12:39',
        },
      ],
      [
        {
          id: 'order-credito',
          order_number: '2',
          payment_method: 'Crédito',
          total_amount: 157.49,
          delivery_person: 'A - Pickngo',
          sale_time: '12:39',
          is_confirmed: true,
        },
      ],
      new Set(),
      []
    );

    expect(matches).toHaveLength(0);
  });

  it('mantém match exato quando valor e método batem', () => {
    const matches = matchTransactionsToOrders(
      [
        {
          id: 'tx-debito',
          gross_amount: 77,
          payment_method: 'Debito',
          machine_serial: 'SERIAL-2',
          sale_time: '18:12:49',
        },
      ],
      [
        {
          id: 'order-debito',
          order_number: '46',
          payment_method: 'Débito',
          total_amount: 77,
          delivery_person: 'Luiz',
          sale_time: '18:10',
          is_confirmed: true,
        },
      ],
      new Set(),
      []
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ matchType: 'exact', confidence: 'high', orderId: 'order-debito' });
  });

  it('não força auto-match para Voucher Parceiro Desconto sem valor físico explícito', () => {
    const matches = matchTransactionsToOrders(
      [
        {
          id: 'tx-credito',
          gross_amount: 130.8,
          payment_method: 'Credito',
          machine_serial: 'SERIAL-3',
          sale_time: '22:41:32',
        },
      ],
      [
        {
          id: 'order-voucher',
          order_number: '223',
          payment_method: 'Crédito, Voucher Parceiro Desconto',
          total_amount: 130.8,
          delivery_person: 'Rodrigo',
          sale_time: '22:41',
          is_confirmed: true,
        },
      ],
      new Set(),
      []
    );

    expect(matches).toHaveLength(0);
  });
});