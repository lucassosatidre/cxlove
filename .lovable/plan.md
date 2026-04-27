## Causa raiz (verificada)

O XLSX gerado pelo portal Ticket usa prefixo XML namespace `x:` em todas as tags (`<x:row>`, `<x:c>`, `<x:v>`, `<x:t>`, `<x:si>`). A SheetJS no Deno lê parcialmente esse formato — retorna 37 linhas de um arquivo com 224. Validado: parser XML manual extrai 223 linhas perfeitamente do mesmo arquivo.

## Mudança

**Arquivo único:** `supabase/functions/import-voucher-ticket/index.ts`

Substituir o bloco que faz `XLSX.read` por parser XML manual usando `fflate` (ZIP puro JS, ~30KB) + regex que aceita tags com ou sem prefixo `x:`.

### Etapas do novo parser

1. Decodificar `file_base64` em `Uint8Array`.
2. `fflate.unzipSync` para extrair o XLSX (que é um ZIP).
3. Ler `xl/sharedStrings.xml` e `xl/worksheets/sheet1.xml` como UTF-8.
4. Parse de shared strings com regex `<(?:x:)?si>...<(?:x:)?t>` (aceita prefixo).
5. Parse de cada `<row r="N">` e cada célula `<c r="A14" t="s">`:
   - converter referência tipo `A14` → índice de coluna 0-based;
   - se `t="s"`, lookup na shared strings table; senão valor literal;
   - decodificar entidades XML básicas (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`).
6. Montar `rows: any[][]` na ordem de `rowNum`, preenchendo gaps com `null`.

Logs novos: `[TICKET] shared strings carregadas: N` e `[TICKET] parseado via XML manual, rows = N maxCol = M`.

### O que NÃO muda

- Frontend (`VoucherSettlementsImportSection.tsx`) — já manda `file_base64` via `FileReader.readAsDataURL`.
- Loop de estado-máquina do parser (header → COMPRA → Subtotal → Tarifas → Líquido) — funciona sobre `rows` e foi validado em Python.
- `parseDateBR` em `_shared/voucher-utils.ts` — datas vêm como string `DD/MM/YYYY` e já são tratadas.
- Outras edge functions (Pluxee, Alelo, VR).

### Deploy

Apenas `import-voucher-ticket`.

## Validação esperada

Logs após Lucas reimportar o arquivo original:
```
[TICKET] shared strings carregadas: ~419
[TICKET] parseado via XML manual, rows = 224 maxCol = 14
[TICKET] lots parseados = 30
```

Tela `/admin/auditoria/voucher-settlements?period=Mar/2026`, card Ticket: ~13 lotes / ~38 itens importados, taxa efetiva ~12%.