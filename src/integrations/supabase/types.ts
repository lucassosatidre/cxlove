export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      audit_bank_deposits: {
        Row: {
          amount: number
          audit_period_id: string
          auto_categorized: boolean
          bank: string
          category: string | null
          created_at: string
          deposit_date: string
          description: string | null
          detail: string | null
          doc_number: string | null
          id: string
          import_id: string | null
          match_confidence: number | null
          match_reason: string | null
          match_status: string
          matched: boolean
          matched_adjacente_amount: number | null
          matched_competencia_amount: number | null
          row_hash: string | null
        }
        Insert: {
          amount: number
          audit_period_id: string
          auto_categorized?: boolean
          bank: string
          category?: string | null
          created_at?: string
          deposit_date: string
          description?: string | null
          detail?: string | null
          doc_number?: string | null
          id?: string
          import_id?: string | null
          match_confidence?: number | null
          match_reason?: string | null
          match_status?: string
          matched?: boolean
          matched_adjacente_amount?: number | null
          matched_competencia_amount?: number | null
          row_hash?: string | null
        }
        Update: {
          amount?: number
          audit_period_id?: string
          auto_categorized?: boolean
          bank?: string
          category?: string | null
          created_at?: string
          deposit_date?: string
          description?: string | null
          detail?: string | null
          doc_number?: string | null
          id?: string
          import_id?: string | null
          match_confidence?: number | null
          match_reason?: string | null
          match_status?: string
          matched?: boolean
          matched_adjacente_amount?: number | null
          matched_competencia_amount?: number | null
          row_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_bank_deposits_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_bank_deposits_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "audit_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_brendi_daily: {
        Row: {
          audit_period_id: string
          bb_credit_date: string | null
          bb_deposit_ids: string[] | null
          created_at: string
          cumulative_diff: number
          cumulative_diff_pct: number
          diff: number
          diff_pct: number
          expected_amount: number
          expected_credit_date: string | null
          expected_liquido: number
          id: string
          note: string | null
          pedidos_count: number
          received_amount: number
          sale_date: string
          sale_dates: string[]
          status: string
          taxa_calculada: number
          updated_at: string
        }
        Insert: {
          audit_period_id: string
          bb_credit_date?: string | null
          bb_deposit_ids?: string[] | null
          created_at?: string
          cumulative_diff?: number
          cumulative_diff_pct?: number
          diff?: number
          diff_pct?: number
          expected_amount?: number
          expected_credit_date?: string | null
          expected_liquido?: number
          id?: string
          note?: string | null
          pedidos_count?: number
          received_amount?: number
          sale_date: string
          sale_dates?: string[]
          status?: string
          taxa_calculada?: number
          updated_at?: string
        }
        Update: {
          audit_period_id?: string
          bb_credit_date?: string | null
          bb_deposit_ids?: string[] | null
          created_at?: string
          cumulative_diff?: number
          cumulative_diff_pct?: number
          diff?: number
          diff_pct?: number
          expected_amount?: number
          expected_credit_date?: string | null
          expected_liquido?: number
          id?: string
          note?: string | null
          pedidos_count?: number
          received_amount?: number
          sale_date?: string
          sale_dates?: string[]
          status?: string
          taxa_calculada?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_brendi_daily_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_brendi_daily_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          daily_id: string
          id: string
          motivo: string
          note: string | null
          valor_ajuste: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          daily_id: string
          id?: string
          motivo: string
          note?: string | null
          valor_ajuste: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          daily_id?: string
          id?: string
          motivo?: string
          note?: string | null
          valor_ajuste?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_brendi_daily_overrides_daily_id_fkey"
            columns: ["daily_id"]
            isOneToOne: false
            referencedRelation: "audit_brendi_daily"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_brendi_orders: {
        Row: {
          audit_period_id: string
          cashback_usado: number | null
          cliente_nome: string | null
          cliente_telefone: string | null
          created_at: string
          created_at_remote: string
          cupom: boolean | null
          desconto_entrega: number | null
          endereco: string | null
          forma_pagamento: string
          id: string
          import_id: string | null
          order_id: string
          payment_method: string | null
          sale_date: string
          status_remote: string | null
          taxa_entrega: number | null
          total: number
        }
        Insert: {
          audit_period_id: string
          cashback_usado?: number | null
          cliente_nome?: string | null
          cliente_telefone?: string | null
          created_at?: string
          created_at_remote: string
          cupom?: boolean | null
          desconto_entrega?: number | null
          endereco?: string | null
          forma_pagamento: string
          id?: string
          import_id?: string | null
          order_id: string
          payment_method?: string | null
          sale_date: string
          status_remote?: string | null
          taxa_entrega?: number | null
          total: number
        }
        Update: {
          audit_period_id?: string
          cashback_usado?: number | null
          cliente_nome?: string | null
          cliente_telefone?: string | null
          created_at?: string
          created_at_remote?: string
          cupom?: boolean | null
          desconto_entrega?: number | null
          endereco?: string | null
          forma_pagamento?: string
          id?: string
          import_id?: string | null
          order_id?: string
          payment_method?: string | null
          sale_date?: string
          status_remote?: string | null
          taxa_entrega?: number | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_brendi_orders_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_brendi_orders_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "audit_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_card_transactions: {
        Row: {
          audit_period_id: string
          brand: string | null
          created_at: string
          deposit_group: string | null
          expected_deposit_date: string | null
          gross_amount: number
          id: string
          incentivo_ifood: number
          is_competencia: boolean
          machine_serial: string | null
          matched: boolean
          net_amount: number
          nsu: string | null
          payment_method: string
          promotion_amount: number | null
          sale_date: string
          sale_time: string | null
          tax_amount: number
          tax_rate: number | null
          transaction_id: string
        }
        Insert: {
          audit_period_id: string
          brand?: string | null
          created_at?: string
          deposit_group?: string | null
          expected_deposit_date?: string | null
          gross_amount: number
          id?: string
          incentivo_ifood?: number
          is_competencia?: boolean
          machine_serial?: string | null
          matched?: boolean
          net_amount: number
          nsu?: string | null
          payment_method: string
          promotion_amount?: number | null
          sale_date: string
          sale_time?: string | null
          tax_amount?: number
          tax_rate?: number | null
          transaction_id: string
        }
        Update: {
          audit_period_id?: string
          brand?: string | null
          created_at?: string
          deposit_group?: string | null
          expected_deposit_date?: string | null
          gross_amount?: number
          id?: string
          incentivo_ifood?: number
          is_competencia?: boolean
          machine_serial?: string | null
          matched?: boolean
          net_amount?: number
          nsu?: string | null
          payment_method?: string
          promotion_amount?: number | null
          sale_date?: string
          sale_time?: string | null
          tax_amount?: number
          tax_rate?: number | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_card_transactions_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_daily_matches: {
        Row: {
          audit_period_id: string
          created_at: string
          deposit_count: number
          deposited_amount: number
          difference: number
          expected_amount: number
          id: string
          match_date: string
          status: string
          transaction_count: number
        }
        Insert: {
          audit_period_id: string
          created_at?: string
          deposit_count?: number
          deposited_amount?: number
          difference?: number
          expected_amount?: number
          id?: string
          match_date: string
          status?: string
          transaction_count?: number
        }
        Update: {
          audit_period_id?: string
          created_at?: string
          deposit_count?: number
          deposited_amount?: number
          difference?: number
          expected_amount?: number
          id?: string
          match_date?: string
          status?: string
          transaction_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_daily_matches_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_ifood_conta_movimentos: {
        Row: {
          audit_period_id: string
          categoria: string
          categoria_csv: string
          created_at: string
          csv_idx: number
          data: string
          descricao: string
          id: string
          import_id: string | null
          match_repasse_ids: string[] | null
          status: string
          valor: number
        }
        Insert: {
          audit_period_id: string
          categoria: string
          categoria_csv: string
          created_at?: string
          csv_idx: number
          data: string
          descricao: string
          id?: string
          import_id?: string | null
          match_repasse_ids?: string[] | null
          status?: string
          valor: number
        }
        Update: {
          audit_period_id?: string
          categoria?: string
          categoria_csv?: string
          created_at?: string
          csv_idx?: number
          data?: string
          descricao?: string
          id?: string
          import_id?: string | null
          match_repasse_ids?: string[] | null
          status?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_ifood_conta_movimentos_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_ifood_conta_movimentos_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "audit_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_ifood_daily_sales: {
        Row: {
          audit_period_id: string
          bruto_venda: number
          id: string
          loja_id_curto: string
          pedidos_count: number
          sale_date: string
        }
        Insert: {
          audit_period_id: string
          bruto_venda?: number
          id?: string
          loja_id_curto: string
          pedidos_count?: number
          sale_date: string
        }
        Update: {
          audit_period_id?: string
          bruto_venda?: number
          id?: string
          loja_id_curto?: string
          pedidos_count?: number
          sale_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_ifood_daily_sales_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_ifood_lancamentos: {
        Row: {
          audit_period_id: string
          bandeira_pagamento: string | null
          base_calculo: number | null
          canal_vendas: string | null
          categoria_calc: string
          cnpj: string | null
          competencia: string | null
          created_at: string
          data_apuracao_fim: string | null
          data_apuracao_inicio: string | null
          data_criacao_pedido_associado: string | null
          data_faturamento: string | null
          data_repasse_esperada: string | null
          descricao_lancamento: string | null
          descricao_ocorrencia: string | null
          fato_gerador: string | null
          id: string
          id_saldo: string | null
          idx_arquivo: number
          impacto_no_repasse: string | null
          import_id: string | null
          loja_id: string | null
          loja_id_curto: string | null
          metodo_pagamento: string | null
          motivo_cancelamento: string | null
          pedido_associado_ifood: string | null
          pedido_associado_ifood_curto: string | null
          pedido_detalhes: string | null
          percentual_taxa: number | null
          responsavel_transacao: string | null
          store_id_curto: string
          tipo_lancamento: string | null
          valor: number | null
          valor_cesta_final: number | null
          valor_transacao: number | null
        }
        Insert: {
          audit_period_id: string
          bandeira_pagamento?: string | null
          base_calculo?: number | null
          canal_vendas?: string | null
          categoria_calc: string
          cnpj?: string | null
          competencia?: string | null
          created_at?: string
          data_apuracao_fim?: string | null
          data_apuracao_inicio?: string | null
          data_criacao_pedido_associado?: string | null
          data_faturamento?: string | null
          data_repasse_esperada?: string | null
          descricao_lancamento?: string | null
          descricao_ocorrencia?: string | null
          fato_gerador?: string | null
          id?: string
          id_saldo?: string | null
          idx_arquivo: number
          impacto_no_repasse?: string | null
          import_id?: string | null
          loja_id?: string | null
          loja_id_curto?: string | null
          metodo_pagamento?: string | null
          motivo_cancelamento?: string | null
          pedido_associado_ifood?: string | null
          pedido_associado_ifood_curto?: string | null
          pedido_detalhes?: string | null
          percentual_taxa?: number | null
          responsavel_transacao?: string | null
          store_id_curto: string
          tipo_lancamento?: string | null
          valor?: number | null
          valor_cesta_final?: number | null
          valor_transacao?: number | null
        }
        Update: {
          audit_period_id?: string
          bandeira_pagamento?: string | null
          base_calculo?: number | null
          canal_vendas?: string | null
          categoria_calc?: string
          cnpj?: string | null
          competencia?: string | null
          created_at?: string
          data_apuracao_fim?: string | null
          data_apuracao_inicio?: string | null
          data_criacao_pedido_associado?: string | null
          data_faturamento?: string | null
          data_repasse_esperada?: string | null
          descricao_lancamento?: string | null
          descricao_ocorrencia?: string | null
          fato_gerador?: string | null
          id?: string
          id_saldo?: string | null
          idx_arquivo?: number
          impacto_no_repasse?: string | null
          import_id?: string | null
          loja_id?: string | null
          loja_id_curto?: string | null
          metodo_pagamento?: string | null
          motivo_cancelamento?: string | null
          pedido_associado_ifood?: string | null
          pedido_associado_ifood_curto?: string | null
          pedido_detalhes?: string | null
          percentual_taxa?: number | null
          responsavel_transacao?: string | null
          store_id_curto?: string
          tipo_lancamento?: string | null
          valor?: number | null
          valor_cesta_final?: number | null
          valor_transacao?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_ifood_lancamentos_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_ifood_lancamentos_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "audit_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_ifood_orders: {
        Row: {
          audit_period_id: string
          canal_venda: string | null
          created_at: string
          data_pedido: string
          forma_pagamento: string | null
          id: string
          import_id: string | null
          incentivo_ifood: number | null
          incentivo_loja: number | null
          incentivo_rede: number | null
          order_id: string
          produto_logistico: string | null
          sale_date: string
          short_order_id: string | null
          status_pedido: string
          store_id_curto: string | null
          taxa_entrega_cliente: number | null
          taxa_servico: number | null
          taxas_comissoes: number | null
          tipo_entrega: string | null
          total_pago_cliente: number
          turno: string | null
          valor_itens: number | null
          valor_liquido: number
        }
        Insert: {
          audit_period_id: string
          canal_venda?: string | null
          created_at?: string
          data_pedido: string
          forma_pagamento?: string | null
          id?: string
          import_id?: string | null
          incentivo_ifood?: number | null
          incentivo_loja?: number | null
          incentivo_rede?: number | null
          order_id: string
          produto_logistico?: string | null
          sale_date: string
          short_order_id?: string | null
          status_pedido: string
          store_id_curto?: string | null
          taxa_entrega_cliente?: number | null
          taxa_servico?: number | null
          taxas_comissoes?: number | null
          tipo_entrega?: string | null
          total_pago_cliente: number
          turno?: string | null
          valor_itens?: number | null
          valor_liquido: number
        }
        Update: {
          audit_period_id?: string
          canal_venda?: string | null
          created_at?: string
          data_pedido?: string
          forma_pagamento?: string | null
          id?: string
          import_id?: string | null
          incentivo_ifood?: number | null
          incentivo_loja?: number | null
          incentivo_rede?: number | null
          order_id?: string
          produto_logistico?: string | null
          sale_date?: string
          short_order_id?: string | null
          status_pedido?: string
          store_id_curto?: string | null
          taxa_entrega_cliente?: number | null
          taxa_servico?: number | null
          taxas_comissoes?: number | null
          tipo_entrega?: string | null
          total_pago_cliente?: number
          turno?: string | null
          valor_itens?: number | null
          valor_liquido?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_ifood_marketplace_orders_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_ifood_marketplace_orders_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "audit_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_ifood_repasses: {
        Row: {
          ads: number | null
          audit_period_id: string
          bruto_venda: number | null
          cancel_frete: number | null
          cancel_parcial: number | null
          cancel_total: number | null
          comissao: number | null
          conta_data_recebimento: string | null
          conta_movimento_id: string | null
          conta_recebido: number | null
          conta_taxa_antecip: number | null
          created_at: string
          data_repasse_esperada: string
          diff: number | null
          frete_ifood: number | null
          frota_garantida: number
          id: string
          liquido_efetivo: number | null
          liquido_esperado: number | null
          mensalidade: number | null
          note: string | null
          ocor_venda: number | null
          outros: number | null
          periodo_apuracao_fim: string | null
          periodo_apuracao_inicio: string | null
          pgto_direto_loja: number | null
          promo_ifood: number | null
          promo_loja: number | null
          reembolsos: number | null
          ressarc: number | null
          status: string
          store_id_curto: string
          taxa_conveniencia: number | null
          taxa_entrega_ret: number | null
          taxa_servico_cliente: number | null
          taxa_servico_sob_demanda: number | null
          taxa_transacao: number | null
          updated_at: string
        }
        Insert: {
          ads?: number | null
          audit_period_id: string
          bruto_venda?: number | null
          cancel_frete?: number | null
          cancel_parcial?: number | null
          cancel_total?: number | null
          comissao?: number | null
          conta_data_recebimento?: string | null
          conta_movimento_id?: string | null
          conta_recebido?: number | null
          conta_taxa_antecip?: number | null
          created_at?: string
          data_repasse_esperada: string
          diff?: number | null
          frete_ifood?: number | null
          frota_garantida?: number
          id?: string
          liquido_efetivo?: number | null
          liquido_esperado?: number | null
          mensalidade?: number | null
          note?: string | null
          ocor_venda?: number | null
          outros?: number | null
          periodo_apuracao_fim?: string | null
          periodo_apuracao_inicio?: string | null
          pgto_direto_loja?: number | null
          promo_ifood?: number | null
          promo_loja?: number | null
          reembolsos?: number | null
          ressarc?: number | null
          status?: string
          store_id_curto: string
          taxa_conveniencia?: number | null
          taxa_entrega_ret?: number | null
          taxa_servico_cliente?: number | null
          taxa_servico_sob_demanda?: number | null
          taxa_transacao?: number | null
          updated_at?: string
        }
        Update: {
          ads?: number | null
          audit_period_id?: string
          bruto_venda?: number | null
          cancel_frete?: number | null
          cancel_parcial?: number | null
          cancel_total?: number | null
          comissao?: number | null
          conta_data_recebimento?: string | null
          conta_movimento_id?: string | null
          conta_recebido?: number | null
          conta_taxa_antecip?: number | null
          created_at?: string
          data_repasse_esperada?: string
          diff?: number | null
          frete_ifood?: number | null
          frota_garantida?: number
          id?: string
          liquido_efetivo?: number | null
          liquido_esperado?: number | null
          mensalidade?: number | null
          note?: string | null
          ocor_venda?: number | null
          outros?: number | null
          periodo_apuracao_fim?: string | null
          periodo_apuracao_inicio?: string | null
          pgto_direto_loja?: number | null
          promo_ifood?: number | null
          promo_loja?: number | null
          reembolsos?: number | null
          ressarc?: number | null
          status?: string
          store_id_curto?: string
          taxa_conveniencia?: number | null
          taxa_entrega_ret?: number | null
          taxa_servico_cliente?: number | null
          taxa_servico_sob_demanda?: number | null
          taxa_transacao?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_ifood_repasses_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_imports: {
        Row: {
          audit_period_id: string
          created_at: string
          created_by: string | null
          duplicate_rows: number
          error_message: string | null
          file_name: string
          file_type: string
          id: string
          imported_rows: number
          status: string
          total_rows: number
        }
        Insert: {
          audit_period_id: string
          created_at?: string
          created_by?: string | null
          duplicate_rows?: number
          error_message?: string | null
          file_name: string
          file_type: string
          id?: string
          imported_rows?: number
          status?: string
          total_rows?: number
        }
        Update: {
          audit_period_id?: string
          created_at?: string
          created_by?: string | null
          duplicate_rows?: number
          error_message?: string | null
          file_name?: string
          file_type?: string
          id?: string
          imported_rows?: number
          status?: string
          total_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_imports_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_lot_overrides: {
        Row: {
          audit_period_id: string
          created_at: string
          created_by: string | null
          cresol_deposit_id: string | null
          id: string
          note: string | null
          sale_date: string
          tipo: string
          updated_at: string
        }
        Insert: {
          audit_period_id: string
          created_at?: string
          created_by?: string | null
          cresol_deposit_id?: string | null
          id?: string
          note?: string | null
          sale_date: string
          tipo: string
          updated_at?: string
        }
        Update: {
          audit_period_id?: string
          created_at?: string
          created_by?: string | null
          cresol_deposit_id?: string | null
          id?: string
          note?: string | null
          sale_date?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_lot_overrides_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_lot_overrides_cresol_deposit_id_fkey"
            columns: ["cresol_deposit_id"]
            isOneToOne: false
            referencedRelation: "audit_bank_deposits"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_period_log: {
        Row: {
          action: string
          audit_period_id: string
          created_at: string
          id: string
          reason: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          audit_period_id: string
          created_at?: string
          id?: string
          reason?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          audit_period_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_period_log_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closed_snapshot: Json | null
          created_at: string
          created_by: string | null
          id: string
          maquinona_crm_cashback_total: number | null
          maquinona_crm_cupom_total: number | null
          maquinona_incentivo_total: number | null
          maquinona_promo_total: number | null
          month: number
          status: string
          updated_at: string
          year: number
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closed_snapshot?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          maquinona_crm_cashback_total?: number | null
          maquinona_crm_cupom_total?: number | null
          maquinona_incentivo_total?: number | null
          maquinona_promo_total?: number | null
          month: number
          status?: string
          updated_at?: string
          year: number
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closed_snapshot?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          maquinona_crm_cashback_total?: number | null
          maquinona_crm_cupom_total?: number | null
          maquinona_incentivo_total?: number | null
          maquinona_promo_total?: number | null
          month?: number
          status?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      audit_saipos_orders: {
        Row: {
          acrescimo: number | null
          audit_period_id: string
          bairro: string | null
          canal_venda: string
          cancelado: boolean
          cep: string | null
          consumidor: string | null
          created_at: string
          data_venda: string
          desconto: number | null
          entrega: number | null
          entregador: string | null
          id: string
          import_id: string | null
          itens: string | null
          motivo_acrescimo: string | null
          motivo_cancelamento: string | null
          motivo_desconto: string | null
          order_id_parceiro: string
          pagamento: string
          saipos_pedido: number | null
          saipos_pedido_parceiro_num: string | null
          sale_date: string
          tipo_pedido: string | null
          total: number
          total_taxa_servico: number | null
          turno: string | null
          valor_entregador: number | null
        }
        Insert: {
          acrescimo?: number | null
          audit_period_id: string
          bairro?: string | null
          canal_venda: string
          cancelado?: boolean
          cep?: string | null
          consumidor?: string | null
          created_at?: string
          data_venda: string
          desconto?: number | null
          entrega?: number | null
          entregador?: string | null
          id?: string
          import_id?: string | null
          itens?: string | null
          motivo_acrescimo?: string | null
          motivo_cancelamento?: string | null
          motivo_desconto?: string | null
          order_id_parceiro: string
          pagamento: string
          saipos_pedido?: number | null
          saipos_pedido_parceiro_num?: string | null
          sale_date: string
          tipo_pedido?: string | null
          total: number
          total_taxa_servico?: number | null
          turno?: string | null
          valor_entregador?: number | null
        }
        Update: {
          acrescimo?: number | null
          audit_period_id?: string
          bairro?: string | null
          canal_venda?: string
          cancelado?: boolean
          cep?: string | null
          consumidor?: string | null
          created_at?: string
          data_venda?: string
          desconto?: number | null
          entrega?: number | null
          entregador?: string | null
          id?: string
          import_id?: string | null
          itens?: string | null
          motivo_acrescimo?: string | null
          motivo_cancelamento?: string | null
          motivo_desconto?: string | null
          order_id_parceiro?: string
          pagamento?: string
          saipos_pedido?: number | null
          saipos_pedido_parceiro_num?: string | null
          sale_date?: string
          tipo_pedido?: string | null
          total?: number
          total_taxa_servico?: number | null
          turno?: string | null
          valor_entregador?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_saipos_orders_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_saipos_orders_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "audit_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_voucher_lot_competencia_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          lot_id: string
          month: number
          note: string | null
          taxa_competencia: number
          updated_at: string
          updated_by: string | null
          year: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          lot_id: string
          month: number
          note?: string | null
          taxa_competencia: number
          updated_at?: string
          updated_by?: string | null
          year: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          lot_id?: string
          month?: number
          note?: string | null
          taxa_competencia?: number
          updated_at?: string
          updated_by?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_voucher_lot_competencia_overrides_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "audit_voucher_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_voucher_lot_items: {
        Row: {
          cnpj: string | null
          created_at: string
          data_postagem: string | null
          data_transacao: string
          estabelecimento: string | null
          id: string
          lot_id: string
          numero_cartao_mascarado: string | null
          numero_documento: string | null
          status_remote: string | null
          valor: number
        }
        Insert: {
          cnpj?: string | null
          created_at?: string
          data_postagem?: string | null
          data_transacao: string
          estabelecimento?: string | null
          id?: string
          lot_id: string
          numero_cartao_mascarado?: string | null
          numero_documento?: string | null
          status_remote?: string | null
          valor: number
        }
        Update: {
          cnpj?: string | null
          created_at?: string
          data_postagem?: string | null
          data_transacao?: string
          estabelecimento?: string | null
          id?: string
          lot_id?: string
          numero_cartao_mascarado?: string | null
          numero_documento?: string | null
          status_remote?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_voucher_lot_items_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "audit_voucher_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_voucher_lots: {
        Row: {
          audit_period_id: string
          banco_credito: string | null
          bb_deposit_id: string | null
          bb_deposit_id_2: string | null
          created_at: string
          data_corte: string | null
          data_credito: string
          data_transacao_bb: string | null
          descontos: Json | null
          diff: number | null
          id: string
          import_id: string | null
          manual: boolean
          match_reason: string | null
          numero_contrato: string | null
          numero_reembolso: string
          operadora: string
          produto: string | null
          status: string
          subtotal_vendas: number
          total_descontos: number
          valor_creditado_bb: number | null
          valor_liquido: number
        }
        Insert: {
          audit_period_id: string
          banco_credito?: string | null
          bb_deposit_id?: string | null
          bb_deposit_id_2?: string | null
          created_at?: string
          data_corte?: string | null
          data_credito: string
          data_transacao_bb?: string | null
          descontos?: Json | null
          diff?: number | null
          id?: string
          import_id?: string | null
          manual?: boolean
          match_reason?: string | null
          numero_contrato?: string | null
          numero_reembolso: string
          operadora: string
          produto?: string | null
          status?: string
          subtotal_vendas?: number
          total_descontos?: number
          valor_creditado_bb?: number | null
          valor_liquido: number
        }
        Update: {
          audit_period_id?: string
          banco_credito?: string | null
          bb_deposit_id?: string | null
          bb_deposit_id_2?: string | null
          created_at?: string
          data_corte?: string | null
          data_credito?: string
          data_transacao_bb?: string | null
          descontos?: Json | null
          diff?: number | null
          id?: string
          import_id?: string | null
          manual?: boolean
          match_reason?: string | null
          numero_contrato?: string | null
          numero_reembolso?: string
          operadora?: string
          produto?: string | null
          status?: string
          subtotal_vendas?: number
          total_descontos?: number
          valor_creditado_bb?: number | null
          valor_liquido?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_voucher_lots_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_voucher_lots_bb_deposit_id_2_fkey"
            columns: ["bb_deposit_id_2"]
            isOneToOne: false
            referencedRelation: "audit_bank_deposits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_voucher_lots_bb_deposit_id_fkey"
            columns: ["bb_deposit_id"]
            isOneToOne: false
            referencedRelation: "audit_bank_deposits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_voucher_lots_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "audit_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      card_transactions: {
        Row: {
          brand: string | null
          cashback_fee: number | null
          created_at: string
          daily_closing_id: string
          gross_amount: number
          id: string
          machine_serial: string | null
          match_confidence: string | null
          match_type: string | null
          matched_order_id: string | null
          net_amount: number
          payment_method: string
          sale_date: string | null
          sale_time: string | null
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          brand?: string | null
          cashback_fee?: number | null
          created_at?: string
          daily_closing_id: string
          gross_amount?: number
          id?: string
          machine_serial?: string | null
          match_confidence?: string | null
          match_type?: string | null
          matched_order_id?: string | null
          net_amount?: number
          payment_method: string
          sale_date?: string | null
          sale_time?: string | null
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          brand?: string | null
          cashback_fee?: number | null
          created_at?: string
          daily_closing_id?: string
          gross_amount?: number
          id?: string
          machine_serial?: string | null
          match_confidence?: string | null
          match_type?: string | null
          matched_order_id?: string | null
          net_amount?: number
          payment_method?: string
          sale_date?: string | null
          sale_time?: string | null
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_transactions_daily_closing_id_fkey"
            columns: ["daily_closing_id"]
            isOneToOne: false
            referencedRelation: "daily_closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_transactions_matched_order_id_fkey"
            columns: ["matched_order_id"]
            isOneToOne: false
            referencedRelation: "imported_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_expectations: {
        Row: {
          closing_date: string
          counts: Json
          created_at: string
          created_by: string
          id: string
          sector: string
          total: number
          updated_at: string
        }
        Insert: {
          closing_date: string
          counts?: Json
          created_at?: string
          created_by: string
          id?: string
          sector?: string
          total?: number
          updated_at?: string
        }
        Update: {
          closing_date?: string
          counts?: Json
          created_at?: string
          created_by?: string
          id?: string
          sector?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      cash_snapshots: {
        Row: {
          counts: Json
          created_at: string
          daily_closing_id: string | null
          id: string
          salon_closing_id: string | null
          snapshot_type: string
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          counts?: Json
          created_at?: string
          daily_closing_id?: string | null
          id?: string
          salon_closing_id?: string | null
          snapshot_type?: string
          total?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          counts?: Json
          created_at?: string
          daily_closing_id?: string | null
          id?: string
          salon_closing_id?: string | null
          snapshot_type?: string
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_snapshots_daily_closing_id_fkey"
            columns: ["daily_closing_id"]
            isOneToOne: false
            referencedRelation: "daily_closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_snapshots_salon_closing_id_fkey"
            columns: ["salon_closing_id"]
            isOneToOne: false
            referencedRelation: "salon_closings"
            referencedColumns: ["id"]
          },
        ]
      }
      cashflow_accounts: {
        Row: {
          account_number: string | null
          active: boolean
          balance_anchor: number | null
          balance_anchor_date: string | null
          bank: string | null
          company: string
          created_at: string
          id: string
          is_passthrough: boolean
          kind: string
          name: string
          overdraft_limit: number
        }
        Insert: {
          account_number?: string | null
          active?: boolean
          balance_anchor?: number | null
          balance_anchor_date?: string | null
          bank?: string | null
          company: string
          created_at?: string
          id?: string
          is_passthrough?: boolean
          kind: string
          name: string
          overdraft_limit?: number
        }
        Update: {
          account_number?: string | null
          active?: boolean
          balance_anchor?: number | null
          balance_anchor_date?: string | null
          bank?: string | null
          company?: string
          created_at?: string
          id?: string
          is_passthrough?: boolean
          kind?: string
          name?: string
          overdraft_limit?: number
        }
        Relationships: []
      }
      cashflow_balances: {
        Row: {
          account_id: string
          as_of: string
          created_at: string
          id: string
          limit_available: number
          note: string | null
          own_balance: number
          provisioned: number
        }
        Insert: {
          account_id: string
          as_of: string
          created_at?: string
          id?: string
          limit_available?: number
          note?: string | null
          own_balance: number
          provisioned?: number
        }
        Update: {
          account_id?: string
          as_of?: string
          created_at?: string
          id?: string
          limit_available?: number
          note?: string | null
          own_balance?: number
          provisioned?: number
        }
        Relationships: [
          {
            foreignKeyName: "cashflow_balances_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "cashflow_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      cashflow_imports: {
        Row: {
          account_id: string | null
          created_at: string
          created_by: string | null
          duplicate_rows: number | null
          error_message: string | null
          file_name: string | null
          file_type: string
          id: string
          imported_rows: number | null
          status: string | null
          total_rows: number | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_rows?: number | null
          error_message?: string | null
          file_name?: string | null
          file_type: string
          id?: string
          imported_rows?: number | null
          status?: string | null
          total_rows?: number | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_rows?: number | null
          error_message?: string | null
          file_name?: string | null
          file_type?: string
          id?: string
          imported_rows?: number | null
          status?: string | null
          total_rows?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cashflow_imports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "cashflow_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      cashflow_loan_installments: {
        Row: {
          amount: number
          balance_after: number | null
          created_at: string
          due_date: string
          id: string
          interest: number | null
          loan_id: string
          paid: boolean
          principal: number | null
          seq: number
        }
        Insert: {
          amount: number
          balance_after?: number | null
          created_at?: string
          due_date: string
          id?: string
          interest?: number | null
          loan_id: string
          paid?: boolean
          principal?: number | null
          seq: number
        }
        Update: {
          amount?: number
          balance_after?: number | null
          created_at?: string
          due_date?: string
          id?: string
          interest?: number | null
          loan_id?: string
          paid?: boolean
          principal?: number | null
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "cashflow_loan_installments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "cashflow_loans"
            referencedColumns: ["id"]
          },
        ]
      }
      cashflow_loans: {
        Row: {
          active: boolean
          annual_rate: number | null
          company: string | null
          contract: string | null
          created_at: string
          first_due: string | null
          id: string
          last_due: string | null
          monthly_payment: number | null
          name: string
          outstanding_balance: number | null
          pays_from_account_id: string | null
          remaining_installments: number | null
          total_installments: number | null
        }
        Insert: {
          active?: boolean
          annual_rate?: number | null
          company?: string | null
          contract?: string | null
          created_at?: string
          first_due?: string | null
          id?: string
          last_due?: string | null
          monthly_payment?: number | null
          name: string
          outstanding_balance?: number | null
          pays_from_account_id?: string | null
          remaining_installments?: number | null
          total_installments?: number | null
        }
        Update: {
          active?: boolean
          annual_rate?: number | null
          company?: string | null
          contract?: string | null
          created_at?: string
          first_due?: string | null
          id?: string
          last_due?: string | null
          monthly_payment?: number | null
          name?: string
          outstanding_balance?: number | null
          pays_from_account_id?: string | null
          remaining_installments?: number | null
          total_installments?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cashflow_loans_pays_from_account_id_fkey"
            columns: ["pays_from_account_id"]
            isOneToOne: false
            referencedRelation: "cashflow_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      cashflow_saipos: {
        Row: {
          amount: number
          category: string | null
          company: string | null
          conferido: boolean
          conferido_em: string | null
          conta: string | null
          created_at: string
          descricao: string | null
          emissao: string | null
          fornecedor: string | null
          id: string
          import_id: string | null
          is_frente_caixa: boolean
          is_retido: boolean
          pagamento: string | null
          paid: boolean
          payment_method: string | null
          row_hash: string | null
          source: string
          source_seq: number
          vencimento: string | null
        }
        Insert: {
          amount: number
          category?: string | null
          company?: string | null
          conferido?: boolean
          conferido_em?: string | null
          conta?: string | null
          created_at?: string
          descricao?: string | null
          emissao?: string | null
          fornecedor?: string | null
          id?: string
          import_id?: string | null
          is_frente_caixa?: boolean
          is_retido?: boolean
          pagamento?: string | null
          paid?: boolean
          payment_method?: string | null
          row_hash?: string | null
          source?: string
          source_seq?: number
          vencimento?: string | null
        }
        Update: {
          amount?: number
          category?: string | null
          company?: string | null
          conferido?: boolean
          conferido_em?: string | null
          conta?: string | null
          created_at?: string
          descricao?: string | null
          emissao?: string | null
          fornecedor?: string | null
          id?: string
          import_id?: string | null
          is_frente_caixa?: boolean
          is_retido?: boolean
          pagamento?: string | null
          paid?: boolean
          payment_method?: string | null
          row_hash?: string | null
          source?: string
          source_seq?: number
          vencimento?: string | null
        }
        Relationships: []
      }
      cashflow_transactions: {
        Row: {
          account_id: string
          amount: number
          category: string | null
          conferido: boolean
          conferido_em: string | null
          counterparty: string | null
          created_at: string
          description: string | null
          detail: string | null
          doc_number: string | null
          external_id: string | null
          id: string
          import_id: string | null
          is_future: boolean
          is_internal_transfer: boolean
          row_hash: string | null
          running_balance: number | null
          source: string
          source_seq: number
          tx_date: string
        }
        Insert: {
          account_id: string
          amount: number
          category?: string | null
          conferido?: boolean
          conferido_em?: string | null
          counterparty?: string | null
          created_at?: string
          description?: string | null
          detail?: string | null
          doc_number?: string | null
          external_id?: string | null
          id?: string
          import_id?: string | null
          is_future?: boolean
          is_internal_transfer?: boolean
          row_hash?: string | null
          running_balance?: number | null
          source?: string
          source_seq?: number
          tx_date: string
        }
        Update: {
          account_id?: string
          amount?: number
          category?: string | null
          conferido?: boolean
          conferido_em?: string | null
          counterparty?: string | null
          created_at?: string
          description?: string | null
          detail?: string | null
          doc_number?: string | null
          external_id?: string | null
          id?: string
          import_id?: string | null
          is_future?: boolean
          is_internal_transfer?: boolean
          row_hash?: string | null
          running_balance?: number | null
          source?: string
          source_seq?: number
          tx_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "cashflow_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "cashflow_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      clau_actions_log: {
        Row: {
          action_type: string
          approved_at: string | null
          approved_by: string | null
          args: Json | null
          conversation_id: string | null
          created_at: string
          error_message: string | null
          explanation: string | null
          id: string
          output: Json | null
          payload: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_type: string
          approved_at?: string | null
          approved_by?: string | null
          args?: Json | null
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          explanation?: string | null
          id?: string
          output?: Json | null
          payload: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_type?: string
          approved_at?: string | null
          approved_by?: string | null
          args?: Json | null
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          explanation?: string | null
          id?: string
          output?: Json | null
          payload?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      clau_conversation_summaries: {
        Row: {
          conversation_id: string
          generated_at: string | null
          message_count_when_generated: number | null
          search_vector: unknown
          summary: string
          topics: string[] | null
        }
        Insert: {
          conversation_id: string
          generated_at?: string | null
          message_count_when_generated?: number | null
          search_vector?: unknown
          summary: string
          topics?: string[] | null
        }
        Update: {
          conversation_id?: string
          generated_at?: string | null
          message_count_when_generated?: number | null
          search_vector?: unknown
          summary?: string
          topics?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "clau_conversation_summaries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "clau_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      clau_conversations: {
        Row: {
          app_origin: string
          created_at: string | null
          id: string
          is_pinned: boolean | null
          message_count: number | null
          model: string | null
          summary: string | null
          title: string | null
          total_tokens_used: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          app_origin?: string
          created_at?: string | null
          id?: string
          is_pinned?: boolean | null
          message_count?: number | null
          model?: string | null
          summary?: string | null
          title?: string | null
          total_tokens_used?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          app_origin?: string
          created_at?: string | null
          id?: string
          is_pinned?: boolean | null
          message_count?: number | null
          model?: string | null
          summary?: string | null
          title?: string | null
          total_tokens_used?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      clau_extracted_facts: {
        Row: {
          archived: boolean | null
          category: string | null
          confirmed_by_user: boolean | null
          created_at: string | null
          fact: string
          id: string
          search_vector: unknown
          source_conversation_id: string | null
          source_message_id: string | null
        }
        Insert: {
          archived?: boolean | null
          category?: string | null
          confirmed_by_user?: boolean | null
          created_at?: string | null
          fact: string
          id?: string
          search_vector?: unknown
          source_conversation_id?: string | null
          source_message_id?: string | null
        }
        Update: {
          archived?: boolean | null
          category?: string | null
          confirmed_by_user?: boolean | null
          created_at?: string | null
          fact?: string
          id?: string
          search_vector?: unknown
          source_conversation_id?: string | null
          source_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clau_extracted_facts_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "clau_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clau_extracted_facts_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "clau_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      clau_messages: {
        Row: {
          content: string
          context_snapshot: Json | null
          conversation_id: string
          created_at: string | null
          id: string
          role: string
          search_vector: unknown
          tokens_used: number | null
        }
        Insert: {
          content: string
          context_snapshot?: Json | null
          conversation_id: string
          created_at?: string | null
          id?: string
          role: string
          search_vector?: unknown
          tokens_used?: number | null
        }
        Update: {
          content?: string
          context_snapshot?: Json | null
          conversation_id?: string
          created_at?: string | null
          id?: string
          role?: string
          search_vector?: unknown
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clau_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "clau_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      clau_project_memory: {
        Row: {
          app_origin: string
          content: string
          id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          app_origin?: string
          content?: string
          id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          app_origin?: string
          content?: string
          id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      clau_tool_logs: {
        Row: {
          caller: string
          conversation_id: string | null
          created_at: string | null
          duration_ms: number | null
          error: string | null
          id: string
          tool_input: Json
          tool_name: string
          tool_output_size: number | null
          user_id: string
        }
        Insert: {
          caller?: string
          conversation_id?: string | null
          created_at?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          tool_input: Json
          tool_name: string
          tool_output_size?: number | null
          user_id: string
        }
        Update: {
          caller?: string
          conversation_id?: string | null
          created_at?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          tool_input?: Json
          tool_name?: string
          tool_output_size?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clau_tool_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "clau_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_closings: {
        Row: {
          closing_date: string
          created_at: string
          id: string
          is_test: boolean
          operator_id: string | null
          reconciliation_status: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          closing_date: string
          created_at?: string
          id?: string
          is_test?: boolean
          operator_id?: string | null
          reconciliation_status?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          closing_date?: string
          created_at?: string
          id?: string
          is_test?: boolean
          operator_id?: string | null
          reconciliation_status?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      delivery_checkin_logs: {
        Row: {
          action: string
          checkin_id: string
          created_at: string
          device_info: string | null
          device_ip: string | null
          device_user_agent: string | null
          driver_id: string
          id: string
          performed_by: string
        }
        Insert: {
          action: string
          checkin_id: string
          created_at?: string
          device_info?: string | null
          device_ip?: string | null
          device_user_agent?: string | null
          driver_id: string
          id?: string
          performed_by: string
        }
        Update: {
          action?: string
          checkin_id?: string
          created_at?: string
          device_info?: string | null
          device_ip?: string | null
          device_user_agent?: string | null
          driver_id?: string
          id?: string
          performed_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_checkin_logs_checkin_id_fkey"
            columns: ["checkin_id"]
            isOneToOne: false
            referencedRelation: "delivery_checkins"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_checkins: {
        Row: {
          admin_inserted_by: string | null
          admin_removed_at: string | null
          admin_removed_by: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          device_info: string | null
          device_ip: string | null
          device_user_agent: string | null
          driver_id: string
          id: string
          origin: string
          promoted_at: string | null
          promoted_from_freed_by: string | null
          shift_id: string
          status: string
          substituto_pos_18h: boolean
          waitlist_entered_at: string | null
        }
        Insert: {
          admin_inserted_by?: string | null
          admin_removed_at?: string | null
          admin_removed_by?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          device_info?: string | null
          device_ip?: string | null
          device_user_agent?: string | null
          driver_id: string
          id?: string
          origin?: string
          promoted_at?: string | null
          promoted_from_freed_by?: string | null
          shift_id: string
          status?: string
          substituto_pos_18h?: boolean
          waitlist_entered_at?: string | null
        }
        Update: {
          admin_inserted_by?: string | null
          admin_removed_at?: string | null
          admin_removed_by?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          device_info?: string | null
          device_ip?: string | null
          device_user_agent?: string | null
          driver_id?: string
          id?: string
          origin?: string
          promoted_at?: string | null
          promoted_from_freed_by?: string | null
          shift_id?: string
          status?: string
          substituto_pos_18h?: boolean
          waitlist_entered_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_checkins_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "delivery_drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_checkins_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "delivery_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_drivers: {
        Row: {
          auth_user_id: string
          cnpj: string | null
          created_at: string
          email: string
          id: string
          max_periodos_dia: number
          nome: string
          notas: string | null
          password_changed: boolean
          pix: string | null
          status: string
          telefone: string
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          cnpj?: string | null
          created_at?: string
          email: string
          id?: string
          max_periodos_dia?: number
          nome: string
          notas?: string | null
          password_changed?: boolean
          pix?: string | null
          status?: string
          telefone: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          cnpj?: string | null
          created_at?: string
          email?: string
          id?: string
          max_periodos_dia?: number
          nome?: string
          notas?: string | null
          password_changed?: boolean
          pix?: string | null
          status?: string
          telefone?: string
          updated_at?: string
        }
        Relationships: []
      }
      delivery_shifts: {
        Row: {
          created_at: string
          created_by: string | null
          data: string
          horario_fim: string
          horario_inicio: string
          id: string
          notas: string | null
          vagas: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: string
          horario_fim: string
          horario_inicio: string
          id?: string
          notas?: string | null
          vagas?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: string
          horario_fim?: string
          horario_inicio?: string
          id?: string
          notas?: string | null
          vagas?: number
        }
        Relationships: []
      }
      imported_orders: {
        Row: {
          cancelled_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          daily_closing_id: string | null
          delivery_person: string | null
          id: string
          import_id: string
          is_cancelled: boolean
          is_confirmed: boolean
          manual_cash_amount: number
          migrated_at: string | null
          migrated_to_salon: boolean
          order_number: string
          partner_order_number: string | null
          payment_method: string
          sale_date: string | null
          sale_time: string | null
          sales_channel: string | null
          total_amount: number
        }
        Insert: {
          cancelled_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          daily_closing_id?: string | null
          delivery_person?: string | null
          id?: string
          import_id: string
          is_cancelled?: boolean
          is_confirmed?: boolean
          manual_cash_amount?: number
          migrated_at?: string | null
          migrated_to_salon?: boolean
          order_number: string
          partner_order_number?: string | null
          payment_method: string
          sale_date?: string | null
          sale_time?: string | null
          sales_channel?: string | null
          total_amount?: number
        }
        Update: {
          cancelled_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          daily_closing_id?: string | null
          delivery_person?: string | null
          id?: string
          import_id?: string
          is_cancelled?: boolean
          is_confirmed?: boolean
          manual_cash_amount?: number
          migrated_at?: string | null
          migrated_to_salon?: boolean
          order_number?: string
          partner_order_number?: string | null
          payment_method?: string
          sale_date?: string | null
          sale_time?: string | null
          sales_channel?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "imported_orders_daily_closing_id_fkey"
            columns: ["daily_closing_id"]
            isOneToOne: false
            referencedRelation: "daily_closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imported_orders_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          created_at: string
          daily_closing_id: string | null
          duplicate_rows: number
          file_name: string
          id: string
          is_test: boolean
          new_rows: number
          status: string
          total_rows: number
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_closing_id?: string | null
          duplicate_rows?: number
          file_name: string
          id?: string
          is_test?: boolean
          new_rows?: number
          status?: string
          total_rows?: number
          user_id: string
        }
        Update: {
          created_at?: string
          daily_closing_id?: string | null
          duplicate_rows?: number
          file_name?: string
          id?: string
          is_test?: boolean
          new_rows?: number
          status?: string
          total_rows?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "imports_daily_closing_id_fkey"
            columns: ["daily_closing_id"]
            isOneToOne: false
            referencedRelation: "daily_closings"
            referencedColumns: ["id"]
          },
        ]
      }
      label_orders: {
        Row: {
          created_at: string
          id: string
          items: Json
          pizza_count: number
          printed: boolean
          printed_at: string | null
          saipos_sale_id: number
          sale_number: string
          shift_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          items?: Json
          pizza_count?: number
          printed?: boolean
          printed_at?: string | null
          saipos_sale_id: number
          sale_number: string
          shift_date: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          items?: Json
          pizza_count?: number
          printed?: boolean
          printed_at?: string | null
          saipos_sale_id?: number
          sale_number?: string
          shift_date?: string
          user_id?: string
        }
        Relationships: []
      }
      machine_readings: {
        Row: {
          cash_amount: number
          created_at: string
          credit_amount: number
          credit_count: number
          daily_closing_id: string | null
          debit_amount: number
          debit_count: number
          delivery_person: string
          id: string
          machine_serial: string
          pix_amount: number
          pix_count: number
          salon_closing_id: string | null
          updated_at: string
          user_id: string
          voucher_amount: number
          voucher_count: number
        }
        Insert: {
          cash_amount?: number
          created_at?: string
          credit_amount?: number
          credit_count?: number
          daily_closing_id?: string | null
          debit_amount?: number
          debit_count?: number
          delivery_person?: string
          id?: string
          machine_serial?: string
          pix_amount?: number
          pix_count?: number
          salon_closing_id?: string | null
          updated_at?: string
          user_id: string
          voucher_amount?: number
          voucher_count?: number
        }
        Update: {
          cash_amount?: number
          created_at?: string
          credit_amount?: number
          credit_count?: number
          daily_closing_id?: string | null
          debit_amount?: number
          debit_count?: number
          delivery_person?: string
          id?: string
          machine_serial?: string
          pix_amount?: number
          pix_count?: number
          salon_closing_id?: string | null
          updated_at?: string
          user_id?: string
          voucher_amount?: number
          voucher_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "machine_readings_daily_closing_id_fkey"
            columns: ["daily_closing_id"]
            isOneToOne: false
            referencedRelation: "daily_closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_readings_salon_closing_id_fkey"
            columns: ["salon_closing_id"]
            isOneToOne: false
            referencedRelation: "salon_closings"
            referencedColumns: ["id"]
          },
        ]
      }
      machine_registry: {
        Row: {
          category: string
          created_at: string
          friendly_name: string
          id: string
          is_active: boolean
          serial_number: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          friendly_name: string
          id?: string
          is_active?: boolean
          serial_number: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          friendly_name?: string
          id?: string
          is_active?: boolean
          serial_number?: string
          updated_at?: string
        }
        Relationships: []
      }
      menu_permissions: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_view: boolean
          created_at: string
          id: string
          menu_key: string
          user_id: string
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          menu_key: string
          user_id: string
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          menu_key?: string
          user_id?: string
        }
        Relationships: []
      }
      nfse_documents: {
        Row: {
          chave_acesso: string | null
          codigo_verificacao: string | null
          consulta: string | null
          created_at: string
          data_emissao: string | null
          descricao: string | null
          has_pdf: boolean
          has_xml: boolean
          id: string
          justificativa: string | null
          municipio: string | null
          numero_nfse: string | null
          prestador_cnpj: string | null
          prestador_nome: string | null
          situacao: string | null
          source: string
          tomador_cnpj: string | null
          tomador_nome: string | null
          updated_at: string
          valor_servico: number | null
        }
        Insert: {
          chave_acesso?: string | null
          codigo_verificacao?: string | null
          consulta?: string | null
          created_at?: string
          data_emissao?: string | null
          descricao?: string | null
          has_pdf?: boolean
          has_xml?: boolean
          id?: string
          justificativa?: string | null
          municipio?: string | null
          numero_nfse?: string | null
          prestador_cnpj?: string | null
          prestador_nome?: string | null
          situacao?: string | null
          source?: string
          tomador_cnpj?: string | null
          tomador_nome?: string | null
          updated_at?: string
          valor_servico?: number | null
        }
        Update: {
          chave_acesso?: string | null
          codigo_verificacao?: string | null
          consulta?: string | null
          created_at?: string
          data_emissao?: string | null
          descricao?: string | null
          has_pdf?: boolean
          has_xml?: boolean
          id?: string
          justificativa?: string | null
          municipio?: string | null
          numero_nfse?: string | null
          prestador_cnpj?: string | null
          prestador_nome?: string | null
          situacao?: string | null
          source?: string
          tomador_cnpj?: string | null
          tomador_nome?: string | null
          updated_at?: string
          valor_servico?: number | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      order_payment_breakdowns: {
        Row: {
          amount: number
          created_at: string
          id: string
          imported_order_id: string
          is_auto_calculated: boolean
          payment_method_name: string
          payment_type: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          imported_order_id: string
          is_auto_calculated?: boolean
          payment_method_name: string
          payment_type?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          imported_order_id?: string
          is_auto_calculated?: boolean
          payment_method_name?: string
          payment_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_payment_breakdowns_imported_order_id_fkey"
            columns: ["imported_order_id"]
            isOneToOne: false
            referencedRelation: "imported_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      pickngo_webhook_logs: {
        Row: {
          event_type: string | null
          id: string
          payload: Json
          received_at: string
        }
        Insert: {
          event_type?: string | null
          id?: string
          payload: Json
          received_at?: string
        }
        Update: {
          event_type?: string | null
          id?: string
          payload?: Json
          received_at?: string
        }
        Relationships: []
      }
      pluggy_accounts: {
        Row: {
          balance: number | null
          cashflow_account_id: string | null
          created_at: string
          currency: string | null
          id: string
          item_id: string
          last_synced_at: string | null
          name: string | null
          number: string | null
          pluggy_account_id: string
          subtype: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          balance?: number | null
          cashflow_account_id?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          item_id: string
          last_synced_at?: string | null
          name?: string | null
          number?: string | null
          pluggy_account_id: string
          subtype?: string | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          balance?: number | null
          cashflow_account_id?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          item_id?: string
          last_synced_at?: string | null
          name?: string | null
          number?: string | null
          pluggy_account_id?: string
          subtype?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pluggy_accounts_cashflow_account_id_fkey"
            columns: ["cashflow_account_id"]
            isOneToOne: false
            referencedRelation: "cashflow_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      pluggy_events: {
        Row: {
          created_at: string
          event: string | null
          id: string
          item_id: string | null
          payload: Json | null
          processed: boolean
        }
        Insert: {
          created_at?: string
          event?: string | null
          id?: string
          item_id?: string | null
          payload?: Json | null
          processed?: boolean
        }
        Update: {
          created_at?: string
          event?: string | null
          id?: string
          item_id?: string | null
          payload?: Json | null
          processed?: boolean
        }
        Relationships: []
      }
      pluggy_items: {
        Row: {
          company: string | null
          connector_id: number | null
          connector_name: string | null
          created_at: string
          id: string
          item_id: string
          last_status_message: string | null
          last_updated_at: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          company?: string | null
          connector_id?: number | null
          connector_name?: string | null
          created_at?: string
          id?: string
          item_id: string
          last_status_message?: string | null
          last_updated_at?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          company?: string | null
          connector_id?: number | null
          connector_name?: string | null
          created_at?: string
          id?: string
          item_id?: string
          last_status_message?: string | null
          last_updated_at?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      saipos_fin_transactions: {
        Row: {
          amount: number | null
          children: Json | null
          conciliated: string | null
          conferido: boolean
          conferido_em: string | null
          created_at: string
          date: string | null
          desc_store_bank_account: string | null
          desc_store_category_financial: string | null
          desc_store_fin_transaction: string | null
          desc_store_payment_method: string | null
          id: string
          id_store: number | null
          id_store_fin_transaction: number
          issuance_date: string | null
          paid: string | null
          payment_date: string | null
          provider_trade_name: string | null
          raw: Json | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          children?: Json | null
          conciliated?: string | null
          conferido?: boolean
          conferido_em?: string | null
          created_at?: string
          date?: string | null
          desc_store_bank_account?: string | null
          desc_store_category_financial?: string | null
          desc_store_fin_transaction?: string | null
          desc_store_payment_method?: string | null
          id?: string
          id_store?: number | null
          id_store_fin_transaction: number
          issuance_date?: string | null
          paid?: string | null
          payment_date?: string | null
          provider_trade_name?: string | null
          raw?: Json | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          children?: Json | null
          conciliated?: string | null
          conferido?: boolean
          conferido_em?: string | null
          created_at?: string
          date?: string | null
          desc_store_bank_account?: string | null
          desc_store_category_financial?: string | null
          desc_store_fin_transaction?: string | null
          desc_store_payment_method?: string | null
          id?: string
          id_store?: number | null
          id_store_fin_transaction?: number
          issuance_date?: string | null
          paid?: string | null
          payment_date?: string | null
          provider_trade_name?: string | null
          raw?: Json | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      salon_card_transactions: {
        Row: {
          brand: string | null
          cashback_fee: number | null
          created_at: string
          gross_amount: number
          id: string
          machine_serial: string | null
          match_confidence: string | null
          match_type: string | null
          matched_order_id: string | null
          net_amount: number
          payment_method: string
          sale_date: string | null
          sale_time: string | null
          salon_closing_id: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          brand?: string | null
          cashback_fee?: number | null
          created_at?: string
          gross_amount?: number
          id?: string
          machine_serial?: string | null
          match_confidence?: string | null
          match_type?: string | null
          matched_order_id?: string | null
          net_amount?: number
          payment_method: string
          sale_date?: string | null
          sale_time?: string | null
          salon_closing_id: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          brand?: string | null
          cashback_fee?: number | null
          created_at?: string
          gross_amount?: number
          id?: string
          machine_serial?: string | null
          match_confidence?: string | null
          match_type?: string | null
          matched_order_id?: string | null
          net_amount?: number
          payment_method?: string
          sale_date?: string | null
          sale_time?: string | null
          salon_closing_id?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_card_transactions_matched_order_id_fkey"
            columns: ["matched_order_id"]
            isOneToOne: false
            referencedRelation: "salon_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_card_transactions_salon_closing_id_fkey"
            columns: ["salon_closing_id"]
            isOneToOne: false
            referencedRelation: "salon_closings"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_closings: {
        Row: {
          closing_date: string
          created_at: string
          id: string
          operator_id: string | null
          reconciliation_status: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          closing_date: string
          created_at?: string
          id?: string
          operator_id?: string | null
          reconciliation_status?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          closing_date?: string
          created_at?: string
          id?: string
          operator_id?: string | null
          reconciliation_status?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      salon_imports: {
        Row: {
          created_at: string
          duplicate_rows: number
          file_name: string
          id: string
          new_rows: number
          salon_closing_id: string | null
          skipped_cancelled: number
          status: string
          total_rows: number
          user_id: string
        }
        Insert: {
          created_at?: string
          duplicate_rows?: number
          file_name: string
          id?: string
          new_rows?: number
          salon_closing_id?: string | null
          skipped_cancelled?: number
          status?: string
          total_rows?: number
          user_id: string
        }
        Update: {
          created_at?: string
          duplicate_rows?: number
          file_name?: string
          id?: string
          new_rows?: number
          salon_closing_id?: string | null
          skipped_cancelled?: number
          status?: string
          total_rows?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_imports_salon_closing_id_fkey"
            columns: ["salon_closing_id"]
            isOneToOne: false
            referencedRelation: "salon_closings"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_order_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          payment_method: string
          salon_order_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          payment_method: string
          salon_order_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          payment_method?: string
          salon_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_order_payments_salon_order_id_fkey"
            columns: ["salon_order_id"]
            isOneToOne: false
            referencedRelation: "salon_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_orders: {
        Row: {
          card_number: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          customers_count: number | null
          discount_amount: number
          id: string
          is_confirmed: boolean
          order_type: string
          payment_method: string
          saipos_sale_id: string | null
          sale_date: string | null
          sale_number: string | null
          sale_time: string | null
          salon_closing_id: string | null
          salon_import_id: string
          service_charge_amount: number | null
          table_number: string | null
          ticket_number: string | null
          total_amount: number
        }
        Insert: {
          card_number?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          customers_count?: number | null
          discount_amount?: number
          id?: string
          is_confirmed?: boolean
          order_type: string
          payment_method?: string
          saipos_sale_id?: string | null
          sale_date?: string | null
          sale_number?: string | null
          sale_time?: string | null
          salon_closing_id?: string | null
          salon_import_id: string
          service_charge_amount?: number | null
          table_number?: string | null
          ticket_number?: string | null
          total_amount?: number
        }
        Update: {
          card_number?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          customers_count?: number | null
          discount_amount?: number
          id?: string
          is_confirmed?: boolean
          order_type?: string
          payment_method?: string
          saipos_sale_id?: string | null
          sale_date?: string | null
          sale_number?: string | null
          sale_time?: string | null
          salon_closing_id?: string | null
          salon_import_id?: string
          service_charge_amount?: number | null
          table_number?: string | null
          ticket_number?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "salon_orders_salon_closing_id_fkey"
            columns: ["salon_closing_id"]
            isOneToOne: false
            referencedRelation: "salon_closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_orders_salon_import_id_fkey"
            columns: ["salon_import_id"]
            isOneToOne: false
            referencedRelation: "salon_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      sofia_assistants: {
        Row: {
          created_at: string
          id: string
          inbound_webhook_url: string | null
          language_id: number | null
          name: string
          phone_number_id: number | null
          post_call_evaluation: boolean | null
          post_call_schema: Json | null
          raw: Json | null
          sofia_id: number
          status: string
          synced_at: string
          type: string
          updated_at: string
          voice_id: number | null
          webhook_url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          inbound_webhook_url?: string | null
          language_id?: number | null
          name: string
          phone_number_id?: number | null
          post_call_evaluation?: boolean | null
          post_call_schema?: Json | null
          raw?: Json | null
          sofia_id: number
          status?: string
          synced_at?: string
          type: string
          updated_at?: string
          voice_id?: number | null
          webhook_url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          inbound_webhook_url?: string | null
          language_id?: number | null
          name?: string
          phone_number_id?: number | null
          post_call_evaluation?: boolean | null
          post_call_schema?: Json | null
          raw?: Json | null
          sofia_id?: number
          status?: string
          synced_at?: string
          type?: string
          updated_at?: string
          voice_id?: number | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      sofia_calls: {
        Row: {
          assistant_sofia_id: number | null
          campaign_id: string | null
          cost_minutes: number | null
          created_at: string
          customer_name: string | null
          direction: string
          duration_sec: number | null
          ended_at: string | null
          extracted_data: Json | null
          id: string
          phone: string | null
          raw: Json | null
          recording_url: string | null
          sofia_call_id: string | null
          started_at: string | null
          status: string
          summary: string | null
          transcript: Json | null
          updated_at: string
        }
        Insert: {
          assistant_sofia_id?: number | null
          campaign_id?: string | null
          cost_minutes?: number | null
          created_at?: string
          customer_name?: string | null
          direction: string
          duration_sec?: number | null
          ended_at?: string | null
          extracted_data?: Json | null
          id?: string
          phone?: string | null
          raw?: Json | null
          recording_url?: string | null
          sofia_call_id?: string | null
          started_at?: string | null
          status?: string
          summary?: string | null
          transcript?: Json | null
          updated_at?: string
        }
        Update: {
          assistant_sofia_id?: number | null
          campaign_id?: string | null
          cost_minutes?: number | null
          created_at?: string
          customer_name?: string | null
          direction?: string
          duration_sec?: number | null
          ended_at?: string | null
          extracted_data?: Json | null
          id?: string
          phone?: string | null
          raw?: Json | null
          recording_url?: string | null
          sofia_call_id?: string | null
          started_at?: string | null
          status?: string
          summary?: string | null
          transcript?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sofia_calls_assistant_sofia_id_fkey"
            columns: ["assistant_sofia_id"]
            isOneToOne: false
            referencedRelation: "sofia_assistants"
            referencedColumns: ["sofia_id"]
          },
          {
            foreignKeyName: "sofia_calls_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "sofia_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      sofia_campaign_targets: {
        Row: {
          attempts: number
          campaign_id: string
          created_at: string
          customer_name: string | null
          id: string
          last_attempt_at: string | null
          last_call_id: string | null
          phone: string
          status: string
          updated_at: string
          variables: Json | null
        }
        Insert: {
          attempts?: number
          campaign_id: string
          created_at?: string
          customer_name?: string | null
          id?: string
          last_attempt_at?: string | null
          last_call_id?: string | null
          phone: string
          status?: string
          updated_at?: string
          variables?: Json | null
        }
        Update: {
          attempts?: number
          campaign_id?: string
          created_at?: string
          customer_name?: string | null
          id?: string
          last_attempt_at?: string | null
          last_call_id?: string | null
          phone?: string
          status?: string
          updated_at?: string
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "sofia_campaign_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "sofia_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sofia_campaign_targets_last_call_id_fkey"
            columns: ["last_call_id"]
            isOneToOne: false
            referencedRelation: "sofia_calls"
            referencedColumns: ["id"]
          },
        ]
      }
      sofia_campaigns: {
        Row: {
          assistant_sofia_id: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          default_variables: Json | null
          dial_window_end: string | null
          dial_window_start: string | null
          estimated_minutes_per_call: number | null
          id: string
          kind: string
          max_concurrent: number
          name: string
          notes: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assistant_sofia_id: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          default_variables?: Json | null
          dial_window_end?: string | null
          dial_window_start?: string | null
          estimated_minutes_per_call?: number | null
          id?: string
          kind: string
          max_concurrent?: number
          name: string
          notes?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assistant_sofia_id?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          default_variables?: Json | null
          dial_window_end?: string | null
          dial_window_start?: string | null
          estimated_minutes_per_call?: number | null
          id?: string
          kind?: string
          max_concurrent?: number
          name?: string
          notes?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sofia_campaigns_assistant_sofia_id_fkey"
            columns: ["assistant_sofia_id"]
            isOneToOne: false
            referencedRelation: "sofia_assistants"
            referencedColumns: ["sofia_id"]
          },
        ]
      }
      sofia_kb_documents: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          raw: Json | null
          sofia_doc_id: number
          sofia_kb_id: number
          status: string | null
          status_label: string | null
          synced_at: string
          type: string | null
          type_label: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          raw?: Json | null
          sofia_doc_id: number
          sofia_kb_id: number
          status?: string | null
          status_label?: string | null
          synced_at?: string
          type?: string | null
          type_label?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          raw?: Json | null
          sofia_doc_id?: number
          sofia_kb_id?: number
          status?: string | null
          status_label?: string | null
          synced_at?: string
          type?: string | null
          type_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sofia_kb_documents_sofia_kb_id_fkey"
            columns: ["sofia_kb_id"]
            isOneToOne: false
            referencedRelation: "sofia_knowledgebases"
            referencedColumns: ["sofia_kb_id"]
          },
        ]
      }
      sofia_knowledgebases: {
        Row: {
          assistants_count: number | null
          created_at: string
          description: string | null
          documents_count: number | null
          id: string
          name: string
          raw: Json | null
          sofia_kb_id: number
          status: string | null
          status_label: string | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          assistants_count?: number | null
          created_at?: string
          description?: string | null
          documents_count?: number | null
          id?: string
          name: string
          raw?: Json | null
          sofia_kb_id: number
          status?: string | null
          status_label?: string | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          assistants_count?: number | null
          created_at?: string
          description?: string | null
          documents_count?: number | null
          id?: string
          name?: string
          raw?: Json | null
          sofia_kb_id?: number
          status?: string | null
          status_label?: string | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sofia_menu: {
        Row: {
          created_at: string
          data: Json
          id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data: Json
          id?: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      sofia_order_counter: {
        Row: {
          dia: string
          ultimo: number
        }
        Insert: {
          dia?: string
          ultimo?: number
        }
        Update: {
          dia?: string
          ultimo?: number
        }
        Relationships: []
      }
      sofia_orders: {
        Row: {
          bairro: string | null
          complemento: string | null
          conferido_por: string | null
          created_at: string
          dia: string
          endereco: string | null
          forma_pagamento: string | null
          id: string
          impresso_em: string | null
          itens: Json
          nome_cliente: string | null
          numero: number
          observacoes: string | null
          origem: string
          raw: Json | null
          referencia: string | null
          sofia_call_id: string | null
          status: string
          subtotal: number
          taxa_entrega: number
          telefone: string | null
          tipo: string
          total: number
          troco_para: number | null
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          complemento?: string | null
          conferido_por?: string | null
          created_at?: string
          dia?: string
          endereco?: string | null
          forma_pagamento?: string | null
          id?: string
          impresso_em?: string | null
          itens?: Json
          nome_cliente?: string | null
          numero: number
          observacoes?: string | null
          origem?: string
          raw?: Json | null
          referencia?: string | null
          sofia_call_id?: string | null
          status?: string
          subtotal?: number
          taxa_entrega?: number
          telefone?: string | null
          tipo?: string
          total?: number
          troco_para?: number | null
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          complemento?: string | null
          conferido_por?: string | null
          created_at?: string
          dia?: string
          endereco?: string | null
          forma_pagamento?: string | null
          id?: string
          impresso_em?: string | null
          itens?: Json
          nome_cliente?: string | null
          numero?: number
          observacoes?: string | null
          origem?: string
          raw?: Json | null
          referencia?: string | null
          sofia_call_id?: string | null
          status?: string
          subtotal?: number
          taxa_entrega?: number
          telefone?: string | null
          tipo?: string
          total?: number
          troco_para?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      sofia_settings: {
        Row: {
          data: Json
          slug: string
          updated_at: string
        }
        Insert: {
          data?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          data?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          details: Json | null
          error_message: string | null
          executed_at: string
          id: string
          status: string
          sync_type: string
        }
        Insert: {
          details?: Json | null
          error_message?: string | null
          executed_at?: string
          id?: string
          status?: string
          sync_type?: string
        }
        Update: {
          details?: Json | null
          error_message?: string | null
          executed_at?: string
          id?: string
          status?: string
          sync_type?: string
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          id: string
          permission: string
          user_id: string
        }
        Insert: {
          id?: string
          permission: string
          user_id: string
        }
        Update: {
          id?: string
          permission?: string
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          avatar_emoji: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_emoji?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_emoji?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vault_daily_closings: {
        Row: {
          balance: number
          change_salon: number
          change_tele: number
          closing_date: string
          cofre_final: Json | null
          contagem_cofre: Json | null
          contagem_salao: Json | null
          contagem_tele: Json | null
          created_at: string
          id: string
          trocos_salao: Json | null
          trocos_tele: Json | null
          updated_at: string
          user_id: string
          vault_entry: number
          vault_entry_counts: Json | null
          vault_entry_description: string | null
          vault_exit: number
          vault_exit_counts: Json | null
          vault_exit_description: string | null
        }
        Insert: {
          balance?: number
          change_salon?: number
          change_tele?: number
          closing_date: string
          cofre_final?: Json | null
          contagem_cofre?: Json | null
          contagem_salao?: Json | null
          contagem_tele?: Json | null
          created_at?: string
          id?: string
          trocos_salao?: Json | null
          trocos_tele?: Json | null
          updated_at?: string
          user_id: string
          vault_entry?: number
          vault_entry_counts?: Json | null
          vault_entry_description?: string | null
          vault_exit?: number
          vault_exit_counts?: Json | null
          vault_exit_description?: string | null
        }
        Update: {
          balance?: number
          change_salon?: number
          change_tele?: number
          closing_date?: string
          cofre_final?: Json | null
          contagem_cofre?: Json | null
          contagem_salao?: Json | null
          contagem_tele?: Json | null
          created_at?: string
          id?: string
          trocos_salao?: Json | null
          trocos_tele?: Json | null
          updated_at?: string
          user_id?: string
          vault_entry?: number
          vault_entry_counts?: Json | null
          vault_entry_description?: string | null
          vault_exit?: number
          vault_exit_counts?: Json | null
          vault_exit_description?: string | null
        }
        Relationships: []
      }
      vault_misc_expenses: {
        Row: {
          amount: number
          created_at: string
          description: string
          expense_date: string
          id: string
          origin: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          description: string
          expense_date: string
          id?: string
          origin: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          expense_date?: string
          id?: string
          origin?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      saipos_fin_effective: {
        Row: {
          amount: number | null
          amount_raw: number | null
          children: Json | null
          conciliated: string | null
          conferido: boolean | null
          conferido_em: string | null
          created_at: string | null
          date: string | null
          desc_store_bank_account: string | null
          desc_store_category_financial: string | null
          desc_store_fin_transaction: string | null
          desc_store_payment_method: string | null
          id: string | null
          id_store: number | null
          id_store_fin_transaction: number | null
          issuance_date: string | null
          paid: string | null
          payment_date: string | null
          provider_trade_name: string | null
          raw: Json | null
          synced_at: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: never
          amount_raw?: number | null
          children?: Json | null
          conciliated?: string | null
          conferido?: boolean | null
          conferido_em?: string | null
          created_at?: string | null
          date?: string | null
          desc_store_bank_account?: string | null
          desc_store_category_financial?: string | null
          desc_store_fin_transaction?: string | null
          desc_store_payment_method?: string | null
          id?: string | null
          id_store?: number | null
          id_store_fin_transaction?: number | null
          issuance_date?: string | null
          paid?: string | null
          payment_date?: string | null
          provider_trade_name?: string | null
          raw?: Json | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: never
          amount_raw?: number | null
          children?: Json | null
          conciliated?: string | null
          conferido?: boolean | null
          conferido_em?: string | null
          created_at?: string | null
          date?: string | null
          desc_store_bank_account?: string | null
          desc_store_category_financial?: string | null
          desc_store_fin_transaction?: string | null
          desc_store_payment_method?: string | null
          id?: string | null
          id_store?: number | null
          id_store_fin_transaction?: number | null
          issuance_date?: string | null
          paid?: string | null
          payment_date?: string | null
          provider_trade_name?: string | null
          raw?: Json | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      attempt_checkin: {
        Args: {
          p_device_info?: string
          p_device_ip?: string
          p_device_user_agent?: string
          p_driver_id: string
          p_shift_id: string
        }
        Returns: Json
      }
      audit_intake_by_month: {
        Args: { p_period: string }
        Returns: {
          data_max: string
          data_min: string
          doc: string
          doc_id: string
          grupo: string
          linhas: number
          valor: number
          ym: string
        }[]
      }
      cashback_identificadas: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      cashflow_category_summary: {
        Args: { p_end: string; p_start: string }
        Returns: {
          category: string
          company: string
          n: number
          total: number
        }[]
      }
      cashflow_monthly_consolidated: {
        Args: never
        Returns: {
          entradas: number
          saidas: number
          ym: string
        }[]
      }
      cashflow_monthly_summary: {
        Args: never
        Returns: {
          account_id: string
          account_name: string
          ano: number
          company: string
          entradas: number
          mes: number
          saidas: number
        }[]
      }
      cashflow_retido_summary: {
        Args: { p_end: string; p_start: string }
        Returns: {
          category: string
          n: number
          total: number
        }[]
      }
      cashflow_statement_coverage: {
        Args: never
        Returns: {
          account_id: string
          account_name: string
          company: string
          max_tx: string
          min_tx: string
          n: number
          saldo_final: number
        }[]
      }
      cashflow_upcoming_bills: {
        Args: never
        Returns: {
          amount: number
          category: string
          descricao: string
          fornecedor: string
          vencimento: string
        }[]
      }
      cashflow_upcoming_bills_daily: {
        Args: { p_days?: number; p_start?: string }
        Returns: {
          date: string
          items: Json
          n: number
          total: number
        }[]
      }
      classify_ifood_deposits: {
        Args: { p_period_id: string }
        Returns: undefined
      }
      clau_approve_action: { Args: { p_action_id: string }; Returns: undefined }
      clau_exec_mutation: { Args: { p_action_id: string }; Returns: Json }
      clau_reject_action: { Args: { p_action_id: string }; Returns: undefined }
      clau_safe_query: { Args: { p_sql: string }; Returns: Json }
      clau_search_messages: {
        Args: { p_limit?: number; p_query: string; p_user_id: string }
        Returns: {
          content: string
          conversation_id: string
          conversation_title: string
          created_at: string
          rank: number
          role: string
        }[]
      }
      clau_search_summaries: {
        Args: { p_limit?: number; p_query: string; p_user_id: string }
        Returns: {
          conversation_id: string
          conversation_title: string
          generated_at: string
          rank: number
          summary: string
          topics: string[]
        }[]
      }
      delete_audit_import: { Args: { p_import_id: string }; Returns: Json }
      get_audit_contabil_breakdown: {
        Args: { p_period_id: string }
        Returns: {
          bruto: number
          categoria: string
          dia: number
          liquido: number
          qtd: number
          taxa: number
        }[]
      }
      get_audit_ifood_daily_detail: {
        Args: { p_period_id: string }
        Returns: {
          bruto: number
          deposito: number
          diferenca: number
          liquido: number
          match_date: string
          status: string
          vendas_count: number
        }[]
      }
      get_audit_match_breakdown: {
        Args: { p_period_id: string }
        Returns: {
          bruto_vendido: number
          categoria: string
          lag_medio_dias: number
          liquido_vendido: number
          primeira_data_dep: string
          sale_date: string
          status: string
          taxa_declarada: number
          taxa_efetiva: number
          total_depositos: number
          total_recebido: number
          total_vendas: number
          ultima_data_dep: string
        }[]
      }
      get_audit_match_detail: {
        Args: { p_categoria: string; p_period_id: string; p_sale_date: string }
        Returns: {
          data: string
          descricao: string
          doc: string
          hora: string
          match_reason: string
          match_status: string
          source: string
          valor: number
        }[]
      }
      get_audit_period_deposits: {
        Args: { p_period_id: string }
        Returns: {
          bank: string
          category: string
          deposit_count: number
          match_status: string
          total_amount: number
        }[]
      }
      get_audit_period_totals: {
        Args: { p_period_id: string }
        Returns: {
          total_bruto: number
          total_bruto_ifood: number
          total_count: number
          total_incentivo_ifood: number
          total_liquido_declarado: number
          total_liquido_ifood: number
          total_promocao: number
          total_promocao_ifood: number
          total_taxa_declarada: number
        }[]
      }
      get_daily_audit_summary: {
        Args: { p_period_id: string }
        Returns: {
          deposito_cresol: number
          deposito_qtd: number
          dia: string
          vendas_maquinona_bruto: number
          vendas_maquinona_liquido: number
          vendas_qtd: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      ifood_calc_data_repasse: { Args: { base: string }; Returns: string }
      ifood_shift_back21d: { Args: { base: string }; Returns: string }
      mark_password_changed: { Args: { p_user_id: string }; Returns: undefined }
      openclaw_run_sql_select: { Args: { p_sql: string }; Returns: Json }
      promote_from_waitlist: {
        Args: {
          p_freed_by: string
          p_is_after_18h?: boolean
          p_max_promotions?: number
          p_shift_id: string
        }
        Returns: Json
      }
      reconcile_saidas: {
        Args: { p_fim: string; p_ini: string }
        Returns: {
          account_name: string
          categoria: string
          conferido: boolean
          confianca: string
          descricao: string
          descricao_banco: string
          fornecedor: string
          saipos_id: string
          tipo: string
          tx_date: string
          tx_id: string
          valor: number
          vencimento: string
        }[]
      }
      set_conferido: {
        Args: { p_id: string; p_kind: string; p_value: boolean }
        Returns: undefined
      }
      sofia_next_numero: { Args: never; Returns: number }
    }
    Enums: {
      app_role:
        | "admin"
        | "operador"
        | "caixa_tele"
        | "caixa_salao"
        | "entregador"
        | "lider"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "operador",
        "caixa_tele",
        "caixa_salao",
        "entregador",
        "lider",
      ],
    },
  },
} as const
