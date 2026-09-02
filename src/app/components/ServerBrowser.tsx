import React, { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  Scroll,
  Spinner,
  Text,
  color,
  config,
} from 'folds';

import { Modal500 } from './Modal500';
import { PublicServer, usePublicServers } from '../hooks/usePublicServers';
import { useClientConfig } from '../hooks/useClientConfig';

// Rows put into the DOM at once. The directory carries ~1150 servers and
// nobody scrolls to the end of that.
const PAGE_SIZE = 60;

type SortKey = 'name' | 'clientDomain' | 'software' | 'version' | 'lastCheck';

type Filters = {
  openOnly: boolean;
  noCaptcha: boolean;
  noEmail: boolean;
  tor: boolean;
  noCloudflare: boolean;
  curated: boolean;
};

const INITIAL_FILTERS: Filters = {
  openOnly: true,
  noCaptcha: false,
  noEmail: false,
  tor: false,
  noCloudflare: false,
  curated: false,
};

/**
 * `null` means the upstream lists never surveyed it. A "no captcha" filter must
 * therefore demand an explicit `false` rather than "not true" — otherwise the
 * ~1075 servers nobody has checked would all claim to be captcha-free.
 */
const isFalse = (v: boolean | null): boolean => v === false;
const isTrue = (v: boolean | null): boolean => v === true;

const searchIndex = (s: PublicServer): string =>
  [
    s.name,
    s.clientDomain,
    s.software,
    s.info.description,
    s.info.isp,
    s.info.jurisdiction,
    s.info.languages.join(' '),
    s.info.features.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

function matches(server: PublicServer, filters: Filters, terms: string[], software: string) {
  const { registration: reg, privacy: priv } = server;
  if (filters.openOnly && !reg.open) return false;
  if (filters.noCaptcha && !isFalse(reg.captcha)) return false;
  if (filters.noEmail && !isFalse(reg.emailRequired)) return false;
  if (filters.tor && !isTrue(priv.torFriendly)) return false;
  if (filters.noCloudflare && !isFalse(priv.cloudflare)) return false;
  if (filters.curated && !server.sources.includes('joinmatrix')) return false;
  if (software && server.software !== software) return false;
  if (terms.length > 0) {
    const hay = searchIndex(server);
    return terms.every((t) => hay.includes(t));
  }
  return true;
}

/** Natural version ordering: 1.9.0 sorts below 1.10.0, not above it. */
function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = Number.isNaN(pa[i]) ? -1 : (pa[i] ?? -1);
    const y = Number.isNaN(pb[i]) ? -1 : (pb[i] ?? -1);
    if (x !== y) return x - y;
  }
  return 0;
}

function compare(a: PublicServer, b: PublicServer, key: SortKey, dir: number): number {
  if (key === 'version') return compareVersion(a.version, b.version) * dir;
  const x = a[key] ?? '';
  const y = b[key] ?? '';
  // Blanks sort last whichever way the column is pointing.
  if (x === '' && y !== '') return 1;
  if (y === '' && x !== '') return -1;
  return String(x).localeCompare(String(y)) * dir;
}

