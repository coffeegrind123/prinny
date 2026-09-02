import { FormEventHandler, useCallback, useEffect, useMemo, useState } from 'react';
import {
  as,
  Box,
  Text,
  color,
  config,
  Button,
  Input,
  Menu,
  Spinner,
  Icon,
  Icons,
  IconButton,
} from 'folds';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { fetchTelegramStickerPack, parseStickerSetName } from '../../utils/telegram-stickers';
import {
  ImagePack,
  ImageUsage,
  PackContent,
  PackImage,
  PackImageReader,
  packMetaEqual,
  PackMetaReader,
} from '../../plugins/custom-emoji';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { SequenceCard } from '../sequence-card';
import { ImageTile, ImageTileEdit, ImageTileUpload } from './ImageTile';
import { SettingTile } from '../setting-tile';
import { UsageSwitcher } from './UsageSwitcher';
import { ImagePackProfile, ImagePackProfileEdit } from './PackMeta';
import * as css from './style.css';
import { useFilePicker } from '../../hooks/useFilePicker';
import { CompactUploadCardRenderer } from '../upload-card';
import { UploadSuccess } from '../../state/upload';
import { getImageInfo, getUploadContentName, TUploadContent } from '../../utils/matrix';
import { animatedImageInfo, blobIsAnimated } from '../../utils/animatedMedia';
import { getImageFileUrl, loadImageElement, renameFile } from '../../utils/dom';
import { replaceSpaceWithDash, suffixRename } from '../../utils/common';
import { getFileNameWithoutExt } from '../../utils/mimeTypes';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { downloadImagePackZip } from '../../utils/imagePackZip';

export type ImagePackContentProps = {
  imagePack: ImagePack;
  canEdit?: boolean;
  onUpdate?: (packContent: PackContent) => Promise<void>;
};

