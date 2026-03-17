
-- Create daily_closings table
CREATE TABLE public.daily_closings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  closing_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(closing_date, user_id)
);

-- Enable RLS
ALTER TABLE public.daily_closings ENABLE ROW LEVEL SECURITY;

-- RLS policies for daily_closings
CREATE POLICY "Users can view their own closings" ON public.daily_closings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create closings" ON public.daily_closings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own closings" ON public.daily_closings FOR UPDATE USING (auth.uid() = user_id);

-- Add daily_closing_id to imports
ALTER TABLE public.imports ADD COLUMN daily_closing_id UUID REFERENCES public.daily_closings(id);
ALTER TABLE public.imports ADD COLUMN new_rows INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.imports ADD COLUMN duplicate_rows INTEGER NOT NULL DEFAULT 0;

-- Add sale_date and daily_closing_id to imported_orders
ALTER TABLE public.imported_orders ADD COLUMN sale_date DATE;
ALTER TABLE public.imported_orders ADD COLUMN daily_closing_id UUID REFERENCES public.daily_closings(id);
