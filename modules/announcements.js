// Salva VK — sistema independente de avisos
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
.ari-wrap{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:4vh 0;background:rgba(0,0,0,.5);animation:ari-fade .18s ease-out both}
.ari-box,.ari-box *{box-sizing:border-box}
.ari-box{--ari-bg:var(--vkui--color_background_modal,#fff);--ari-fg:var(--vkui--color_text_primary,#000);--ari-fg2:var(--vkui--color_text_secondary,#6d7885);--ari-ac:var(--vkui--color_text_accent,#2a5885);--ari-line:rgba(128,128,128,.28);--ari-w:min(660px,92vw,calc(86vh * 2));width:var(--ari-w);aspect-ratio:2/1;font:calc(var(--ari-w) / 41)/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;display:grid;grid-template-columns:38% 1fr;overflow:hidden;border-radius:1.1em;background:var(--ari-bg);color:var(--ari-fg);text-align:left;box-shadow:0 1.2em 3.5em rgba(0,0,0,.35);animation:ari-pop .22s cubic-bezier(.2,.9,.3,1) both}
html[data-ar-dark] .ari-box{--ari-bg:var(--vkui--color_background_modal,#232324);--ari-fg:var(--vkui--color_text_primary,#e1e3e6);--ari-fg2:#d2d6dd;--ari-ac:var(--vkui--color_text_accent,#71aaeb)}
.ari-art{background:color-mix(in srgb,var(--ari-ac) 8%,var(--ari-bg));border-right:1px solid var(--ari-line);padding:1.3em 1.1em;display:flex;align-items:center;justify-content:center}
.ari-emoji-stage{position:relative;width:8.7em;height:8.7em;display:flex;align-items:center;justify-content:center}
.ari-emoji{position:absolute;display:flex;align-items:center;justify-content:center;width:3.9em;height:3.9em;border-radius:50%;background:var(--ari-bg);box-shadow:0 .35em 1.1em rgba(0,0,0,.13);font-size:2.35em}
.ari-emoji:nth-child(1){left:.1em;top:.5em;z-index:1;transform:rotate(-12deg)}
.ari-emoji:nth-child(2){right:.1em;top:.15em;z-index:2;transform:rotate(9deg)}
.ari-emoji:nth-child(3){left:2.45em;bottom:.05em;z-index:3;transform:rotate(-4deg)}
.ari-txt{padding:1.25em 1.5em 1.1em;display:flex;flex-direction:column;min-width:0}
.ari-eye{font-size:.7em;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--ari-ac)}
.ari-h{margin:.15em 0 .45em;font-size:1.28em;font-weight:700;line-height:1.2;color:var(--ari-fg)}
.ari-p{margin:0 0 1.1em;font-size:.82em;line-height:1.42;color:var(--ari-fg2)}
.ari-li{display:flex;align-items:center;gap:.8em;margin:0 0 .9em}
.ari-ic{flex:none;width:2.4em;height:2.4em;display:flex;align-items:center;justify-content:center;color:var(--ari-ac)}
.ari-ic svg{width:1.8em;height:1.8em;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ari-t{font-size:.82em;line-height:1.38;color:var(--ari-fg2)}
.ari-ok{margin-top:auto;align-self:flex-end;appearance:none;border:0;cursor:pointer;font:inherit;font-size:.88em;font-weight:700;color:#fff;background:var(--ari-ac);padding:.5em 1.5em;border-radius:.6em;transition:filter .12s}
html[data-ar-dark] .ari-ok{color:#111}.ari-ok:hover{filter:brightness(1.1)}.ari-ok:focus-visible{outline:.1em solid var(--ari-ac);outline-offset:.14em}
@media(max-width:600px){.ari-box{aspect-ratio:auto;grid-template-columns:1fr;font-size:14px;width:92vw;max-height:92vh;overflow:auto}.ari-art{border-right:0;border-bottom:1px solid var(--ari-line);padding:.7em}.ari-emoji-stage{width:6.8em;height:6.8em}.ari-emoji{width:3.1em;height:3.1em;font-size:1.9em}.ari-emoji:nth-child(3){left:1.9em}.ari-txt{padding:1em 1.1em}}
@keyframes ari-fade{from{opacity:0}to{opacity:1}}@keyframes ari-pop{from{opacity:0;transform:translateY(.8em) scale(.97)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.ari-wrap,.ari-box{animation:none!important}}
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
            const wrap = make('div', 'ari-wrap');
            const box = make('div', 'ari-box');
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            box.setAttribute('aria-labelledby', 'ari-announcement-title');

            const art = make('div', 'ari-art');
            const stage = make('div', 'ari-emoji-stage');
            ['😂', '🙄', '😢'].forEach(emoji => stage.appendChild(make('span', 'ari-emoji', emoji)));
            art.appendChild(stage);

            const body = make('div', 'ari-txt');
            body.appendChild(make('div', 'ari-eye', data.eyebrow || 'Novidade'));
            const title = make('h2', 'ari-h', data.title || 'Novidade');
            title.id = 'ari-announcement-title';
            body.appendChild(title);
            body.appendChild(make('p', 'ari-p', data.intro || ''));

            const rows = [
                { kind: 'bell', text: data.notifications || '' },
                { kind: 'heart', text: data.nativeLike || '' }
            ];
            rows.forEach(row => {
                const line = make('div', 'ari-li');
                const visual = make('div', 'ari-ic');
                visual.innerHTML = icon(row.kind);
                line.append(visual, make('div', 'ari-t', row.text));
                body.appendChild(line);
            });

            okButton = make('button', 'ari-ok', 'Entendi');
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
            if (done || announcementWrap || !document.body || !TOPIC_RE.test(location.pathname)) return;
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
