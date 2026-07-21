// Combobox de "tag": escolhe uma opção existente OU cria uma nova na hora.
// Usado nos campos Categoria, Método, Conta/Banco, Fornecedor e Descrição dos Lançamentos.
import { useState } from 'react';
import { Check, ChevronsUpDown, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';

export function TagCombobox({
  value,
  onChange,
  options,
  onCreate,
  placeholder = 'Selecionar',
  allowClear = true,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onCreate?: (v: string) => Promise<void> | void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const trimmed = search.trim();
  const exists = options.some((o) => o.toLowerCase() === trimmed.toLowerCase());

  async function handleCreate() {
    if (!trimmed) return;
    setCreating(true);
    try {
      if (onCreate) await onCreate(trimmed);
      onChange(trimmed);
      setOpen(false);
      setSearch('');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground')}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar ou digitar novo…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>
              {trimmed ? 'Nenhuma opção. Crie uma abaixo.' : 'Nenhuma opção ainda.'}
            </CommandEmpty>
            {allowClear && value && (
              <CommandGroup>
                <CommandItem
                  value="__clear__"
                  onSelect={() => { onChange(''); setOpen(false); setSearch(''); }}
                  className="text-muted-foreground"
                >
                  <X className="mr-2 h-4 w-4" />
                  Limpar
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o}
                  value={o}
                  onSelect={() => { onChange(o); setOpen(false); setSearch(''); }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === o ? 'opacity-100' : 'opacity-0')} />
                  {o}
                </CommandItem>
              ))}
            </CommandGroup>
            {trimmed && !exists && (
              <CommandGroup>
                <CommandItem value={`__create__${trimmed}`} onSelect={handleCreate} disabled={creating}>
                  <Plus className="mr-2 h-4 w-4" />
                  {creating ? 'Criando…' : <>Criar “{trimmed}”</>}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
