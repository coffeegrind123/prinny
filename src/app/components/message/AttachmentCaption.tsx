import { Icon, Icons, Spinner, Text } from 'folds';
import classNames from 'classnames';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import * as css from './AttachmentCaption.css';
import { useMediaDownload } from '../../hooks/useMediaDownload';

type CaptionNameProps = {
  filename: string;
};
function CaptionName({ filename }: CaptionNameProps) {
  return (
    <Text as="span" className={css.CaptionName} size="T200" priority="300">
      {filename}
    </Text>
  );
}

export type AttachmentCaptionProps = {
  /** The name the sender gave the file. */
  filename: string;
};

/**
 * The filename above an attachment, and nothing else.
 *
 * Use this where a download control would be redundant — the file card below
 * already carries an explicit "Download (2.4 MB)" button, so repeating it in
 * the caption would restore exactly the duplication this replaced.
 */
export function AttachmentCaption({ filename }: AttachmentCaptionProps) {
  return (
    <span className={css.Caption} title={filename}>
      <CaptionName filename={filename} />
    </span>
  );
}

export type AttachmentDownloadCaptionProps = AttachmentCaptionProps & {
  url: string;
  mimeType: string;
  encInfo?: EncryptedAttachmentInfo;
};

/**
 * The filename above a media attachment, which is also its download control.
 *
 * Media plays in the platform's own element now, so the attachment no longer
 * needs a card, a type badge or a button of its own — but it does still need
 * one download that lands the file under the sender's filename, because the
 * media element's built-in one cannot (see useMediaDownload). Folding that
 * into the caption keeps the affordance without putting a second control next
 * to a player that already looks like it has one.
 */
export function AttachmentDownloadCaption({
  filename,
  url,
  mimeType,
  encInfo,
}: AttachmentDownloadCaptionProps) {
  const { download, downloading, hasError, downloadName } = useMediaDownload(
    filename,
    url,
    mimeType,
    encInfo,
  );

  return (
    <button
      type="button"
      className={classNames(css.Caption, css.CaptionInteractive, hasError && css.CaptionCritical)}
      onClick={download}
      disabled={downloading}
      title={hasError ? `Download failed — retry ${downloadName}` : `Download ${downloadName}`}
    >
      {downloading ? (
        <Spinner className={css.CaptionIcon} size="50" variant="Secondary" />
      ) : (
        <Icon
          className={css.CaptionIcon}
          size="50"
          src={hasError ? Icons.Warning : Icons.Download}
          filled={hasError}
        />
      )}
      <CaptionName filename={filename} />
    </button>
  );
}
