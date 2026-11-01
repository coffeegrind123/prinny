import { ReactNode } from 'react';
import { Box, Icon, IconSrc, Icons, Text, config } from 'folds';
import { MatrixError } from 'matrix-js-sdk';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { useServerSoftware } from '../../hooks/useServerSoftware';
import { useRankOrderTruncated } from './useMessageSearch';
import { errorMessage } from '../../utils/errorMessage';

type NoticeVariant = 'Warning' | 'Critical' | 'SurfaceVariant';

type SearchNoticeProps = {
  variant?: NoticeVariant;
  icon?: IconSrc;
  children: ReactNode;
};
export function SearchNotice({
  variant = 'Warning',
  icon = Icons.Info,
  children,
}: SearchNoticeProps) {
  return (
    <Box
      className={ContainerColor({ variant })}
      style={{ padding: config.space.S300, borderRadius: config.radii.R400 }}
      alignItems="Start"
      gap="200"
      shrink="No"
    >
      <Icon style={{ flexShrink: 0 }} size="200" src={icon} />
      <Box direction="Column" gap="100">
        {children}
      </Box>
    </Box>
  );
}

type RankOrderNoticeProps = {
  /** The query has run out of pages. */
  exhausted: boolean;
};
/**
 * Warns up front only on servers known to truncate relevance ordering; anywhere
 * else stays quiet until the results have actually run dry, so it never claims
 * a limit the server may not have.
 */
export function RankOrderNotice({ exhausted }: RankOrderNoticeProps) {
  const { name } = useServerSoftware();
  const truncated = useRankOrderTruncated();

  if (!truncated && !exhausted) return null;

  return (
    <SearchNotice variant="SurfaceVariant">
      <Text size="T300">
        {truncated
          ? `${name ?? 'Your homeserver'} returns a limited set of results when sorting by relevance.`
          : 'Your homeserver returned every relevance-ranked result it will provide.'}
      </Text>
      <Text size="T200" priority="300">
        Sort by Recent to page through all matches.
      </Text>
    </SearchNotice>
  );
}

const describeSearchError = (error: Error): string => {
  if (error instanceof MatrixError) {
    if (error.errcode === 'M_UNRECOGNIZED') {
      return 'This homeserver does not implement message search.';
    }
    if (error.errcode === 'M_LIMIT_EXCEEDED') {
      return 'Too many searches in a short time. Wait a moment and try again.';
    }
    const message = error.data?.error;
    if (typeof message === 'string' && message.toLowerCase().includes('search is disabled')) {
      return 'Message search is disabled on this homeserver.';
    }
  }
  return errorMessage(error);
};

type SearchErrorNoticeProps = {
  error: Error;
};
export function SearchErrorNotice({ error }: SearchErrorNoticeProps) {
  return (
    <SearchNotice variant="Critical" icon={Icons.Warning}>
      <Text size="T300">{describeSearchError(error)}</Text>
    </SearchNotice>
  );
}
