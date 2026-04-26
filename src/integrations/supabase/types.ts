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
      audit_card_transactions: {
        Row: {
          audit_period_id: string
          brand: string | null
          created_at: string
          deposit_group: string | null
          expected_deposit_date: string | null
          gross_amount: number
          id: string
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
          created_at: string
          created_by: string | null
          id: string
          month: number
          status: string
          updated_at: string
          year: number
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          month: number
          status?: string
          updated_at?: string
          year: number
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          month?: number
          status?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      audit_voucher_matches: {
        Row: {
          audit_period_id: string
          company: string
          created_at: string
          deposit_count: number
          deposited_amount: number
          difference: number
          effective_tax_rate: number | null
          id: string
          sold_amount: number
          sold_count: number
          status: string
        }
        Insert: {
          audit_period_id: string
          company: string
          created_at?: string
          deposit_count?: number
          deposited_amount?: number
          difference?: number
          effective_tax_rate?: number | null
          id?: string
          sold_amount?: number
          sold_count?: number
          status?: string
        }
        Update: {
          audit_period_id?: string
          company?: string
          created_at?: string
          deposit_count?: number
          deposited_amount?: number
          difference?: number
          effective_tax_rate?: number | null
          id?: string
          sold_amount?: number
          sold_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_voucher_matches_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      card_transactions: {
        Row: {
          brand: string | null
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
      clau_messages: {
        Row: {
          content: string
          context_snapshot: Json | null
          conversation_id: string
          created_at: string | null
          id: string
          role: string
          tokens_used: number | null
        }
        Insert: {
          content: string
          context_snapshot?: Json | null
          conversation_id: string
          created_at?: string | null
          id?: string
          role: string
          tokens_used?: number | null
        }
        Update: {
          content?: string
          context_snapshot?: Json | null
          conversation_id?: string
          created_at?: string | null
          id?: string
          role?: string
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
          confirmed_at: string | null
          confirmed_by: string | null
          daily_closing_id: string | null
          delivery_person: string | null
          id: string
          import_id: string
          is_confirmed: boolean
          order_number: string
          partner_order_number: string | null
          payment_method: string
          sale_date: string | null
          sale_time: string | null
          sales_channel: string | null
          total_amount: number
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          daily_closing_id?: string | null
          delivery_person?: string | null
          id?: string
          import_id: string
          is_confirmed?: boolean
          order_number: string
          partner_order_number?: string | null
          payment_method: string
          sale_date?: string | null
          sale_time?: string | null
          sales_channel?: string | null
          total_amount?: number
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          daily_closing_id?: string | null
          delivery_person?: string | null
          id?: string
          import_id?: string
          is_confirmed?: boolean
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
      salon_card_transactions: {
        Row: {
          brand: string | null
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
      voucher_adjustments: {
        Row: {
          audit_period_id: string
          created_at: string
          data: string
          descricao: string
          id: string
          operadora: string
          tipo: string | null
          valor: number
        }
        Insert: {
          audit_period_id: string
          created_at?: string
          data: string
          descricao: string
          id?: string
          operadora: string
          tipo?: string | null
          valor: number
        }
        Update: {
          audit_period_id?: string
          created_at?: string
          data?: string
          descricao?: string
          id?: string
          operadora?: string
          tipo?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "voucher_adjustments_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_expected_rates: {
        Row: {
          company: string
          expected_rate_pct: number
          has_anticipation: boolean
          notes: string | null
          updated_at: string | null
        }
        Insert: {
          company: string
          expected_rate_pct: number
          has_anticipation?: boolean
          notes?: string | null
          updated_at?: string | null
        }
        Update: {
          company?: string
          expected_rate_pct?: number
          has_anticipation?: boolean
          notes?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      voucher_imports: {
        Row: {
          audit_period_id: string
          file_name: string
          id: string
          imported_adjustments: number
          imported_at: string
          imported_by: string | null
          imported_items: number
          imported_lots: number
          operadora: string
          status: string
        }
        Insert: {
          audit_period_id: string
          file_name: string
          id?: string
          imported_adjustments?: number
          imported_at?: string
          imported_by?: string | null
          imported_items?: number
          imported_lots?: number
          operadora: string
          status?: string
        }
        Update: {
          audit_period_id?: string
          file_name?: string
          id?: string
          imported_adjustments?: number
          imported_at?: string
          imported_by?: string | null
          imported_items?: number
          imported_lots?: number
          operadora?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_imports_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_lot_items: {
        Row: {
          authorization_code: string | null
          card_number: string | null
          data_transacao: string
          gross_amount: number
          id: string
          lot_id: string
          maquinona_match_id: string | null
          match_status: string
          modalidade: string | null
          net_amount: number | null
        }
        Insert: {
          authorization_code?: string | null
          card_number?: string | null
          data_transacao: string
          gross_amount: number
          id?: string
          lot_id: string
          maquinona_match_id?: string | null
          match_status?: string
          modalidade?: string | null
          net_amount?: number | null
        }
        Update: {
          authorization_code?: string | null
          card_number?: string | null
          data_transacao?: string
          gross_amount?: number
          id?: string
          lot_id?: string
          maquinona_match_id?: string | null
          match_status?: string
          modalidade?: string | null
          net_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "voucher_lot_items_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "voucher_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_lot_items_maquinona_match_id_fkey"
            columns: ["maquinona_match_id"]
            isOneToOne: false
            referencedRelation: "audit_card_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_lots: {
        Row: {
          audit_period_id: string
          bb_deposit_id: string | null
          created_at: string
          data_corte: string | null
          data_pagamento: string
          external_id: string
          fee_admin: number | null
          fee_anticipation: number | null
          fee_management: number | null
          fee_other: number | null
          fee_total: number | null
          gross_amount: number
          id: string
          modalidade: string | null
          net_amount: number
          operadora: string
          raw_data: Json | null
          status: string
        }
        Insert: {
          audit_period_id: string
          bb_deposit_id?: string | null
          created_at?: string
          data_corte?: string | null
          data_pagamento: string
          external_id: string
          fee_admin?: number | null
          fee_anticipation?: number | null
          fee_management?: number | null
          fee_other?: number | null
          fee_total?: number | null
          gross_amount?: number
          id?: string
          modalidade?: string | null
          net_amount?: number
          operadora: string
          raw_data?: Json | null
          status?: string
        }
        Update: {
          audit_period_id?: string
          bb_deposit_id?: string | null
          created_at?: string
          data_corte?: string | null
          data_pagamento?: string
          external_id?: string
          fee_admin?: number | null
          fee_anticipation?: number | null
          fee_management?: number | null
          fee_other?: number | null
          fee_total?: number | null
          gross_amount?: number
          id?: string
          modalidade?: string | null
          net_amount?: number
          operadora?: string
          raw_data?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_lots_audit_period_id_fkey"
            columns: ["audit_period_id"]
            isOneToOne: false
            referencedRelation: "audit_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_lots_bb_deposit_id_fkey"
            columns: ["bb_deposit_id"]
            isOneToOne: false
            referencedRelation: "audit_bank_deposits"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
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
      classify_ifood_deposits: {
        Args: { p_period_id: string }
        Returns: undefined
      }
      classify_voucher_deposits: {
        Args: { p_period_id: string }
        Returns: undefined
      }
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
          total_liquido_declarado: number
          total_liquido_ifood: number
          total_promocao: number
          total_taxa_declarada: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      mark_password_changed: { Args: { p_user_id: string }; Returns: undefined }
      match_voucher_lots: { Args: { p_period_id: string }; Returns: Json }
      promote_from_waitlist: {
        Args: {
          p_freed_by: string
          p_is_after_18h?: boolean
          p_max_promotions?: number
          p_shift_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "operador"
        | "caixa_tele"
        | "caixa_salao"
        | "entregador"
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
      ],
    },
  },
} as const
