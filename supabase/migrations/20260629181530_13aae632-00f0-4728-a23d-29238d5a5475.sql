DROP POLICY IF EXISTS "Admins can manage vault closings" ON public.vault_daily_closings;
DO $$ BEGIN CREATE POLICY "vigia_select_vault_daily_closings" ON public.vault_daily_closings FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_insert_vault_daily_closings" ON public.vault_daily_closings FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_vault_daily_closings" ON public.vault_daily_closings FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_vault_daily_closings" ON public.vault_daily_closings FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins can manage vault expenses" ON public.vault_misc_expenses;
DO $$ BEGIN CREATE POLICY "vigia_select_vault_misc_expenses" ON public.vault_misc_expenses FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_insert_vault_misc_expenses" ON public.vault_misc_expenses FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_vault_misc_expenses" ON public.vault_misc_expenses FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_vault_misc_expenses" ON public.vault_misc_expenses FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins can manage cash expectations" ON public.cash_expectations;
DO $$ BEGIN CREATE POLICY "vigia_insert_cash_expectations" ON public.cash_expectations FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_cash_expectations" ON public.cash_expectations FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_cash_expectations" ON public.cash_expectations FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins can insert cash snapshots" ON public.cash_snapshots;
DROP POLICY IF EXISTS "Users can insert salon cash snapshots" ON public.cash_snapshots;
DROP POLICY IF EXISTS "Users can insert tele cash snapshots" ON public.cash_snapshots;
DROP POLICY IF EXISTS "Admins can update all cash snapshots" ON public.cash_snapshots;
DROP POLICY IF EXISTS "Users can update salon cash snapshots" ON public.cash_snapshots;
DROP POLICY IF EXISTS "Users can update their own cash snapshots" ON public.cash_snapshots;
DROP POLICY IF EXISTS "Admins can delete all cash snapshots" ON public.cash_snapshots;
DROP POLICY IF EXISTS "Users can delete salon cash snapshots" ON public.cash_snapshots;
DROP POLICY IF EXISTS "Users can delete their own cash snapshots" ON public.cash_snapshots;
DO $$ BEGIN CREATE POLICY "vigia_insert_cash_snapshots" ON public.cash_snapshots FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_cash_snapshots" ON public.cash_snapshots FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_cash_snapshots" ON public.cash_snapshots FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Users can create closings" ON public.daily_closings;
DO $$ BEGIN CREATE POLICY "vigia_insert_daily_closings" ON public.daily_closings FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Users can create imports" ON public.imports;
DO $$ BEGIN CREATE POLICY "vigia_insert_imports" ON public.imports FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins can insert card transactions" ON public.card_transactions;
DROP POLICY IF EXISTS "Users can insert their own card transactions" ON public.card_transactions;
DROP POLICY IF EXISTS "Admins can update all card transactions" ON public.card_transactions;
DROP POLICY IF EXISTS "Users can update their own card transactions" ON public.card_transactions;
DROP POLICY IF EXISTS "Admins can delete all card transactions" ON public.card_transactions;
DROP POLICY IF EXISTS "Users can delete their own card transactions" ON public.card_transactions;
DO $$ BEGIN CREATE POLICY "vigia_insert_card_transactions" ON public.card_transactions FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_card_transactions" ON public.card_transactions FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_card_transactions" ON public.card_transactions FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Users can insert machine readings" ON public.machine_readings;
DROP POLICY IF EXISTS "Users can update their machine readings" ON public.machine_readings;
DROP POLICY IF EXISTS "Users can delete their machine readings" ON public.machine_readings;
DO $$ BEGIN CREATE POLICY "vigia_insert_machine_readings" ON public.machine_readings FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_machine_readings" ON public.machine_readings FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_machine_readings" ON public.machine_readings FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins can manage machine registry" ON public.machine_registry;
DO $$ BEGIN CREATE POLICY "vigia_insert_machine_registry" ON public.machine_registry FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_machine_registry" ON public.machine_registry FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_machine_registry" ON public.machine_registry FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins can insert salon closings" ON public.salon_closings;
DROP POLICY IF EXISTS "Users can create salon closings" ON public.salon_closings;
DO $$ BEGIN CREATE POLICY "vigia_insert_salon_closings" ON public.salon_closings FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Users can create salon imports" ON public.salon_imports;
DO $$ BEGIN CREATE POLICY "vigia_insert_salon_imports" ON public.salon_imports FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins can insert salon card transactions" ON public.salon_card_transactions;
DROP POLICY IF EXISTS "Users can insert their salon card transactions" ON public.salon_card_transactions;
DROP POLICY IF EXISTS "Admins can update all salon card transactions" ON public.salon_card_transactions;
DROP POLICY IF EXISTS "Users can update their salon card transactions" ON public.salon_card_transactions;
DROP POLICY IF EXISTS "Admins can delete all salon card transactions" ON public.salon_card_transactions;
DROP POLICY IF EXISTS "Users can delete their salon card transactions" ON public.salon_card_transactions;
DO $$ BEGIN CREATE POLICY "vigia_insert_salon_card_transactions" ON public.salon_card_transactions FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_salon_card_transactions" ON public.salon_card_transactions FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_salon_card_transactions" ON public.salon_card_transactions FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins full access delivery_shifts" ON public.delivery_shifts;
DO $$ BEGIN CREATE POLICY "vigia_insert_delivery_shifts" ON public.delivery_shifts FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_delivery_shifts" ON public.delivery_shifts FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_delivery_shifts" ON public.delivery_shifts FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Entregador can insert own checkins" ON public.delivery_checkins;
DROP POLICY IF EXISTS "Entregador can update own checkins" ON public.delivery_checkins;
DROP POLICY IF EXISTS "Operators can update delivery_checkins" ON public.delivery_checkins;
DROP POLICY IF EXISTS "Admins full access delivery_checkins" ON public.delivery_checkins;
DO $$ BEGIN CREATE POLICY "vigia_insert_delivery_checkins" ON public.delivery_checkins FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_delivery_checkins" ON public.delivery_checkins FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_delivery_checkins" ON public.delivery_checkins FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins manage audit_periods" ON public.audit_periods;
DO $$ BEGIN CREATE POLICY "vigia_insert_audit_periods" ON public.audit_periods FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_audit_periods" ON public.audit_periods FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_audit_periods" ON public.audit_periods FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins manage audit_period_log" ON public.audit_period_log;
DO $$ BEGIN CREATE POLICY "vigia_insert_audit_period_log" ON public.audit_period_log FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_audit_period_log" ON public.audit_period_log FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_audit_period_log" ON public.audit_period_log FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins manage audit_imports" ON public.audit_imports;
DO $$ BEGIN CREATE POLICY "vigia_insert_audit_imports" ON public.audit_imports FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_audit_imports" ON public.audit_imports FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_audit_imports" ON public.audit_imports FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins manage cashflow_imports" ON public.cashflow_imports;
DO $$ BEGIN CREATE POLICY "vigia_insert_cashflow_imports" ON public.cashflow_imports FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_cashflow_imports" ON public.cashflow_imports FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_cashflow_imports" ON public.cashflow_imports FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins manage clau_actions_log" ON public.clau_actions_log;
DO $$ BEGIN CREATE POLICY "vigia_insert_clau_actions_log" ON public.clau_actions_log FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_clau_actions_log" ON public.clau_actions_log FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_clau_actions_log" ON public.clau_actions_log FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Authenticated users can insert label orders" ON public.label_orders;
DO $$ BEGIN CREATE POLICY "vigia_insert_label_orders" ON public.label_orders FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_label_orders" ON public.label_orders FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins manage sofia_orders" ON public.sofia_orders;
DO $$ BEGIN CREATE POLICY "vigia_insert_sofia_orders" ON public.sofia_orders FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_sofia_orders" ON public.sofia_orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_sofia_orders" ON public.sofia_orders FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins manage sofia_campaigns" ON public.sofia_campaigns;
DO $$ BEGIN CREATE POLICY "vigia_insert_sofia_campaigns" ON public.sofia_campaigns FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_sofia_campaigns" ON public.sofia_campaigns FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_sofia_campaigns" ON public.sofia_campaigns FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Admins manage sofia_campaign_targets" ON public.sofia_campaign_targets;
DO $$ BEGIN CREATE POLICY "vigia_insert_sofia_campaign_targets" ON public.sofia_campaign_targets FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_update_sofia_campaign_targets" ON public.sofia_campaign_targets FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "vigia_delete_sofia_campaign_targets" ON public.sofia_campaign_targets FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;