import * as pdfjsLib from 'pdfjs-dist';
// Importa o worker como URL (Vite resolve em build).
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

(pdfjsLib.GlobalWorkerOptions as any).workerSrc = workerSrc;

// Concatena TODOS os tokens do PDF em uma única string com espaços, ordenados
// por Y desc (top→bottom da página) e X asc (left→right na linha). Não tenta
// reconstruir "linhas" — o backend usa regex globais sobre a string contínua,
// o que é mais robusto pra PDFs tabulares onde colunas têm Y ligeiramente
// diferentes (que romperiam um agrupamento por Y arredondado).
export async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const allTokens: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = (content.items as any[]).filter(it => it.str);
    items.sort((a, b) => {
      const ya = a.transform[5];
      const yb = b.transform[5];
      if (Math.abs(ya - yb) > 3) return yb - ya;
      return a.transform[4] - b.transform[4];
    });
    for (const it of items) {
      const s = it.str.trim();
      if (s) allTokens.push(s);
    }
    allTokens.push('\n'); // marcador de fim de página (apenas pra debug — backend trata como espaço)
  }
  return allTokens.join(' ');
}
