import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import type { MachineRegistryEntry } from '@/hooks/useMachineRegistry';

interface SerialSuggestion {
  serial: string;
  count: number;
  lastUsed: string | null;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  suggestions: SerialSuggestion[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  registry?: Map<string, MachineRegistryEntry>;
}

function formatLastUsed(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `usado em ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function SerialAutocomplete({ value, onChange, suggestions, disabled, className, placeholder, registry }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build combined list: registry entries + historical suggestions
  const filtered = (() => {
    const query = (value || '').toLowerCase();
    const results: { serial: string; friendlyName: string | null; lastUsed: string | null; count: number }[] = [];
    const seen = new Set<string>();

    // If registry exists, include registry entries
    if (registry) {
      registry.forEach((entry, serial) => {
        const matchesSerial = serial.toLowerCase().startsWith(query);
        const matchesName = entry.friendly_name.toLowerCase().includes(query);
        if (query.length === 0 || matchesSerial || matchesName) {
          results.push({ serial, friendlyName: entry.friendly_name, lastUsed: null, count: 999 });
          seen.add(serial);
        }
      });
    }

    // Add historical suggestions not in registry
    if (query.length >= 2) {
      for (const s of suggestions) {
        if (seen.has(s.serial)) continue;
        if (s.serial.toLowerCase().startsWith(query)) {
          results.push({ serial: s.serial, friendlyName: null, lastUsed: s.lastUsed, count: s.count });
          seen.add(s.serial);
        }
      }
    }

    // Sort: registry first (by name), then by count
    results.sort((a, b) => {
      if (a.friendlyName && !b.friendlyName) return -1;
      if (!a.friendlyName && b.friendlyName) return 1;
      if (a.friendlyName && b.friendlyName) return a.friendlyName.localeCompare(b.friendlyName);
      return b.count - a.count;
    });

    return results.slice(0, 10);
  })();

  const shouldOpen = filtered.length > 0 && (value.length >= 2 || (registry && registry.size > 0 && value.length === 0));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { if (shouldOpen) setOpen(true); }}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-1 w-64 bg-[#1A1A1A] border border-[#333] rounded-lg shadow-lg overflow-hidden max-h-60 overflow-y-auto">
          {filtered.map(s => (
            <button
              key={s.serial}
              type="button"
              className="w-full text-left px-3 py-2 text-xs text-white hover:bg-[hsl(24,95%,53%)]/20 flex items-center justify-between transition-colors"
              onClick={() => { onChange(s.serial); setOpen(false); }}
            >
              <span className="flex items-center gap-1.5">
                {s.friendlyName ? (
                  <>
                    <span className="font-bold">{s.friendlyName}</span>
                    <span className="font-mono text-[10px] text-gray-400">{s.serial}</span>
                  </>
                ) : (
                  <span className="font-mono">{s.serial}</span>
                )}
              </span>
              {s.lastUsed && !s.friendlyName && (
                <span className="text-[10px] text-gray-400 ml-2">{formatLastUsed(s.lastUsed)}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
