import * as pdfjs from 'pdfjs-dist';

// Map worker to the public CDN URL to avoid bundle issues
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

export interface PageContent {
  pageNumber: number;
  text: string;
}

export async function extractTextFromPDF(file: File, onProgress?: (progress: number) => void): Promise<PageContent[]> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument(arrayBuffer);
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const pages: PageContent[] = [];

  const BATCH_SIZE = 5;
  for (let i = 1; i <= numPages; i += BATCH_SIZE) {
    const end = Math.min(i + BATCH_SIZE - 1, numPages);
    const batch = [];
    
    for (let j = i; j <= end; j++) {
      batch.push((async () => {
        const page = await pdf.getPage(j);
        const textContent = await page.getTextContent();
        const text = textContent.items
          .map((item: any) => item.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        // Clean up page resources to save memory
        page.cleanup();

        return {
          pageNumber: j,
          text: text || `[Empty page ${j}]`
        };
      })());
    }
    
    const results = await Promise.all(batch);
    pages.push(...results);
    
    if (onProgress) {
      onProgress(Math.round((end / numPages) * 100));
    }
    
    // Yield to the event loop to prevent UI freezing
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  // Destroy the PDF instance to free up memory
  await pdf.destroy();

  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}
