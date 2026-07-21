// Filtro de múltipla seleção (Conta / Método / Categoria dos Lançamentos).
// Nada selecionado = "Todas". Um ou mais = filtra por aqueles valores.
import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';

export function MultiSelectFilter({
  values,
  onChange,
  options,
  allLabel = 'Todas',
  placeholder = 'Buscar…',
}: {
  values: string[];
  onChange: (v: string[]) => void;
  options: string[];
  allLabel?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);

  function toggle(opt: string) {
    if (values.includes(opt)) onChange(values.filter((v) => v !== opt));
    else onChange([...values, opt]);
  }

  const label =
    values.length === 0
      ? allLabel
      : values.length === 1
        ? values[0]
        : `${values.length} selecionadas`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>Nada encontrado.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                onSelect={() => onChange([])}
                className={cn(values.length === 0 && 'font-medium')}
              >
                <Check className={cn('mr-2 h-4 w-4', values.length === 0 ? 'opacity-100' : 'opacity-0')} />
                {allLabel}
              </CommandItem>
              {options.map((o) => {
                const sel = values.includes(o);
                return (
                  <CommandItem key={o} value={o} onSelect={() => toggle(o)}>
                    <Check className={cn('mr-2 h-4 w-4', sel ? 'opacity-100' : 'opacity-0')} />
                    {o}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {values.length > 0 && (
            <div className="flex items-center justify-between gap-2 border-t p-2">
              <span className="text-xs text-muted-foreground flex flex-wrap gap-1">
                {values.slice(0, 3).map((v) => (
                  <Badge key={v} variant="secondary" className="text-[10px]">{v}</Badge>
                ))}
                {values.length > 3 && <span className="text-[10px]">+{values.length - 3}</span>}
              </span>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onChange([])}>
                Limpar
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
