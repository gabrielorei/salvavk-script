// Salva VK — sistema independente de avisos
// Renderização do aviso: conteúdo editável separadamente em announcements_content.js.
// O texto e o identificador de cada aviso ficam em modules/announcements_content.js.
let announcementTimer = null;
let announcementWrap = null;
let announcementKeyHandler = null;

SalvaVK.modules.register({
    id: 'announcements',
    version: '1.0.0',
    apiVersion: 1,
    start(api) {
        const store = api.storage.forModule('announcements');
        const addStyle = api.ui.addStyle;
        const TOPIC_RE = new RegExp(api.ui.selectors.topic);
        const LIST_SELECTOR = '[data-testid="board-comments-list"]';
        const STYLE_ID = 'vk-ar-announcements-css';
        let done = false;

        const css = `
.svka-wrap{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:4vh 0;background:rgba(0,0,0,.5);animation:svka-fade .18s ease-out both}
.svka-box,.svka-box *{box-sizing:border-box}
.svka-box{--svka-bg:var(--vkui--color_background_modal,#fff);--svka-fg:var(--vkui--color_text_primary,#000);--svka-fg2:var(--vkui--color_text_secondary,#6d7885);--svka-ac:var(--vkui--color_text_accent,#2a5885);--svka-line:rgba(128,128,128,.28);width:min(660px,92vw);min-height:330px;aspect-ratio:2/1;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:15px;line-height:1.3;display:grid;grid-template-columns:38% 1fr;overflow:hidden;border-radius:1.1em;background:var(--svka-bg);color:var(--svka-fg);text-align:left;box-shadow:0 1.2em 3.5em rgba(0,0,0,.35);animation:svka-pop .22s cubic-bezier(.2,.9,.3,1) both}
html[data-ar-dark] .svka-box{--svka-bg:var(--vkui--color_background_modal,#232324);--svka-fg:var(--vkui--color_text_primary,#e1e3e6);--svka-fg2:#d2d6dd;--svka-ac:var(--vkui--color_text_accent,#71aaeb)}
.svka-art{background:color-mix(in srgb,var(--svka-ac) 8%,var(--svka-bg));border-right:1px solid var(--svka-line);padding:1.3em 1.1em;display:flex;align-items:center;justify-content:center}
.svka-emoji-stage{position:relative;width:8.7em;height:8.7em;display:flex;align-items:center;justify-content:center}
.svka-emoji{position:absolute;display:flex;align-items:center;justify-content:center;width:3.9em;height:3.9em;border-radius:50%;background:var(--svka-bg);box-shadow:0 .35em 1.1em rgba(0,0,0,.13);font-size:2.35em}
.svka-emoji:nth-child(1){left:.1em;top:.5em;z-index:1;transform:rotate(-12deg)}
.svka-emoji:nth-child(2){right:.1em;top:.15em;z-index:2;transform:rotate(9deg)}
.svka-emoji:nth-child(3){left:2.45em;bottom:.05em;z-index:3;transform:rotate(-4deg)}
.svka-txt{padding:1.25em 1.5em 1.1em;display:flex;flex-direction:column;min-width:0}
.svka-eye{font-size:.7em;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--svka-ac)}
.svka-h{margin:.15em 0 .45em;font-size:1.28em;font-weight:700;line-height:1.2;color:var(--svka-fg)}
.svka-p{margin:0 0 1.1em;font-size:.82em;line-height:1.42;color:var(--svka-fg2)}
.svka-li{display:flex;align-items:center;gap:.8em;margin:0 0 .9em}
.svka-ic{flex:none;width:2.4em;height:2.4em;display:flex;align-items:center;justify-content:center;color:var(--svka-ac)}
.svka-ic svg{width:1.8em;height:1.8em;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.svka-t{font-size:.82em;line-height:1.38;color:var(--svka-fg2)}
.svka-ok{margin-top:auto;align-self:flex-end;appearance:none;border:0;cursor:pointer;font:inherit;font-size:.88em;font-weight:700;color:#fff;background:var(--svka-ac);padding:.5em 1.5em;border-radius:.6em;transition:filter .12s}
html[data-ar-dark] .svka-ok{color:#111}.svka-ok:hover{filter:brightness(1.1)}.svka-ok:focus-visible{outline:.1em solid var(--svka-ac);outline-offset:.14em}
@media(max-width:600px){.svka-box{aspect-ratio:auto;grid-template-columns:1fr;font-size:14px;width:92vw;min-height:0;max-height:92vh;overflow:auto}.svka-art{border-right:0;border-bottom:1px solid var(--svka-line);padding:.7em}.svka-emoji-stage{width:6.8em;height:6.8em}.svka-emoji{width:3.1em;height:3.1em;font-size:1.9em}.svka-emoji:nth-child(3){left:1.9em}.svka-txt{padding:1em 1.1em}}
@keyframes svka-fade{from{opacity:0}to{opacity:1}}@keyframes svka-pop{from{opacity:0;transform:translateY(.8em) scale(.97)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.svka-wrap,.svka-box{animation:none!important}}
`;
        function icon(kind) {
            if (kind === 'bell') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>';
            return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8z"></path></svg>';
        }
        function make(tag, className, text) {
            const el = document.createElement(tag);
            if (className) el.className = className;
            if (text != null) el.textContent = text;
            return el;
        }
        function close() {
            if (!announcementWrap) return;
            if (announcementKeyHandler) document.removeEventListener('keydown', announcementKeyHandler, true);
            announcementWrap.remove();
            announcementWrap = null;
            announcementKeyHandler = null;
        }
        let okButton = null;
        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            if (e.key === 'Tab' && okButton) { e.preventDefault(); okButton.focus(); }
        }
        function show(data) {
            addStyle(css, STYLE_ID);
            const prev = document.activeElement;
            const wrap = make('div', 'svka-wrap');
            const box = make('div', 'svka-box');
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            box.setAttribute('aria-labelledby', 'svka-announcement-title');

            const art = make('div', 'svka-art');
            const stage = make('div', 'svka-emoji-stage');
            ['😂', '🙄', '😢'].forEach(emoji => stage.appendChild(make('span', 'svka-emoji', emoji)));
            art.appendChild(stage);

            const body = make('div', 'svka-txt');
            body.appendChild(make('div', 'svka-eye', data.eyebrow || 'Novidade'));
            const title = make('h2', 'svka-h', data.title || 'Novidade');
            title.id = 'svka-announcement-title';
            body.appendChild(title);
            body.appendChild(make('p', 'svka-p', data.intro || ''));

            const rows = [
                { kind: 'bell', text: data.notifications || '' },
                { kind: 'heart', text: data.nativeLike || '' }
            ];
            rows.forEach(row => {
                const line = make('div', 'svka-li');
                const visual = make('div', 'svka-ic');
                visual.innerHTML = icon(row.kind);
                line.append(visual, make('div', 'svka-t', row.text));
                body.appendChild(line);
            });

            okButton = make('button', 'svka-ok', 'Entendi');
            okButton.type = 'button';
            okButton.addEventListener('click', () => {
                close();
                try { prev && prev.focus({ preventScroll: true }); } catch (e) {}
            });
            body.appendChild(okButton);
            box.append(art, body);
            wrap.appendChild(box);
            wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
            announcementWrap = wrap;
            announcementKeyHandler = onKey;
            document.addEventListener('keydown', announcementKeyHandler, true);
            (document.body || document.documentElement).appendChild(wrap);
            try { okButton.focus({ preventScroll: true }); } catch (e) {}
        }
        function tick() {
            if (done || announcementWrap || document.querySelector('.svka-wrap') || !document.body || !TOPIC_RE.test(location.pathname)) return;
            if (document.visibilityState !== 'visible' || !document.querySelector(LIST_SELECTOR)) return;
            const data = store.json('content', null);
            if (!data || !data.id) return;
            if (store.get('seen_id') === data.id) { done = true; return; }
            done = true;
            store.set('seen_id', data.id);
            try { show(data); } catch (error) { console.error('[Salva VK · Avisos]', error); }
        }
        announcementTimer = setInterval(() => { try { tick(); } catch (e) {} }, 1000);
    },
    stop() {
        if (announcementTimer != null) clearInterval(announcementTimer);
        announcementTimer = null;
        if (announcementWrap) { announcementWrap.remove(); announcementWrap = null; }
        if (announcementKeyHandler) document.removeEventListener('keydown', announcementKeyHandler, true);
        announcementKeyHandler = null;
    }
});
