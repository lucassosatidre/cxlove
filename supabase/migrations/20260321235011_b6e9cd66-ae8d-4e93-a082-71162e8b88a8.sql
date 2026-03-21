
ALTER TABLE public.daily_closings DROP CONSTRAINT IF EXISTS daily_closings_closing_date_user_id_key;
CREATE UNIQUE INDEX daily_closings_closing_date_user_id_is_test_key ON public.daily_closings (closing_date, user_id, is_test);
