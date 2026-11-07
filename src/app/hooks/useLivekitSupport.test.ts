import { describe, expect, it } from 'vitest';
import { livekitSupport } from './useLivekitSupport';

const homeserver = { 'm.homeserver': { base_url: 'https://hs.example.org' } };

describe('livekitSupport', () => {
  it('sees a focus in the client .well-known', () => {
    expect(
      livekitSupport({
        ...homeserver,
        'org.matrix.msc4143.rtc_foci': [
          { type: 'livekit', livekit_service_url: 'https://rtc.example.org/livekit/jwt' },
        ],
      }),
    ).toBe(true);
  });

  it('sees a LiveKit transport from the MSC4143 /rtc/transports endpoint', () => {
    // Synapse's `matrix_rtc` config advertises transports only here; the call
    // driver connects through them, so the buttons must not be greyed out.
    expect(
      livekitSupport(homeserver, [
        { type: 'livekit', livekit_service_url: 'https://rtc.example.org/livekit/jwt' },
      ]),
    ).toBe(true);
  });

  it('is false with neither, or with only non-LiveKit transports', () => {
    expect(livekitSupport(homeserver)).toBe(false);
    expect(livekitSupport(homeserver, [])).toBe(false);
    expect(livekitSupport(homeserver, [{ type: 'other' }])).toBe(false);
  });
});
