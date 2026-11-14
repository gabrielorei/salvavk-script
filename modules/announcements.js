// Salva VK — sistema independente de avisos
// Renderização do aviso: conteúdo editável separadamente em announcements_content.js.
// O texto e o identificador de cada aviso ficam em modules/announcements_content.js.
let announcementTimer = null;
let announcementWrap = null;
let announcementKeyHandler = null;

SalvaVK.modules.register({
    id: 'announcements',
    version: '2.6.0',
    apiVersion: 1,
    start(api) {
        const store = api.storage.forModule('announcements');
        const addStyle = api.ui.addStyle;
        const TOPIC_RE = new RegExp(api.ui.selectors.topic);
        const LIST_SELECTOR = '[data-testid="board-comments-list"]';
        const STYLE_ID = 'vk-ar-announcements-css';
        let done = false;
        let okButton = null;

        const css = `
.svka-wrap{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:4vh 0;background:rgba(0,0,0,.5);animation:svka-fade .18s ease-out both}
.svka-box,.svka-box *{box-sizing:border-box}
.svka-box{--svka-bg:var(--vkui--color_background_modal,#fff);--svka-fg:var(--vkui--color_text_primary,#000);--svka-fg2:var(--vkui--color_text_secondary,#6d7885);--svka-ac:var(--vkui--color_text_accent,#2a5885);--svka-line:rgba(128,128,128,.28);--svka-sk:color-mix(in srgb,var(--svka-fg) 13%,transparent);--svka-card:color-mix(in srgb,var(--svka-fg) 6%,var(--svka-bg));width:min(700px,94vw);max-height:92vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:15px;line-height:1.3;display:grid;grid-template-columns:38% 1fr;overflow:hidden;border-radius:1.1em;background:var(--svka-bg);color:var(--svka-fg);text-align:left;box-shadow:0 1.2em 3.5em rgba(0,0,0,.35);animation:svka-pop .22s cubic-bezier(.2,.9,.3,1) both}
html[data-ar-dark] .svka-box{--svka-bg:var(--vkui--color_background_modal,#232324);--svka-fg:var(--vkui--color_text_primary,#e1e3e6);--svka-fg2:#d2d6dd;--svka-ac:var(--vkui--color_text_accent,#71aaeb)}

/* Painel esquerdo: prévia + dica */
.svka-art{display:flex;flex-direction:column;justify-content:space-between;gap:1em;padding:1.1em;background:color-mix(in srgb,var(--svka-ac) 6%,var(--svka-bg));border-right:1px solid var(--svka-line)}
.svka-prev{display:flex;flex-direction:column;gap:.6em}
.svka-card{border-radius:.75em;padding:.75em .8em;background:var(--svka-card)}
.svka-card.on{border-left:.2em solid var(--svka-ac);padding-left:.7em}
.svka-head{margin:0 0 .55em;font-size:.78em;font-weight:700;color:var(--svka-fg)}
.svka-crow{display:flex;gap:.65em;align-items:flex-start}
.svka-av{flex:none;width:2.1em;height:2.1em;border-radius:50%;background:var(--svka-sk)}
.svka-lines{flex:1;min-width:0;display:flex;flex-direction:column;gap:.45em;padding-top:.2em}
.svka-sk{height:.45em;border-radius:.3em;background:var(--svka-sk)}
.svka-bar{display:flex;align-items:center;gap:.25em;width:fit-content;margin:.7em 0 0 auto;padding:.15em .6em;border-radius:2em;font-size:.98em;line-height:1;background:var(--svka-bg);box-shadow:0 .15em .7em rgba(0,0,0,.12)}
.svka-bar span{display:block;padding:.3em;border-radius:.6em}
.svka-bar span.on{font-size:1.2em;background:color-mix(in srgb,var(--svka-fg) 5%,transparent)}
.svka-fill{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;padding:.3em 0;opacity:.10;filter:grayscale(.5);pointer-events:none;user-select:none;-webkit-mask-image:linear-gradient(transparent,#000 10%,#000 90%,transparent);mask-image:linear-gradient(transparent,#000 10%,#000 90%,transparent)}
.svka-fill>div{display:flex;line-height:1}
.svka-fill>.a{padding:0 12.5%}
.svka-fill>.a span{flex:0 0 33.333%}
.svka-fill>.b span{flex:0 0 25%}
.svka-fill span{text-align:center;font-size:1.75em}
.svka-foot{display:flex;justify-content:flex-end;margin-top:.5em;color:var(--svka-ac)}
.svka-foot .svka-ic{width:1.3em;height:1.3em}
.svka-foot .svka-ic svg{width:1.1em;height:1.1em}
.svka-foot .svka-ic path{fill:color-mix(in srgb,var(--svka-ac) 30%,transparent)}
.svka-hint{display:flex;align-items:center;gap:.65em;font-size:.76em;line-height:1.4;color:var(--svka-fg2)}
.svka-hint strong{color:var(--svka-fg)}
.svka-hint .svka-ic{color:var(--svka-ac)}

/* Painel direito: texto */
.svka-txt{padding:1.25em 1.5em 1.15em;display:flex;flex-direction:column;min-width:0;overflow:auto}
.svka-eye{font-size:.7em;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--svka-ac)}
.svka-h{margin:.15em 0 .45em;font-size:1.34em;font-weight:700;line-height:1.2;color:var(--svka-fg)}
.svka-p{margin:0 0 1.15em;font-size:.86em;line-height:1.42;color:var(--svka-fg2)}
.svka-p strong,.svka-t strong{color:var(--svka-fg);font-weight:700}
.svka-li{display:flex;align-items:center;gap:.6em;margin:0 0 1em}
.svka-ics{flex:none;width:3.6em;display:flex;align-items:center;justify-content:center}
.svka-chev{flex:none;font-size:1.3em;line-height:1;color:var(--svka-fg2);opacity:.75}
.svka-ic{flex:none;width:1.75em;height:1.75em;display:flex;align-items:center;justify-content:center}
.svka-ic svg{width:1.6em;height:1.6em;overflow:visible}
.svka-emo{position:relative;width:3.2em;height:3.35em}
.svka-eb{position:absolute;display:flex;align-items:center;justify-content:center;width:1.8em;height:1.8em;border-radius:50%;line-height:1;border:.1em solid color-mix(in srgb,var(--svka-ac) 65%,transparent);background:color-mix(in srgb,var(--svka-ac) 14%,var(--svka-bg));box-shadow:0 0 0 .14em var(--svka-bg)}
.svka-eb>span{display:block;font-size:1.05em;line-height:1}
.svka-eb:nth-child(1){left:1.4em;top:0;z-index:3}
.svka-eb:nth-child(2){left:0;top:.75em;z-index:1}
.svka-eb:nth-child(3){left:1.3em;top:1.55em;z-index:2}
.svka-lt{min-width:0}
.svka-lh{display:flex;align-items:center;flex-wrap:wrap;gap:.5em;font-size:.95em;font-weight:700;line-height:1.25;color:var(--svka-fg)}
.svka-badge{font-size:.7em;font-weight:700;line-height:1;padding:.32em .6em;border-radius:2em;color:var(--svka-ac);background:color-mix(in srgb,var(--svka-ac) 16%,transparent)}
.svka-t{margin-top:.15em;font-size:.82em;line-height:1.38;color:var(--svka-fg2)}
.svka-ok{margin-top:auto;align-self:flex-end;appearance:none;border:0;cursor:pointer;font:inherit;font-size:.9em;font-weight:700;color:#fff;background:var(--svka-ac);padding:.55em 1.6em;border-radius:.7em;transition:filter .12s}
html[data-ar-dark] .svka-ok{color:#111}
.svka-ok:hover{filter:brightness(1.1)}
.svka-ok:focus-visible{outline:.12em solid var(--svka-ac);outline-offset:.14em}

@media(max-width:600px){
.svka-box{grid-template-columns:1fr;font-size:14px;width:92vw;overflow:auto}
.svka-art{border-right:0;border-bottom:1px solid var(--svka-line);padding:.8em}
.svka-hint,.svka-fill{display:none}
.svka-txt{padding:1em 1.1em;overflow:visible}
}
@keyframes svka-fade{from{opacity:0}to{opacity:1}}
@keyframes svka-pop{from{opacity:0;transform:translateY(.8em) scale(.97)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.svka-wrap,.svka-box{animation:none!important}}
`;

        // Biblioteca de ícones (24x24). shape = preenchível; line = sempre traço; cut = detalhes internos.
        const ICONS = {
            heart: { shape: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8z' },
            bell: { shape: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', line: 'M10 21h4' },
            smile: { shape: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', cut: 'M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01' },
            pin: { shape: 'M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2v.8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z', line: 'M12 17v5' },
            bookmark: { shape: 'm19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z' }
        };
        function icon(name, filled) {
            const d = ICONS[name] || ICONS.heart;
            const stroke = 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
            let svg = '<svg viewBox="0 0 24 24" aria-hidden="true">';
            svg += '<path d="' + d.shape + '" ' + stroke + ' fill="' + (filled ? 'currentColor' : 'none') + '"></path>';
            if (d.line) svg += '<path d="' + d.line + '" fill="none" ' + stroke + '></path>';
            if (d.cut) {
                svg += '<path d="' + d.cut + '" fill="none" stroke="' + (filled ? 'var(--svka-bg)' : 'currentColor') + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>';
            }
            return svg + '</svg>';
        }
        function iconBox(name, filled, color) {
            const box = make('span', 'svka-ic');
            box.innerHTML = icon(name, filled); // string fixa do próprio código, sem dados externos
            if (color) box.style.color = color;
            return box;
        }
        function make(tag, className, text) {
            const el = document.createElement(tag);
            if (className) el.className = className;
            if (text != null) el.textContent = text;
            return el;
        }
        // Texto com **negrito**, montado sem innerHTML.
        function rich(el, text) {
            String(text || '').split('**').forEach((part, i) => {
                if (!part) return;
                if (i % 2) el.appendChild(make('strong', null, part));
                else el.appendChild(document.createTextNode(part));
            });
            return el;
        }
        function close() {
            if (!announcementWrap) return;
            if (announcementKeyHandler) document.removeEventListener('keydown', announcementKeyHandler, true);
            announcementWrap.remove();
            announcementWrap = null;
            announcementKeyHandler = null;
        }
        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            if (e.key === 'Tab' && okButton) { e.preventDefault(); okButton.focus(); }
        }

        function buildPreview(prev) {
            const stack = make('div', 'svka-prev');

            const card = make('div', 'svka-card on');
            if (prev.title) card.appendChild(make('div', 'svka-head', prev.title));
            const row = make('div', 'svka-crow');
            row.appendChild(make('div', 'svka-av'));
            const lines = make('div', 'svka-lines');
            ['100%', '82%', '52%'].forEach(w => {
                const sk = make('div', 'svka-sk');
                sk.style.width = w;
                lines.appendChild(sk);
            });
            row.appendChild(lines);
            card.appendChild(row);
            if (Array.isArray(prev.reactions) && prev.reactions.length) {
                const bar = make('div', 'svka-bar');
                bar.setAttribute('aria-hidden', 'true');
                prev.reactions.forEach((r, i) => bar.appendChild(make('span', i === prev.active ? 'on' : null, r)));
                card.appendChild(bar);
                const foot = make('div', 'svka-foot');
                foot.appendChild(iconBox('heart', false));
                card.appendChild(foot);
            }
            stack.appendChild(card);

            return stack;
        }

        // Reações em baixa opacidade, em grade alternada 3-4-3, só como textura.
        function buildAmbient(list) {
            const fill = make('div', 'svka-fill');
            fill.setAttribute('aria-hidden', 'true');
            let i = 0, r = 0;
            while (i < list.length) {
                const wide = r % 2 === 1;
                const size = wide ? 4 : 3;
                const row = make('div', wide ? 'b' : 'a');
                list.slice(i, i + size).forEach(e => row.appendChild(make('span', null, e)));
                fill.appendChild(row);
                i += size; r++;
            }
            return fill;
        }

        function show(data) {
            addStyle(css, STYLE_ID);
            const lastFocus = document.activeElement;
            const wrap = make('div', 'svka-wrap');
            const box = make('div', 'svka-box');
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            box.setAttribute('aria-labelledby', 'svka-announcement-title');

            // Painel esquerdo
            const art = make('div', 'svka-art');
            if (data.preview) art.appendChild(buildPreview(data.preview));
            if (data.preview && Array.isArray(data.preview.ambient) && data.preview.ambient.length) {
                art.appendChild(buildAmbient(data.preview.ambient));
            }
            if (data.hint && data.hint.text) {
                const hint = make('div', 'svka-hint');
                hint.appendChild(iconBox(data.hint.icon || 'bell', false));
                hint.appendChild(rich(make('div'), data.hint.text));
                art.appendChild(hint);
            }

            // Painel direito
            const body = make('div', 'svka-txt');
            body.appendChild(make('div', 'svka-eye', data.eyebrow || 'Novidade'));
            const title = make('h2', 'svka-h', data.title || 'Novidade');
            title.id = 'svka-announcement-title';
            body.appendChild(title);
            if (data.intro) body.appendChild(rich(make('p', 'svka-p'), data.intro));

            (Array.isArray(data.items) ? data.items : []).forEach(item => {
                const line = make('div', 'svka-li');
                const ics = make('div', 'svka-ics');
                if (Array.isArray(item.emojis) && item.emojis.length) {
                    const emo = make('span', 'svka-emo');
                    item.emojis.slice(0, 3).forEach(e => {
                        const eb = make('span', 'svka-eb');
                        eb.appendChild(make('span', null, e));
                        emo.appendChild(eb);
                    });
                    ics.appendChild(emo);
                } else {
                    ics.appendChild(iconBox(item.icon || 'heart', true, item.color));
                }

                const lt = make('div', 'svka-lt');
                const head = make('div', 'svka-lh');
                head.appendChild(make('span', null, item.title || ''));
                if (item.badge) head.appendChild(make('span', 'svka-badge', item.badge));
                lt.appendChild(head);
                if (item.text) lt.appendChild(rich(make('div', 'svka-t'), item.text));

                line.append(ics, make('span', 'svka-chev', '›'), lt);
                body.appendChild(line);
            });

            okButton = make('button', 'svka-ok', data.button || 'Entendi');
            okButton.type = 'button';
            okButton.addEventListener('click', () => {
                close();
                try { lastFocus && lastFocus.focus({ preventScroll: true }); } catch (e) {}
            });
            body.appendChild(okButton);

            box.append(art, body);
            wrap.appendChild(box);
            wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
            announcementWrap = wrap;
            announcementKeyHandler = onKey;
            document.addEventListener('keydown', announcementKeyHandler, true);
            (document.body || document.documentElement).appendChild(wrap);
        }

        function tick() {
            if (done || announcementWrap || document.querySelector('.svka-wrap') || !document.body || !TOPIC_RE.test(location.pathname)) return;
            if (document.visibilityState !== 'visible' || !document.querySelector(LIST_SELECTOR)) return;
            const data = store.json('content', null);
            if (!data || !data.id) return;
            if (store.get('seen_id') === data.id) { done = true; return; }
            done = true;
            try {
                show(data);
                store.set('seen_id', data.id); // só marca como visto se o aviso realmente abriu
            } catch (error) {
                console.error('[Salva VK · Avisos]', error);
                close();
            }
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
