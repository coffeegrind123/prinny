// Matrix event ids start with '$'; route params are percent-encoded, so it can arrive as '%24'.
const EVENT_ID_PREFIXES = ['$', encodeURIComponent('$')];

const isEventIdSegment = (segment: string): boolean =>
  EVENT_ID_PREFIXES.some((prefix) => segment.startsWith(prefix));

/**
 * The path a nav tab should remember. Notifications, mentions and message links put an event id
 * at the end of a room path (`:roomIdOrAlias/:eventId?/`). That is a one-shot jump: remembered,
 * it would reopen the message and replay its highlight on every visit to the tab. The room alone
 * is kept; the URL itself stays a working link.
 */
export const getNavPathname = (pathname: string): string => {
  const trailingSlash = pathname.endsWith('/');
  const segments = pathname.split('/');
  const lastIndex = segments.length - (trailingSlash ? 2 : 1);
  const lastSegment = segments[lastIndex];
  if (!lastSegment || !isEventIdSegment(lastSegment)) return pathname;
  return `${segments.slice(0, lastIndex).join('/')}${trailingSlash ? '/' : ''}`;
};