function relativeDate(iso: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

function Badge({ label, tone }: { label: string; tone?: 'good' | 'bad' }) {
  return (
    <Text
      as="span"
      size="B300"
      style={{
        padding: `0 ${config.space.S100}`,
        borderRadius: config.radii.R300,
        border: `1px solid ${color.Surface.ContainerLine}`,
        whiteSpace: 'nowrap',
        color:
          tone === 'good' ? color.Success.Main : tone === 'bad' ? color.Critical.Main : undefined,
      }}
    >
      {label}
    </Text>
  );
}

function ServerRow({ server, onPick }: { server: PublicServer; onPick: (n: string) => void }) {
  const { registration: reg, privacy: priv, info } = server;

  const badges: { label: string; tone?: 'good' | 'bad' }[] = [];
  if (!reg.open) badges.push({ label: 'invite only', tone: 'bad' });
  if (isFalse(reg.captcha)) badges.push({ label: 'no captcha', tone: 'good' });
  else if (isTrue(reg.captcha)) badges.push({ label: 'captcha', tone: 'bad' });
  if (isFalse(reg.emailRequired)) badges.push({ label: 'no email', tone: 'good' });
  else if (isTrue(reg.emailRequired)) badges.push({ label: 'email', tone: 'bad' });
  if (isTrue(priv.torFriendly)) badges.push({ label: 'tor', tone: 'good' });
  if (isTrue(priv.cloudflare)) badges.push({ label: 'cloudflare' });
  if (info.jurisdiction) badges.push({ label: info.jurisdiction });
  if (info.isp) badges.push({ label: info.isp });

  const cell: React.CSSProperties = {
    padding: `${config.space.S200} ${config.space.S300}`,
    borderBottom: `1px solid ${color.Surface.ContainerLine}`,
    verticalAlign: 'top',
  };

  return (
    <tr
      onClick={() => onPick(server.name)}
      style={{ cursor: 'pointer' }}
      tabIndex={0}
      onKeyDown={(evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault();
          onPick(server.name);
        }
      }}
    >
      <td style={cell}>
        <Text size="T300">
          <b>{server.name}</b>
        </Text>
        {info.description && (
          <Text size="T200" priority="300" style={{ maxWidth: '28rem' }}>
            {info.description}
          </Text>
        )}
        {badges.length > 0 && (
          <Box gap="100" wrap="Wrap" style={{ marginTop: config.space.S100 }}>
            {badges.map((b) => (
              <Badge key={b.label} label={b.label} tone={b.tone} />
            ))}
          </Box>
        )}
      </td>
      <td style={cell}>
        <Text size="T200" priority="300">
          {server.clientDomain || '—'}
        </Text>
      </td>
      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
        <Text size="T200">{server.software || '—'}</Text>
      </td>
      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
        <Text size="T200">{server.version || '—'}</Text>
      </td>
      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
        <Text size="T200" priority="300">
          {relativeDate(server.lastCheck)}
        </Text>
      </td>
    </tr>
  );
}

