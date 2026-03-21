import { FlaskConical } from 'lucide-react';

export default function TestBanner() {
  return (
    <div className="bg-amber-500/15 border border-amber-500/30 rounded-lg px-4 py-2.5 mb-4 flex items-center gap-3">
      <FlaskConical className="h-5 w-5 text-amber-600 shrink-0" />
      <div>
        <span className="text-sm font-semibold text-amber-700">AMBIENTE DE TESTE</span>
        <span className="text-xs text-amber-600/80 ml-2">Alterações aqui não afetam a tele oficial</span>
      </div>
    </div>
  );
}
