import {
  KeyboardEventHandler,
  PointerEventHandler,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import classNames from 'classnames';
import { Box, Button, Header, Icon, IconButton, Icons, Text, as } from 'folds';
import { useResizeObserver } from '../../hooks/useResizeObserver';
import * as css from './ImageEditor.css';

export type ImageEditorProps = {
  name: string;
  url: string;
  requestClose: () => void;
  aspectRatio?: number;
  outputWidth?: number;
  onApply?: (file: File) => void;
};

type Size = {
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

type CropGeometry = {
  displayX: number;
  displayY: number;
  displayWidth: number;
  displayHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  centerX: number;
  centerY: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getCropGeometry = (
  stage: Size,
  image: Size,
  aspectRatio: number,
  zoom: number,
  center: Point,
): CropGeometry | undefined => {
  if (!stage.width || !stage.height || !image.width || !image.height) return undefined;

  const imageRatio = image.width / image.height;
  const stageRatio = stage.width / stage.height;
  const displayWidth = imageRatio > stageRatio ? stage.width : stage.height * imageRatio;
  const displayHeight = imageRatio > stageRatio ? stage.width / imageRatio : stage.height;
  const displayX = (stage.width - displayWidth) / 2;
  const displayY = (stage.height - displayHeight) / 2;

  const cropWidthAtOne =
    displayWidth / displayHeight > aspectRatio ? displayHeight * aspectRatio : displayWidth;
  const cropHeightAtOne = cropWidthAtOne / aspectRatio;
  const cropWidth = cropWidthAtOne / zoom;
  const cropHeight = cropHeightAtOne / zoom;
  const halfWidth = cropWidth / displayWidth / 2;
  const halfHeight = cropHeight / displayHeight / 2;
  const centerX = clamp(center.x, halfWidth, 1 - halfWidth);
  const centerY = clamp(center.y, halfHeight, 1 - halfHeight);

  return {
    displayX,
    displayY,
    displayWidth,
    displayHeight,
    cropX: displayX + centerX * displayWidth - cropWidth / 2,
    cropY: displayY + centerY * displayHeight - cropHeight / 2,
    cropWidth,
    cropHeight,
    centerX,
    centerY,
  };
};

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });

const canvasToBlob = (canvas: HTMLCanvasElement, type: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to crop image'))),
      type,
    );
  });