export function ServerBrowser({
  requestClose,
  onSelect,
}: {
  requestClose: () => void;
  onSelect: (server: string) => void;
}) {
  const { publicServersUrl } = useClientConfig();
  const { data, isLoading, error } = usePublicServers(publicServersUrl);

  const [query, setQuery] = useState('');
  const [software, setSoftware] = useState('');
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState(1);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const toggle = (key: keyof Filters) => {
    setFilters((f) => ({ ...f, [key]: !f[key] }));
    setLimit(PAGE_SIZE);
  };

  const softwareCounts = useMemo(() => {
    const counts = new Map<string, number>();
    data?.servers.forEach((s) => {
      if (s.software) counts.set(s.software, (counts.get(s.software) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const results = useMemo(() => {
    if (!data) return [];
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return data.servers
      .filter((s) => matches(s, filters, terms, software))
      .sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [data, query, filters, software, sortKey, sortDir]);

  const pick = (name: string) => {
    onSelect(name);
    requestClose();
  };

  const sortBy = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => -d);
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  const th = (key: SortKey, label: string): React.ReactNode => (
    <th
      onClick={() => sortBy(key)}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1,
        background: color.Surface.Container,
        textAlign: 'left',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        padding: `${config.space.S200} ${config.space.S300}`,
        borderBottom: `1px solid ${color.Surface.ContainerLine}`,
      }}
      aria-sort={sortKey === key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <Text as="span" size="L400">
        {label}
        {sortKey === key ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
      </Text>
    </th>
  );

  return (
    <Modal500 requestClose={requestClose}>
      <Box direction="Column" style={{ maxHeight: '85vh', minHeight: 0 }}>
        <Header size="500" variant="Surface" style={{ padding: `0 ${config.space.S400}` }}>
          <Box grow="Yes">
            <Text size="H4">Choose a homeserver</Text>
          </Box>
          <IconButton size="300" onClick={requestClose} radii="300">
            <Icon src={Icons.Cross} />
          </IconButton>
        </Header>

        <Box
          direction="Column"
          gap="200"
          shrink="No"
          style={{ padding: config.space.S400, paddingBottom: config.space.S200 }}
        >
          <Box gap="200" wrap="Wrap">
            <Box grow="Yes" direction="Column" style={{ minWidth: '14rem' }}>
              <Input
                size="400"
                variant="Background"
                outlined
                autoFocus
                placeholder="Search name, software, country, host…"
                value={query}
                onChange={(evt) => {
                  setQuery(evt.target.value);
                  setLimit(PAGE_SIZE);
                }}
                before={<Icon size="200" src={Icons.Search} />}
              />
            </Box>
            <select
              value={software}
              onChange={(evt) => {
                setSoftware(evt.target.value);
                setLimit(PAGE_SIZE);
              }}
              style={{
                background: color.Background.Container,
                color: color.Background.OnContainer,
                border: `1px solid ${color.Background.ContainerLine}`,
                borderRadius: config.radii.R400,
                padding: `0 ${config.space.S200}`,
                font: 'inherit',
                minHeight: '2.5rem',
              }}
            >
              <option value="">Any software</option>
              {softwareCounts.map(([name, count]) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
            </select>
          </Box>

          <Box gap="100" wrap="Wrap">
            {(
              [
                ['openOnly', 'Open registration'],
                ['curated', 'Has details'],
                ['noCaptcha', 'No captcha'],
                ['noEmail', 'No email'],
                ['tor', 'Tor friendly'],
                ['noCloudflare', 'No Cloudflare'],
              ] as [keyof Filters, string][]
            ).map(([key, label]) => (
              <Chip
                key={key}
                variant={filters[key] ? 'Primary' : 'Surface'}
                radii="Pill"
                onClick={() => toggle(key)}
              >
                <Text size="B300">{label}</Text>
              </Chip>
            ))}
          </Box>

          {data && (
            <Text size="T200" priority="300">
              {results.length} of {data.servers.length} servers
              {data.degraded && ' · a source was unreachable, showing cached data'}
            </Text>
          )}
        </Box>

        <Box grow="Yes" style={{ minHeight: 0 }}>
          <Scroll hideTrack visibility="Hover">
            <Box direction="Column" style={{ padding: `0 ${config.space.S400}` }}>
              {isLoading && (
                <Box justifyContent="Center" style={{ padding: config.space.S700 }}>
                  <Spinner variant="Secondary" size="400" />
                </Box>
              )}

              {error && (
                <Text size="T200" style={{ color: color.Critical.Main }}>
                  Could not load the server directory. Type a homeserver name directly instead.
                </Text>
              )}

              {!isLoading && !error && results.length === 0 && (
                <Text
                  size="T200"
                  priority="300"
                  align="Center"
                  style={{ padding: config.space.S700 }}
                >
                  No servers match those filters.
                </Text>
              )}

              {results.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr>
                        {th('name', 'Name')}
                        {th('clientDomain', 'Server')}
                        {th('software', 'Software')}
                        {th('version', 'Version')}
                        {th('lastCheck', 'Last check')}
                      </tr>
                    </thead>
                    <tbody>
                      {results.slice(0, limit).map((s) => (
                        <ServerRow key={s.name} server={s} onPick={pick} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {results.length > limit && (
                <Chip
                  variant="Surface"
                  radii="400"
                  onClick={() => setLimit((l) => l + PAGE_SIZE)}
                  style={{ alignSelf: 'center', margin: config.space.S300 }}
                >
                  <Text size="B300">Show more ({results.length - limit} remaining)</Text>
                </Chip>
              )}

              <Text
                size="T200"
                priority="400"
                align="Center"
                style={{ padding: config.space.S300 }}
              >
                Merged daily from asra.gr, joinmatrix.org and privacydev.net. Inclusion is not a
                recommendation.
              </Text>
            </Box>
          </Scroll>
        </Box>
      </Box>
    </Modal500>
  );
}
