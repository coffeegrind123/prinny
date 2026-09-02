import { useCallback } from 'react';
import type * as PdfJsDist from 'pdfjs-dist';
import type { GetViewportParameters } from 'pdfjs-dist/types/src/display/api';
import { useAsyncCallback } from '../hooks/useAsyncCallback';
import { trimTrailingSlash } from '../utils/common';

const assetBase = () => trimTrailingSlash(import.meta.env.BASE_URL);

export const usePdfJSLoader = () =>
  useAsyncCallback(
    useCallback(async () => {
      const pdf = await import('pdfjs-dist');
      pdf.GlobalWorkerOptions.workerSrc = `${assetBase()}/pdf.worker.min.js`;
      return pdf;
    }, []),
  );

export const usePdfDocumentLoader = (pdfJS: typeof PdfJsDist | undefined, src: string) =>
  useAsyncCallback(
    useCallback(async () => {
      if (!pdfJS) {
        throw new Error('PdfJS is not loaded');
      }
      // pdfjs-dist 6 dropped the bare-string overload of getDocument; the URL
      // now has to be named explicitly in DocumentInitParameters.
      //
      // `wasmUrl`/`iccUrl` point at the assets vite.config.js copies out of the
      // package. Both default to a path relative to the worker, which does not
      // exist in this bundle layout — leaving them unset silently degrades
      // JBIG2 (scanned documents) and JPEG 2000 images to blank output.
      const doc = await pdfJS.getDocument({
        url: src,
        wasmUrl: `${assetBase()}/pdfjs/wasm/`,
        iccUrl: `${assetBase()}/pdfjs/iccs/`,
      }).promise;
      return doc;
    }, [pdfJS, src]),
  );

export const createPage = async (
  doc: PdfJsDist.PDFDocumentProxy,
  pNo: number,
  opts: GetViewportParameters,
): Promise<HTMLCanvasElement> => {
  const page = await doc.getPage(pNo);
  const pageViewport = page.getViewport(opts);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) throw new Error('failed to render page.');

  canvas.width = pageViewport.width;
  canvas.height = pageViewport.height;

  page.render({
    canvas,
    canvasContext: context,
    viewport: pageViewport,
  });

  return canvas;
};