export const ImageEditor = as<'div', ImageEditorProps>(
  (
    { className, name, url, requestClose, aspectRatio = 1, outputWidth = 1024, onApply, ...props },
    ref,
  ) => {
    const stageRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<
      | {
          pointerId: number;
          clientX: number;
          clientY: number;
          center: Point;
        }
      | undefined
    >(undefined);
    const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 });
    const [imageSize, setImageSize] = useState<Size>({ width: 0, height: 0 });
    const [zoom, setZoom] = useState(1);
    const [center, setCenter] = useState<Point>({ x: 0.5, y: 0.5 });
    const [applying, setApplying] = useState(false);
    const [error, setError] = useState<string>();
    useResizeObserver(
      useCallback((entries) => {
        const entry = entries[0];
        if (entry) {
          const { width, height } = entry.contentRect;
          setStageSize((current) =>
            current.width === width && current.height === height ? current : { width, height },
          );
        }
      }, []),
      useCallback(() => stageRef.current, []),
    );

    const crop = useMemo(
      () => getCropGeometry(stageSize, imageSize, aspectRatio, zoom, center),
      [stageSize, imageSize, aspectRatio, zoom, center],
    );

    const setClampedCenter = useCallback(
      (nextCenter: Point) => {
        const geometry = getCropGeometry(stageSize, imageSize, aspectRatio, zoom, nextCenter);
        if (geometry) setCenter({ x: geometry.centerX, y: geometry.centerY });
      },
      [stageSize, imageSize, aspectRatio, zoom],
    );

    const handleCropPointerDown: PointerEventHandler<HTMLButtonElement> = (event) => {
      if (!crop) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        center: { x: crop.centerX, y: crop.centerY },
      };
    };

    const handleCropPointerMove: PointerEventHandler<HTMLButtonElement> = (event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !crop) return;
      setClampedCenter({
        x: drag.center.x + (event.clientX - drag.clientX) / crop.displayWidth,
        y: drag.center.y + (event.clientY - drag.clientY) / crop.displayHeight,
      });
    };

    const handleCropPointerEnd: PointerEventHandler<HTMLButtonElement> = (event) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined;
    };

    const handleCropKeyDown: KeyboardEventHandler<HTMLButtonElement> = (event) => {
      const step = event.shiftKey ? 0.05 : 0.01;
      const offset = {
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
      }[event.key];
      if (!offset) return;
      event.preventDefault();
      setClampedCenter({
        x: (crop?.centerX ?? center.x) + offset.x,
        y: (crop?.centerY ?? center.y) + offset.y,
      });
    };

    const handleReset = () => {
      setZoom(1);
      setCenter({ x: 0.5, y: 0.5 });
      setError(undefined);
    };

    const handleApply = async () => {
      if (!onApply || applying || !crop) return;
      setApplying(true);
      setError(undefined);
      try {
        const image = await loadImage(url);
        const sourceWidth = (crop.cropWidth / crop.displayWidth) * image.naturalWidth;
        const sourceHeight = (crop.cropHeight / crop.displayHeight) * image.naturalHeight;
        const sourceX = crop.centerX * image.naturalWidth - sourceWidth / 2;
        const sourceY = crop.centerY * image.naturalHeight - sourceHeight / 2;
        const canvas = document.createElement('canvas');
        canvas.width = outputWidth;
        canvas.height = Math.round(outputWidth / aspectRatio);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable');
        context.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        const type = 'image/jpeg';
        const blob = await canvasToBlob(canvas, type);
        onApply(new File([blob], `${name.replace(/\.[^.]+$/, '')}.jpg`, { type }));
      } catch {
        setError('Could not crop this image. Try another image.');
      } finally {
        setApplying(false);
      }
    };

    return (
      <Box
        className={classNames(css.ImageEditor, className)}
        direction="Column"
        {...props}
        ref={ref}
      >
        <Header className={css.ImageEditorHeader} size="500">
          <Box grow="Yes" alignItems="Center">
            <Text size="H4">Edit Image</Text>
          </Box>
          <IconButton aria-label="Close image editor" size="300" radii="300" onClick={requestClose}>
            <Icon src={Icons.Cross} />
          </IconButton>
        </Header>

        <Box grow="Yes" className={css.ImageEditorContent} direction="Column" alignItems="Center">
          <div ref={stageRef} className={css.CropStage}>
            <img
              className={css.Image}
              src={url}
              alt=""
              draggable={false}
              onLoad={(event) =>
                setImageSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
            />
            {crop && (
              <button
                type="button"
                className={css.CropSelection}
                aria-label={`Crop area for ${name}. Drag to move it, or use the arrow keys.`}
                onPointerDown={handleCropPointerDown}
                onPointerMove={handleCropPointerMove}
                onPointerUp={handleCropPointerEnd}
                onPointerCancel={handleCropPointerEnd}
                onKeyDown={handleCropKeyDown}
                style={{
                  width: crop.cropWidth,
                  height: crop.cropHeight,
                  transform: `translate3d(${crop.cropX}px, ${crop.cropY}px, 0)`,
                }}
              />
            )}
          </div>

          <Box className={css.ZoomControl} alignItems="Center" gap="200">
            <Icon size="100" src={Icons.Photo} />
            <input
              aria-label="Crop zoom"
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.currentTarget.value))}
            />
            <Icon size="300" src={Icons.Photo} />
          </Box>
          {error && (
            <Text role="alert" size="T200">
              {error}
            </Text>
          )}
        </Box>

        <Box className={css.ImageEditorFooter} alignItems="Center" gap="200">
          <Button variant="Primary" fill="None" onClick={handleReset}>
            <Text size="B400">Reset</Text>
          </Button>
          <Box grow="Yes" />
          <Button variant="Secondary" fill="Soft" outlined radii="300" onClick={requestClose}>
            <Text size="B400">Cancel</Text>
          </Button>
          <Button
            variant="Primary"
            fill="Solid"
            radii="300"
            onClick={handleApply}
            disabled={!onApply || applying || !crop}
          >
            <Text size="B400">{applying ? 'Applying...' : 'Apply'}</Text>
          </Button>
        </Box>
      </Box>
    );
  },
);
