import { describe, expect, it } from 'vitest';
import {
  MSC4544_RPC_ACTIVITY,
  parseMsc4544Buttons,
  parseMsc4544RichPresence,
  resolveButtonUrl,
} from './richPresence';

const NOW = 1_800_000_000_000;

describe('MSC4544 buttons', () => {
  it('keeps up to three buttons with a label and an http(s) URL', () => {
    expect(
      parseMsc4544Buttons([
        { label: 'One', url: 'https://a.example/1' },
        { label: 'Two', url: 'http://a.example/2', request_openid: true },
        { label: 'Three', url: 'https://a.example/3' },
        { label: 'Four', url: 'https://a.example/4' },
      ]),
    ).toEqual([
      { label: 'One', url: 'https://a.example/1', requestOpenId: false },
      { label: 'Two', url: 'http://a.example/2', requestOpenId: true },
      { label: 'Three', url: 'https://a.example/3', requestOpenId: false },
    ]);
  });

  it('drops buttons with other schemes, no label or no URL', () => {
    expect(
      parseMsc4544Buttons([
        { label: 'Script', url: 'javascript:alert(1)' },
        { label: 'File', url: 'file:///etc/passwd' },
        { label: '  ', url: 'https://a.example' },
        { label: 'No URL' },
        'not an object',
      ]),
    ).toBeUndefined();
    expect(parseMsc4544Buttons('nope')).toBeUndefined();
  });

  it('checks the scheme of a URL that is only complete once the token is in', () => {
    expect(
      parseMsc4544Buttons([
        { label: 'Join', url: '{openid_data}', request_openid: true },
        { label: 'Join', url: 'https://g.example/join?m={openid_data}', request_openid: true },
      ]),
    ).toEqual([
      { label: 'Join', url: 'https://g.example/join?m={openid_data}', requestOpenId: true },
    ]);
  });

  it('puts the URL-encoded OpenID response in place of the placeholder', () => {
    const token = {
      access_token: 'abc',
      token_type: 'Bearer',
      matrix_server_name: 'hs',
      expires_in: 3600,
    };
    expect(resolveButtonUrl('https://g.example/join?m={openid_data}', token)).toBe(
      `https://g.example/join?m=${encodeURIComponent(JSON.stringify(token))}`,
    );
    expect(resolveButtonUrl('https://g.example/?m={openid_data}')).toBe(
      'https://g.example/?m={openid_data}',
    );
  });

  it('carries the buttons on a parsed entry', () => {
    const presence = parseMsc4544RichPresence(
      [
        {
          id: '1',
          type: MSC4544_RPC_ACTIVITY,
          name: 'A game',
          expiry: NOW + 60_000,
          buttons: [{ label: 'Watch', url: 'https://a.example/watch' }],
        },
      ],
      NOW,
    );
    expect(presence?.buttons).toEqual([
      { label: 'Watch', url: 'https://a.example/watch', requestOpenId: false },
    ]);
  });
});
