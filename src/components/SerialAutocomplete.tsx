import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';

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
}

function formatLastUsed(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `usado em ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function SerialAutocomplete({ value, onChange, suggestions, disabled, className, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = value.length >= 2
    ? suggestions
        .filter(s => s.serial.toLowerCase().startsWith(value.toLowerCase()))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
    : [];

  useEffect(() => {
    setOpen(filtered.length > 0 && value.length >= 2);
  }, [value, filtered.length]);

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
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { if (filtered.length > 0 && value.length >= 2) setOpen(true); }}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-1 w-56 bg-[#1A1A1A] border border-[#333] rounded-lg shadow-lg overflow-hidden">
          {filtered.map(s => (
            <button
              key={s.serial}
              type="button"
              className="w-full text-left px-3 py-2 text-xs font-mono text-white hover:bg-[hsl(24,95%,53%)]/20 flex items-center justify-between transition-colors"
              onClick={() => { onChange(s.serial); setOpen(false); }}
            >
              <span>{s.serial}</span>
              {s.lastUsed && (
                <span className="text-[10px] text-gray-400 ml-2">{formatLastUsed(s.lastUsed)}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
