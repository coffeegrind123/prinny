// Augments matrix-js-sdk's strict event-type registries with our custom keys.
// Without this, setAccountData / getStateEvent / getRoomAccountData reject
// AccountDataEvent.PoniesUserEmotes etc. because they aren't in the upstream union.

declare module 'matrix-js-sdk' {
  interface AccountDataEvents {
    'in.cinny.spaces': unknown;
    'io.element.recent_emoji': unknown;
    'im.ponies.user_emotes': unknown;
    'im.ponies.emote_rooms': unknown;
    'm.image_pack.rooms': unknown;
    'app.prinny.room_order': unknown;
    'app.prinny.gif_favorites': unknown;
    'app.prinny.emoji_mashups': unknown;
    'app.prinny.left_rooms': unknown;
    'app.prinny.auto_join': unknown;
    'app.prinny.presence': unknown;
  }

  interface StateEvents {
    'im.ponies.room_emotes': unknown;
    'm.room.image_pack': unknown;
    'in.cinny.room.power_level_tags': unknown;
  }
}

export {};
