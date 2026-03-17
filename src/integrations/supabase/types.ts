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
      daily_closings: {
        Row: {
          closing_date: string
          created_at: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          closing_date: string
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          closing_date?: string
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "operador"
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
      app_role: ["admin", "operador"],
    },
  },
} as const
