import { CanvasHTMLAttributes, memo, useEffect, useRef } from 'react';
import { decode } from 'blurhash';

export type BlurhashCanvasProps = Omit<
  CanvasHTMLAttributes<HTMLCanvasElement>,
  'width' | 'height'
> & {
  hash: string;
  width?: number;
  height?: number;
  punch?: number;
};

/**
 * Paint a decoded blurhash into a canvas — the placeholder shown in an image or
 * video message until the real media loads.
 *
 * Replaces `react-blurhash`, which was a thin wrapper over `blurhash`, already a
 * direct dependency of this project. Two intentional differences from that
 * package:
 *
 * - `punch` is not spread onto the DOM node. react-blurhash omitted only
 *   hash/width/height before spreading the rest, so it emitted a stray
 *   `punch="1"` attribute on every canvas.
 * - `decode` is guarded. Both call sites filter through `validBlurHash` first,
 *   so this should not fire; but this renders inside message content, and an
 *   uncaught throw here would take down the whole timeline rather than one
 *   thumbnail. On failure the canvas is simply left blank.
 */
export const BlurhashCanvas = memo(
  ({ hash, width = 128, height = 128, punch, ...props }: BlurhashCanvasProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      try {
        const pixels = decode(hash, width, height, punch);
        const imageData = ctx.createImageData(width, height);
        imageData.data.set(pixels);
        ctx.putImageData(imageData, 0, 0);
      } catch {
        ctx.clearRect(0, 0, width, height);
      }
    }, [hash, width, height, punch]);

    return <canvas ref={canvasRef} width={width} height={height} {...props} />;
  },
);
