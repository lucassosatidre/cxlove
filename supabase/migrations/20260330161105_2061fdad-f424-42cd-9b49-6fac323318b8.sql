
-- Step 1: Make horario_inicio and horario_fim NOT NULL (all existing rows already have values)
ALTER TABLE public.delivery_shifts ALTER COLUMN horario_inicio SET NOT NULL;
ALTER TABLE public.delivery_shifts ALTER COLUMN horario_fim SET NOT NULL;

-- Step 2: Drop the periodo column (no longer needed - shifts defined by horario)
ALTER TABLE public.delivery_shifts DROP COLUMN IF EXISTS periodo;

-- Step 3: Add unique constraint on (data, horario_inicio) to prevent duplicate time slots
ALTER TABLE public.delivery_shifts ADD CONSTRAINT delivery_shifts_data_horario_unique UNIQUE (data, horario_inicio);