export const ImagePackContent = as<'div', ImagePackContentProps>(
  ({ imagePack, canEdit, onUpdate, ...props }, ref) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();

    const [metaEditing, setMetaEditing] = useState(false);
    const [savedMeta, setSavedMeta] = useState<PackMetaReader>();
    const currentMeta = savedMeta ?? imagePack.meta;

    const images = useMemo(() => Array.from(imagePack.images.collection.values()), [imagePack]);
    const [files, setFiles] = useState<File[]>([]);
    const [uploadedImages, setUploadedImages] = useState<PackImageReader[]>([]);
    const [imagesEditing, setImagesEditing] = useState<Set<string>>(new Set());
    const [savedImages, setSavedImages] = useState<Map<string, PackImageReader>>(new Map());
    const [deleteImages, setDeleteImages] = useState<Set<string>>(new Set());

    const hasImageWithShortcode = useCallback(
      (shortcode: string): boolean => {
        const hasInPack = imagePack.images.collection.has(shortcode);
        if (hasInPack) return true;
        const hasInUploaded =
          uploadedImages.find((img) => img.shortcode === shortcode) !== undefined;
        if (hasInUploaded) return true;
        const hasInSaved =
          Array.from(savedImages).find(([, img]) => img.shortcode === shortcode) !== undefined;
        return hasInSaved;
      },
      [imagePack, savedImages, uploadedImages],
    );

    const pickFiles = useFilePicker(
      useCallback(
        (pickedFiles: File[]) => {
          const uniqueFiles = pickedFiles.map((file) => {
            const fileName = replaceSpaceWithDash(file.name);
            if (hasImageWithShortcode(fileName)) {
              const uniqueName = suffixRename(fileName, hasImageWithShortcode);
              return renameFile(file, uniqueName);
            }
            return fileName !== file.name ? renameFile(file, fileName) : file;
          });

          setFiles((f) => [...f, ...uniqueFiles]);
        },
        [hasImageWithShortcode],
      ),
      true,
    );

    const [telegramBotToken] = useSetting(settingsAtom, 'telegramBotToken');
    const [importOpen, setImportOpen] = useState(false);
    const [importLink, setImportLink] = useState('');
    const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(
      null,
    );
    const [importError, setImportError] = useState<string | null>(null);
    const [importNote, setImportNote] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);

    // Imported stickers are pushed through the same `files` queue as picked
    // files, so they reuse the pack's existing upload, shortcode-dedupe and
    // save flow rather than growing a parallel one.
    const handleTelegramImport: FormEventHandler<HTMLFormElement> = useCallback(
      async (evt) => {
        evt.preventDefault();
        if (importing) return;

        const setName = parseStickerSetName(importLink);
        if (!setName) {
          setImportError('Not a sticker link. Expected a t.me/addstickers/... link.');
          return;
        }

        setImporting(true);
        setImportError(null);
        setImportNote(null);
        setImportProgress({ done: 0, total: 0 });

        try {
          const result = await fetchTelegramStickerPack(telegramBotToken, setName, (done, total) =>
            setImportProgress({ done, total }),
          );

          const uniqueFiles = result.files.map((file) => {
            const fileName = replaceSpaceWithDash(file.name);
            if (hasImageWithShortcode(fileName)) {
              return renameFile(file, suffixRename(fileName, hasImageWithShortcode));
            }
            return fileName !== file.name ? renameFile(file, fileName) : file;
          });

          setFiles((f) => [...f, ...uniqueFiles]);

          const skipped = result.skippedAnimated + result.skippedVideo;
          if (result.files.length === 0) {
            setImportError(
              skipped > 0
                ? `"${result.title}" has only animated or video stickers, which image packs cannot show.`
                : `"${result.title}" contained no stickers.`,
            );
          } else {
            setImportNote(
              skipped > 0
                ? `Added ${result.files.length} from "${result.title}". Skipped ${skipped} animated or video sticker${skipped === 1 ? '' : 's'}.`
                : `Added ${result.files.length} sticker${result.files.length === 1 ? '' : 's'} from "${result.title}".`,
            );
            setImportLink('');
          }
        } catch (err) {
          setImportError(err instanceof Error ? err.message : 'Import failed.');
        } finally {
          setImporting(false);
          setImportProgress(null);
        }
      },
      [importing, importLink, telegramBotToken, hasImageWithShortcode],
    );

    const handleMetaSave = useCallback(
      (editedMeta: PackMetaReader) => {
        setMetaEditing(false);
        setSavedMeta(
          (m) =>
            new PackMetaReader({
              ...imagePack.meta.content,
              ...m?.content,
              ...editedMeta.content,
            }),
        );
      },
      [imagePack.meta],
    );

    const handleMetaCancel = () => setMetaEditing(false);

    const handlePackUsageChange = useCallback(
      (usg: ImageUsage[]) => {
        setSavedMeta(
          (m) =>
            new PackMetaReader({
              ...imagePack.meta.content,
              ...m?.content,
              usage: usg,
            }),
        );
      },
      [imagePack.meta],
    );

    const handleUploadRemove = useCallback((file: TUploadContent) => {
      setFiles((fs) => fs.filter((f) => f !== file));
    }, []);

    const handleUploadComplete = useCallback(
      async (data: UploadSuccess) => {
        const imgEl = await loadImageElement(getImageFileUrl(data.file));
        const packImage: PackImage = {
          url: data.mxc,
          info: {
            ...getImageInfo(imgEl, data.file),
            // MSC4230 — pack images are sent as `m.sticker`, and animated
            // stickers are the norm rather than the exception.
            ...animatedImageInfo(await blobIsAnimated(data.file)),
          },
        };
        const image = PackImageReader.fromPackImage(
          getFileNameWithoutExt(getUploadContentName(data.file)),
          packImage,
        );
        if (!image) return;
        handleUploadRemove(data.file);
        setUploadedImages((imgs) => [image, ...imgs]);
      },
      [handleUploadRemove],
    );

    const handleImageEdit = (shortcode: string) => {
      setImagesEditing((shortcodes) => {
        const shortcodeSet = new Set(shortcodes);
        shortcodeSet.add(shortcode);
        return shortcodeSet;
      });
    };
    const handleDeleteToggle = (shortcode: string) => {
      setDeleteImages((shortcodes) => {
        const shortcodeSet = new Set(shortcodes);
        if (shortcodeSet.has(shortcode)) shortcodeSet.delete(shortcode);
        else shortcodeSet.add(shortcode);
        return shortcodeSet;
      });
    };

    const handleImageEditCancel = (shortcode: string) => {
      setImagesEditing((shortcodes) => {
        const shortcodeSet = new Set(shortcodes);
        shortcodeSet.delete(shortcode);
        return shortcodeSet;
      });
    };

    const handleImageEditSave = (shortcode: string, image: PackImageReader) => {
      handleImageEditCancel(shortcode);

      const saveImage =
        shortcode !== image.shortcode && hasImageWithShortcode(image.shortcode)
          ? new PackImageReader(
              suffixRename(image.shortcode, hasImageWithShortcode),
              image.url,
              image.content,
            )
          : image;

      setSavedImages((sImgs) => {
        const imgs = new Map(sImgs);
        imgs.set(shortcode, saveImage);
        return imgs;
      });
    };

    const handleResetSavedChanges = () => {
      setSavedMeta(undefined);
      setFiles([]);
      setUploadedImages([]);
      setSavedImages(new Map());
      setDeleteImages(new Set());
    };

    const [zipState, downloadZip] = useAsyncCallback(
      useCallback(
        () => downloadImagePackZip(mx, useAuthentication, imagePack),
        [mx, useAuthentication, imagePack],
      ),
    );
    const downloadingZip = zipState.status === AsyncStatus.Loading;
    const zipError = zipState.status === AsyncStatus.Error;

    const [applyState, applyChanges] = useAsyncCallback(
      useCallback(async () => {
        const pack: PackContent = {
          pack: savedMeta?.content ?? imagePack.meta.content,
          images: {},
        };
        const pushImage = (img: PackImageReader) => {
          if (deleteImages.has(img.shortcode)) return;
          if (!pack.images) return;
          const imgToPush = savedImages.get(img.shortcode) ?? img;
          pack.images[imgToPush.shortcode] = imgToPush.content;
        };
        uploadedImages.forEach((img) => pushImage(img));
        images.forEach((img) => pushImage(img));

        return onUpdate?.(pack);
      }, [imagePack, images, savedMeta, uploadedImages, savedImages, deleteImages, onUpdate]),
    );

    useEffect(() => {
      if (applyState.status === AsyncStatus.Success) {
        handleResetSavedChanges();
      }
    }, [applyState]);

    const savedChanges =
      (savedMeta && !packMetaEqual(imagePack.meta, savedMeta)) ||
      uploadedImages.length > 0 ||
      savedImages.size > 0 ||
      deleteImages.size > 0;
    const canApplyChanges = !metaEditing && imagesEditing.size === 0 && files.length === 0;
    const applying = applyState.status === AsyncStatus.Loading;

    const renderImage = (image: PackImageReader) => (
      <SequenceCard
        key={image.shortcode}
        style={{ padding: config.space.S300 }}
        variant={deleteImages.has(image.shortcode) ? 'Critical' : 'SurfaceVariant'}
        direction="Column"
        gap="400"
      >
        {imagesEditing.has(image.shortcode) ? (
          <ImageTileEdit
            defaultShortcode={image.shortcode}
            image={savedImages.get(image.shortcode) ?? image}
            packUsage={currentMeta.usage}
            useAuthentication={useAuthentication}
            onCancel={handleImageEditCancel}
            onSave={handleImageEditSave}
          />
        ) : (
          <ImageTile
            defaultShortcode={image.shortcode}
            image={savedImages.get(image.shortcode) ?? image}
            packUsage={currentMeta.usage}
            useAuthentication={useAuthentication}
            canEdit={canEdit}
            onEdit={handleImageEdit}
            deleted={deleteImages.has(image.shortcode)}
            onDeleteToggle={handleDeleteToggle}
          />
        )}
      </SequenceCard>
    );

    return (
      <Box grow="Yes" direction="Column" gap="700" {...props} ref={ref}>
        {savedChanges && (
          <Menu className={css.UnsavedMenu} variant="Success">
            <Box alignItems="Center" gap="400">
              <Box grow="Yes" direction="Column">
                {applyState.status === AsyncStatus.Error ? (
                  <Text size="T200">
                    <b>Failed to apply changes! Please try again.</b>
                  </Text>
                ) : (
                  <Text size="T200">
                    <b>Changes saved! Apply when ready.</b>
                  </Text>
                )}
              </Box>
              <Box shrink="No" gap="200">
                <Button
                  size="300"
                  variant="Success"
                  fill="None"
                  radii="300"
                  disabled={!canApplyChanges || applying}
                  onClick={handleResetSavedChanges}
                >
                  <Text size="B300">Reset</Text>
                </Button>
                <Button
                  size="300"
                  variant="Success"
                  radii="300"
                  disabled={!canApplyChanges || applying}
                  before={applying && <Spinner variant="Success" fill="Solid" size="100" />}
                  onClick={applyChanges}
                >
                  <Text size="B300">Apply Changes</Text>
                </Button>
              </Box>
            </Box>
          </Menu>
        )}
        <Box direction="Column" gap="100">
          <Text size="L400">Set</Text>
          <SequenceCard
            style={{ padding: config.space.S300 }}
            variant="SurfaceVariant"
            direction="Column"
            gap="400"
          >
            {metaEditing ? (
              <ImagePackProfileEdit
                meta={currentMeta}
                onCancel={handleMetaCancel}
                onSave={handleMetaSave}
              />
            ) : (
              <ImagePackProfile
                meta={currentMeta}
                canEdit={canEdit}
                onEdit={() => setMetaEditing(true)}
              />
            )}
          </SequenceCard>
          <SequenceCard
            style={{ padding: config.space.S300 }}
            variant="SurfaceVariant"
            direction="Column"
            gap="400"
          >
            <SettingTile
              title="Images Usage"
              description="Select how the images are being used: as emojis, as stickers, or as both."
              after={
                <UsageSwitcher
                  usage={currentMeta.usage}
                  canEdit={canEdit}
                  onChange={handlePackUsageChange}
                />
              }
            />
          </SequenceCard>
        </Box>
        {images.length === 0 && !canEdit ? null : (
          <Box direction="Column" gap="100">
            <Box alignItems="Center" gap="200">
              <Box grow="Yes">
                <Text size="L400">Images</Text>
              </Box>
              {images.length > 0 && (
                <IconButton
                  size="300"
                  radii="300"
                  variant={zipError ? 'Critical' : 'SurfaceVariant'}
                  onClick={downloadZip}
                  disabled={downloadingZip}
                  title="Download all images as a zip"
                  aria-label="Download all images as a zip"
                >
                  {downloadingZip ? (
                    <Spinner size="100" variant={zipError ? 'Critical' : 'Secondary'} />
                  ) : (
                    <Icon size="100" src={Icons.Download} />
                  )}
                </IconButton>
              )}
            </Box>
            {canEdit && (
              <SequenceCard
                style={{ padding: config.space.S300 }}
                variant="SurfaceVariant"
                direction="Column"
                gap="400"
              >
                <SettingTile
                  title="Upload Images"
                  description="Select images from your storage to upload them in set."
                  after={
                    <Button
                      variant="Secondary"
                      fill="Soft"
                      size="300"
                      radii="300"
                      type="button"
                      outlined
                      onClick={() => pickFiles('image/*')}
                    >
                      <Text size="B300">Select</Text>
                    </Button>
                  }
                />
                <SettingTile
                  title="Import from Telegram"
                  description={
                    telegramBotToken
                      ? 'Paste a t.me/addstickers link to add its static stickers to this pack.'
                      : 'Add a Telegram bot token in Settings → Emojis & Stickers to import sticker packs. Telegram publishes sticker sets nowhere else.'
                  }
                  after={
                    <Button
                      variant="Secondary"
                      fill="Soft"
                      size="300"
                      radii="300"
                      type="button"
                      outlined
                      disabled={!telegramBotToken}
                      onClick={() => setImportOpen((open) => !open)}
                    >
                      <Text size="B300">{importOpen ? 'Close' : 'Import'}</Text>
                    </Button>
                  }
                />
                {importOpen && telegramBotToken && (
                  <Box as="form" onSubmit={handleTelegramImport} direction="Column" gap="200">
                    <Box gap="200">
                      <Box grow="Yes" direction="Column">
                        <Input
                          name="telegramStickerLink"
                          value={importLink}
                          onChange={(evt) => setImportLink(evt.currentTarget.value)}
                          placeholder="https://t.me/addstickers/PackName"
                          autoComplete="off"
                          variant="Secondary"
                          radii="300"
                          disabled={importing}
                        />
                      </Box>
                      <Button
                        size="400"
                        variant="Success"
                        fill="Solid"
                        outlined
                        radii="300"
                        type="submit"
                        disabled={importing || importLink.trim().length === 0}
                        before={importing ? <Spinner size="100" variant="Success" /> : undefined}
                      >
                        <Text size="B400">
                          {importProgress && importProgress.total > 0
                            ? `${importProgress.done}/${importProgress.total}`
                            : 'Add'}
                        </Text>
                      </Button>
                    </Box>
                    {importError && (
                      <Text size="T200" style={{ color: color.Critical.Main }}>
                        {importError}
                      </Text>
                    )}
                    {importNote && !importError && (
                      <Text size="T200" style={{ color: color.Success.Main }}>
                        {importNote}
                      </Text>
                    )}
                  </Box>
                )}
              </SequenceCard>
            )}
            {files.map((file) => (
              <SequenceCard
                key={file.name}
                style={{ padding: config.space.S300 }}
                variant="SurfaceVariant"
                direction="Column"
                gap="400"
              >
                <ImageTileUpload file={file}>
                  {(uploadAtom) => (
                    <CompactUploadCardRenderer
                      uploadAtom={uploadAtom}
                      onRemove={handleUploadRemove}
                      onComplete={handleUploadComplete}
                    />
                  )}
                </ImageTileUpload>
              </SequenceCard>
            ))}
            {uploadedImages.map(renderImage)}
            {images.map(renderImage)}
          </Box>
        )}
      </Box>
    );
  },
);
