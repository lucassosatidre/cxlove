import * as pdfjsLib from 'pdfjs-dist';
// Importa o worker como URL (Vite resolve em build).
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

(pdfjsLib.GlobalWorkerOptions as any).workerSrc = workerSrc;

export async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lines = new Map<number, string[]>();
    for (const item of content.items as any[]) {
      const y = Math.round(item.transform[5]);
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y)!.push(item.str);
    }
    const sortedKeys = Array.from(lines.keys()).sort((a, b) => b - a);
    const lineTexts = sortedKeys.map(k => lines.get(k)!.join(' '));
    pages.push(lineTexts.join('\n'));
  }
  return pages.join('\n');
}
