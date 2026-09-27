"use client";

// Reads a PDF entirely in the browser (the file never leaves the device):
// text per page (with paragraph breaks) + a JPEG of pages that contain images or have no text layer.

export interface ParsedPage {
  pageNo: number;
  text: string;
  image?: string;
}

export interface ParsedPdf {
  title: string | null;
  pageCount: number;
  pages: AsyncGenerator<ParsedPage>;
}

const MAX_IMAGE_WIDTH = 1400;

export async function parsePdf(file: File): Promise<ParsedPdf> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"; // copied from pdfjs-dist/build (postinstall)
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const meta = await doc.getMetadata().catch(() => null);
  const info = meta?.info as { Title?: string } | undefined;
  const title = info?.Title?.trim() || file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() || null;
  const IMAGE_OPS = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject]);

  async function* pages(): AsyncGenerator<ParsedPage> {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      let lastY: number | null = null;
      let lineHeight = 12;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5] as number;
        const h = Math.abs(item.height) || lineHeight;
        if (lastY !== null && Math.abs(lastY - y) > h * 1.8) text += "\n\n"; // big vertical gap = new paragraph
        else if (lastY !== null && Math.abs(lastY - y) > h * 0.5 && !text.endsWith("\n")) text += "\n";
        text += item.str;
        if (item.hasEOL) text += "\n";
        else if (item.str && !item.str.endsWith(" ")) text += " ";
        lastY = y;
        lineHeight = h;
      }
      text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

      const ops = await page.getOperatorList();
      const hasImages = ops.fnArray.some((fn) => IMAGE_OPS.has(fn));
      let image: string | undefined;
      if (hasImages || text.length < 40) {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, MAX_IMAGE_WIDTH / base.width) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, viewport }).promise;
        image = canvas.toDataURL("image/jpeg", 0.8);
      }
      page.cleanup();
      yield { pageNo: n, text, image };
    }
    await task.destroy();
  }

  return { title, pageCount: doc.numPages, pages: pages() };
}
