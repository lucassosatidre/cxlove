import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';

interface Props {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export default function PersonAutocomplete({ value, onChange, suggestions, disabled, className, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = focused
    ? (value.length === 0
        ? suggestions.slice(0, 10)
        : suggestions
            .filter(s => s.toLowerCase().includes(value.toLowerCase()))
            .slice(0, 10)
      )
    : [];

  useEffect(() => {
    setOpen(filtered.length > 0 && focused);
  }, [value, filtered.length, focused]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFocused(false);
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
        onFocus={() => { setFocused(true); setOpen(true); }}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-1 w-56 bg-[#1A1A1A] border border-[#333] rounded-lg shadow-lg overflow-hidden max-h-60 overflow-y-auto">
          {filtered.map(name => (
            <button
              key={name}
              type="button"
              className="w-full text-left px-3 py-2 text-xs text-white hover:bg-[hsl(24,95%,53%)]/20 transition-colors"
              onClick={() => { onChange(name); setOpen(false); setFocused(false); }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
