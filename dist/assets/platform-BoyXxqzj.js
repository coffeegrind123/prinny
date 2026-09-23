const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/dist-js-C2nftEJl.js","assets/core-CGI43Uw5.js","assets/rolldown-runtime-B0Z9INg1.js"])))=>i.map(i=>d[i]);
import { r as e } from "./rolldown-runtime-B0Z9INg1.js";
import { t } from "./preload-helper-Czpn1I53.js";
import { a as n, __tla as __tla_0 } from "./desktop-notifications-CAoLCV_6.js";
let r, c, o, s, a;
let __tla = Promise.all([
    (()=>{
        try {
            return __tla_0;
        } catch  {}
    })()
]).then(async ()=>{
    let i;
    r = e({
        getTauriPlatform: ()=>a,
        isAndroid: ()=>o,
        isMobile: ()=>s,
        isTauriDesktop: ()=>c
    });
    i = null;
    a = async function() {
        if (!n()) return null;
        if (i !== null) return i;
        try {
            return i = (await t(()=>import(`./dist-js-C2nftEJl.js`).then(async (m)=>{
                    await m.__tla;
                    return m;
                }), __vite__mapDeps([0,1,2]))).platform(), i;
        } catch  {
            return null;
        }
    };
    o = async function() {
        return await a() === `android`;
    };
    s = async function() {
        let e = await a();
        return e === `android` || e === `ios`;
    };
    c = async function() {
        let e = await a();
        return e === `windows` || e === `macos` || e === `linux`;
    };
});
export { r as a, c as i, o as n, s as r, a as t, __tla };
