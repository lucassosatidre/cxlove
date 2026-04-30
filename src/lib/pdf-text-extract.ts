import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

(pdfjsLib.GlobalWorkerOptions as any).workerSrc = workerSrc;

// Concatena todos os tokens em uma string contínua. Estratégia:
//   1. Ordena items globalmente por Y desc (top→bottom) com tolerância de
//      ~6 unidades — items na MESMA linha visual ficam juntos mesmo com Y
//      ligeiramente diferente (cells multi-linha do PDF tabular do Ticket).
//   2. Dentro do bucket de mesma "linha", ordena por X asc.
//   3. Junta tudo com espaços, sem newlines internos. O backend usa regex
//      globais sobre a string contínua + fallback computacional.
export async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const allTokens: string[] = [];

  const Y_TOLERANCE = 6;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = (content.items as any[])
      .filter(it => it.str)
      .map(it => ({ str: it.str as string, x: it.transform[4] as number, y: it.transform[5] as number }));

    // Bucketeia items por Y (clustering com tolerância)
    items.sort((a, b) => b.y - a.y); // top→bottom inicial
    const buckets: Array<{ y: number; items: typeof items }> = [];
    for (const it of items) {
      const last = buckets[buckets.length - 1];
      if (last && Math.abs(last.y - it.y) <= Y_TOLERANCE) {
        last.items.push(it);
      } else {
        buckets.push({ y: it.y, items: [it] });
      }
    }

    // Cada bucket = uma "linha visual". Ordena por X asc dentro do bucket.
    for (const b of buckets) {
      b.items.sort((a, b) => a.x - b.x);
      for (const it of b.items) {
        const s = it.str.trim();
        if (s) allTokens.push(s);
      }
    }
  }
  return allTokens.join(' ');
}
