import React, { useMemo } from 'react';
import { Box, Scroll, Text, color, config, toRem } from 'folds';
import { Page } from '../../components/page';
import { version } from '../../../../package.json';
import { ChangelogBullet, formatDate, parseChangelog } from './parser';
// `?raw` ships the file contents as a string at build time — Vite handles
// this natively. The changelog is part of the binary; no network fetch.
import changelogMd from '../../../../CHANGELOG.md?raw';

const REPO_RELEASES = 'https://github.com/coffeegrind123/prinny-client/releases';
const CINNY_COMMIT_BASE = 'https://github.com/coffeegrind123/prinny/commit/';

function CodeSpan({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        fontSize: '0.875em',
        padding: '1px 6px',
        borderRadius: '4px',
        background: color.SurfaceVariant.Container,
        color: color.SurfaceVariant.OnContainer,
      }}
    >
      {children}
    </span>
  );
}

function BulletRow({ bullet }: { bullet: ChangelogBullet }) {
  // SHAs are 7-char hex — assume cinny first since most user-facing changes
  // land there; both repos use compatible short-sha format so either link
  // will resolve to a real commit page via GitHub's prefix lookup.
  const shaUrl = `${CINNY_COMMIT_BASE}${bullet.sha}`;
  return (
    <Box gap="200" alignItems="Start" style={{ lineHeight: 1.55 }}>
      <span style={{ flexShrink: 0, paddingTop: '4px' }}>
        <a
          href={shaUrl}
          target="_blank"
          rel="noreferrer noopener"
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            fontSize: '11px',
            padding: '2px 6px',
            borderRadius: '4px',
            background: color.Surface.Container,
            border: `1px solid ${color.Surface.ContainerLine}`,
            color: color.Surface.OnContainer,
            textDecoration: 'none',
          }}
        >
          {bullet.sha}
        </a>
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {bullet.parts.map((part, i) =>
          part.kind === 'code' ? (
            <CodeSpan key={i}>{part.value}</CodeSpan>
          ) : (
            <React.Fragment key={i}>{part.value}</React.Fragment>
          ),
        )}
      </span>
    </Box>
  );
}

export function Changelog() {
  const entries = useMemo(() => parseChangelog(changelogMd), []);

  return (
    <Page>
      <Scroll size="300" hideTrack>
        <Box
          direction="Column"
          gap="600"
          style={{
            padding: `${config.space.S700} ${config.space.S400}`,
            maxWidth: toRem(720),
            margin: '0 auto',
            width: '100%',
          }}
        >
          {/* Header */}
          <Box direction="Column" gap="200">
            <Text size="H2" priority="500">
              What&apos;s new 👀
            </Text>
            <Text size="T300" priority="300">
              Prinny Client{' '}
              <a
                href={REPO_RELEASES}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: color.Secondary.Main, textDecoration: 'none' }}
              >
                v{version}
              </a>
              {' · '}
              Most recent changes appear first.
            </Text>
          </Box>

          {/* Entries */}
          {entries.length === 0 ? (
            <Text size="T300" priority="300">
              No changelog entries yet.
            </Text>
          ) : (
            <Box direction="Column" gap="600">
              {entries.map((entry) => (
                <Box key={entry.rawDate} direction="Column" gap="300">
                  <Box
                    style={{
                      borderBottom: `1px solid ${color.SurfaceVariant.ContainerLine}`,
                      paddingBottom: config.space.S100,
                    }}
                  >
                    <Text size="H4" style={{ color: color.Secondary.Main }}>
                      {formatDate(entry.rawDate)}
                    </Text>
                  </Box>
                  <Box direction="Column" gap="200">
                    {entry.bullets.map((b, i) => (
                      <BulletRow key={`${b.sha}-${i}`} bullet={b} />
                    ))}
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {/* Footer */}
          <Box
            direction="Column"
            gap="100"
            style={{
              paddingTop: config.space.S400,
              borderTop: `1px solid ${color.SurfaceVariant.ContainerLine}`,
            }}
          >
            <Text size="T200" priority="300">
              Full history in{' '}
              <a
                href="https://github.com/coffeegrind123/prinny-client/commits/main"
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: color.Secondary.Main }}
              >
                prinny-client
              </a>
              {' / '}
              <a
                href="https://github.com/coffeegrind123/prinny/commits/main"
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: color.Secondary.Main }}
              >
                cinny
              </a>
              {'.'}
            </Text>
          </Box>
        </Box>
      </Scroll>
    </Page>
  );
}
