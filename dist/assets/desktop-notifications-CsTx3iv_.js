const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/dist-js-1-t5gZ4t.js","assets/core-CGI43Uw5.js","assets/rolldown-runtime-B0Z9INg1.js","assets/platform-s_O7oK-3.js","assets/preload-helper-Czpn1I53.js","assets/event-DWBRSZIL.js"])))=>i.map(i=>d[i]);
import { t as e } from "./preload-helper-Czpn1I53.js";
let i, f, T, p, D, l, c, E, m, o, _, C;
let __tla = (async ()=>{
    var t = null, n = !1;
    async function r() {
        if (n) return t;
        n = !0;
        try {
            i() && (t = await e(()=>import(`./dist-js-1-t5gZ4t.js`).then(async (m)=>{
                    await m.__tla;
                    return m;
                }), __vite__mapDeps([0,1,2])));
        } catch (e) {
            console.error(`[notif] Failed to load @tauri-apps/plugin-notification:`, e);
        }
        return t;
    }
    i = function() {
        return `__TAURI__` in window || `__TAURI_INTERNALS__` in window;
    };
    var a = !1;
    o = async function() {
        if (!a && i() && !(typeof window > `u` || !(`Notification` in window))) {
            a = !0;
            try {
                let { getTauriPlatform: t } = await e(async ()=>{
                    let { getTauriPlatform: e } = await import(`./platform-s_O7oK-3.js`).then(async (m)=>{
                        await m.__tla;
                        return m;
                    }).then((e)=>e.i);
                    return {
                        getTauriPlatform: e
                    };
                }, __vite__mapDeps([3,2,4])), n = await t();
                if (n !== `windows` && n !== `macos` && n !== `linux` || window.Notification.permission === `granted`) return;
                let i = await r();
                if (!i) return;
                await i.requestPermission();
            } catch (e) {
                console.warn(`[notif] primeDesktopNotificationPermission failed:`, e), a = !1;
            }
        }
    };
    var s = `androidNotifPermissionAsked`;
    c = async function() {
        if (i()) try {
            let { getTauriPlatform: t } = await e(async ()=>{
                let { getTauriPlatform: e } = await import(`./platform-s_O7oK-3.js`).then(async (m)=>{
                    await m.__tla;
                    return m;
                }).then((e)=>e.i);
                return {
                    getTauriPlatform: e
                };
            }, __vite__mapDeps([3,2,4]));
            if (await t() !== `android` || await f()) return;
            try {
                if (localStorage.getItem(s) === `1`) return;
                localStorage.setItem(s, `1`);
            } catch  {}
            p(await l() === `granted`);
        } catch (e) {
            console.warn(`[notif] ensureAndroidNotificationPermission failed:`, e);
        }
    };
    l = async function() {
        if (i()) {
            let e = await r();
            if (e) try {
                return await e.requestPermission();
            } catch (e) {
                console.error(`[notif] requestPermission failed:`, e);
            }
        }
        if (!(`Notification` in window)) return `denied`;
        try {
            let e = window.Notification.requestPermission();
            return e instanceof Promise ? await e : e;
        } catch  {
            return `denied`;
        }
    };
    var u;
    async function d() {
        if (i()) try {
            let { invoke: t } = await e(async ()=>{
                let { invoke: e } = await import(`./core-CGI43Uw5.js`).then(async (m)=>{
                    await m.__tla;
                    return m;
                }).then((e)=>e.a);
                return {
                    invoke: e
                };
            }, __vite__mapDeps([1,2])), n = await t(`plugin:notification|is_permission_granted`);
            return typeof n == `boolean` ? n : void 0;
        } catch (e) {
            console.warn(`[notif] is_permission_granted query failed:`, e);
            return;
        }
        return `Notification` in window && window.Notification.permission === `granted`;
    }
    f = async function() {
        let e = await d();
        return e === void 0 ? D() : (u = e, e);
    };
    p = function(e) {
        u = e;
    };
    m = function() {
        return u;
    };
    var h = !1;
    async function g() {
        if (h) return;
        h = !0;
        let e = await r();
        if (e) try {
            await e.registerActionTypes([
                {
                    id: `message`,
                    actions: [
                        {
                            id: `open`,
                            title: `Open`,
                            foreground: !0
                        }
                    ]
                }
            ]);
        } catch (e) {
            console.error(`[notif] Failed to register action types:`, e);
        }
    }
    let v, y;
    _ = `full`;
    v = `New message`;
    y = `New message`;
    function b(e, t, n = _) {
        return n === `hidden` ? {
            title: y,
            body: ``
        } : n === `sender-only` ? {
            title: e,
            body: v
        } : {
            title: e,
            body: t ?? ``
        };
    }
    var x = new Map;
    async function S(e) {
        if (x.has(e)) return x.get(e);
        try {
            let t = await fetch(e);
            if (!t.ok) return;
            let n = await t.blob(), r = await new Promise((e)=>{
                let t = new FileReader;
                t.onloadend = ()=>e(t.result), t.readAsDataURL(n);
            });
            return x.set(e, r), r;
        } catch  {
            return;
        }
    }
    C = async function(t, n, r, i) {
        if (!i && x.has(t)) return x.get(t);
        try {
            let { invoke: a } = await e(async ()=>{
                let { invoke: e } = await import(`./core-CGI43Uw5.js`).then(async (m)=>{
                    await m.__tla;
                    return m;
                }).then((e)=>e.a);
                return {
                    invoke: e
                };
            }, __vite__mapDeps([1,2])), o = await a(`cache_notification_icon`, {
                url: t,
                key: i ?? null,
                authHeader: n ?? null,
                homeserver: r ?? null
            });
            if (typeof o == `string` && o.length > 0) return i || x.set(t, o), o;
        } catch (e) {
            console.warn(`[notif] cache_notification_icon failed:`, e);
        }
    };
    async function w(t, n, r, i, a) {
        try {
            let { invoke: o } = await e(async ()=>{
                let { invoke: e } = await import(`./core-CGI43Uw5.js`).then(async (m)=>{
                    await m.__tla;
                    return m;
                }).then((e)=>e.a);
                return {
                    invoke: e
                };
            }, __vite__mapDeps([1,2]));
            return await o(`plugin:message-notification|show`, {
                title: t,
                body: n,
                iconPath: r,
                roomId: i,
                eventId: a
            }), !0;
        } catch (e) {
            return console.warn(`[notif] Android message-notification|show failed:`, e), !1;
        }
    }
    T = async function(t, n) {
        let { title: a, body: o } = b(t, n?.body, n?.contentMode), s = n?.icon, c = typeof s == `string` && (s.startsWith(`http://`) || s.startsWith(`https://`));
        if (i()) {
            let t;
            c && s ? t = await C(s, n?.iconAuthHeader, n?.iconHomeserver) : s && !s.startsWith(`data:`) && (t = s);
            let { getTauriPlatform: i } = await e(async ()=>{
                let { getTauriPlatform: e } = await import(`./platform-s_O7oK-3.js`).then(async (m)=>{
                    await m.__tla;
                    return m;
                }).then((e)=>e.i);
                return {
                    getTauriPlatform: e
                };
            }, __vite__mapDeps([3,2,4])), l = await i();
            if (l === `android` && await w(a, o, t, n?.roomId, n?.eventId)) return;
            if (l === `windows`) try {
                let { invoke: r } = await e(async ()=>{
                    let { invoke: e } = await import(`./core-CGI43Uw5.js`).then(async (m)=>{
                        await m.__tla;
                        return m;
                    }).then((e)=>e.a);
                    return {
                        invoke: e
                    };
                }, __vite__mapDeps([1,2]));
                await r(`send_windows_message_toast`, {
                    title: a,
                    body: o,
                    iconPath: t ?? null,
                    roomId: n?.roomId ?? ``,
                    eventId: n?.eventId ?? ``,
                    kind: n?.kind ?? ``
                });
                return;
            } catch (e) {
                console.warn(`[notif] send_windows_message_toast failed, falling back:`, e);
            }
            let u = await r();
            if (u && await u.isPermissionGranted()) {
                await g(), u.sendNotification({
                    title: a,
                    body: o,
                    icon: t,
                    actionTypeId: `message`,
                    extra: {
                        roomId: n?.roomId ?? ``,
                        eventId: n?.eventId ?? ``,
                        kind: n?.kind ?? ``
                    }
                });
                return;
            }
        }
        let l = s;
        c && s && (l = await S(s) ?? s), `Notification` in window && window.Notification.permission === `granted` && new window.Notification(a, {
            body: o,
            icon: l,
            silent: !0
        });
    };
    E = async function(t) {
        if (!i()) return ()=>{};
        let n = [], a = await r();
        if (a) try {
            let e = await a.onAction((e)=>{
                let n = e.extra;
                (n?.roomId || n?.kind) && t(n);
            });
            n.push(()=>{
                e.unregister();
            });
        } catch (e) {
            console.error(`[notif] Failed to register onAction listener:`, e);
        }
        try {
            let { listen: r } = await e(async ()=>{
                let { listen: e } = await import(`./event-DWBRSZIL.js`).then(async (m)=>{
                    await m.__tla;
                    return m;
                }).then((e)=>e.i);
                return {
                    listen: e
                };
            }, __vite__mapDeps([5,2,1])), i = await r(`notification://activated`, (e)=>{
                let n = e.payload;
                (n?.roomId || n?.kind) && t(n);
            });
            n.push(i);
        } catch (e) {
            console.error(`[notif] Failed to register notification://activated listener:`, e);
        }
        try {
            let { addPluginListener: r, invoke: i } = await e(async ()=>{
                let { addPluginListener: e, invoke: t } = await import(`./core-CGI43Uw5.js`).then(async (m)=>{
                    await m.__tla;
                    return m;
                }).then((e)=>e.a);
                return {
                    addPluginListener: e,
                    invoke: t
                };
            }, __vite__mapDeps([1,2])), a = await r(`message-notification`, `message-notification-clicked`, (e)=>{
                e?.roomId && t(e);
            });
            n.push(()=>{
                a.unregister();
            });
            try {
                await i(`plugin:message-notification|js_ready`);
            } catch  {}
        } catch (e) {
            console.error(`[notif] Failed to register message-notification-clicked listener:`, e);
        }
        return ()=>{
            n.forEach((e)=>{
                try {
                    e();
                } catch  {}
            });
        };
    };
    D = function() {
        if (u !== void 0) return u;
        if (i()) try {
            if (localStorage.getItem(`notifPermissionGranted`) === `1`) return !0;
        } catch  {}
        return `Notification` in window && window.Notification.permission === `granted`;
    };
})();
export { i as a, f as c, T as d, p as f, D as i, l, c as n, E as o, m as r, o as s, _ as t, C as u, __tla };
