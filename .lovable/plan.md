## Correção do bug de escala (×100) na importação Maquinona

### 1. Patch em `supabase/functions/import-maquinona/index.ts`
Substituir `parseNumber` pela versão robusta que detecta corretamente o formato US-like usado nos XLSX iFood:

```typescript
function parseNumber(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[R$\s%]/g, '').trim();
  if (!s) return 0;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // BR clássico: 1.234,56
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // Só vírgula → decimal BR
    s = s.replace(',', '.');
  } else if (hasDot) {
    // Só ponto → US-like se exatamente 1 ponto e ≤2 casas (924.30)
    const parts = s.split('.');
    if (parts.length === 2 && parts[1].length <= 2) {
      // já é decimal US, mantém
    } else {
      // múltiplos pontos = milhar BR (1.234.567)
      s = s.replace(/\./g, '');
    }
  }
  const n = Number(s);
  return isFinite(n) ? n : 0;
}
```

`parseTaxRate` continua igual (já trata `%` separadamente).

### 2. NÃO mexer em `import-cresol` nem `import-bb`
Esses arquivos vêm de banco brasileiro (formato BR estrito: vírgula=decimal, ponto=milhar). Parsers atuais estão corretos para BR puro. Deixar intactos.

### 3. Deploy
Deployar apenas `import-maquinona`.

### 4. Limpar período Março/2026 via migration
```sql
DELETE FROM audit_periods WHERE month = 3 AND year = 2026;
```
Cascata limpa `audit_card_transactions`, `audit_bank_deposits`, `audit_imports`, `audit_daily_matches`, `audit_voucher_matches`, `audit_period_log`.

⚠️ Verificar antes se existem FKs com `ON DELETE CASCADE`. Se não houver, fazer DELETE explícito em ordem:
1. `audit_period_log`
2. `audit_daily_matches`
3. `audit_voucher_matches`
4. `audit_bank_deposits`
5. `audit_card_transactions`
6. `audit_imports`
7. `audit_periods`

### 5. Validação pós-execução
- Confirmar build limpo
- Confirmar período Março/2026 zerado (`SELECT count(*) FROM audit_periods WHERE month=3 AND year=2026` → 0)
- Liberar usuário para re-importar XLSX (criar período novo + Maquinona Jan/Fev/Mar + Cresol Fev/Mar/Abr + BB Fev/Mar/Abr)

### O que NÃO faço
- ❌ Não toco em `import-cresol` nem `import-bb`
- ❌ Não rodo UPDATE/100 nos dados existentes (re-importação substitui)
- ❌ Não apago arquivos XLSX do usuário
- ❌ Não mexo no algoritmo de match (RPCs `classify_*`)
