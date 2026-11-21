// Salva VK — módulo de favoritos (tópicos e fóruns)
// Botão ☆ no topo de cada tópico/fórum + painel flutuante (acima do de jogos) com as abas Tópicos/Fóruns.
// Usa somente a API pública SalvaVK v1.
let favTimer = null;
let favSessionOff = null;
let favDockHandler = null;
let favResizeHandler = null;
let favClickHandler = null;

SalvaVK.modules.register({
    id: 'favorites',
    version: '1.3.0',
    apiVersion: 1,
    start(api) {
        const LS = api.storage.forModule('favorites');
        const mk = api.ui.mk;
        const BRAND = '#2a5885';          // mesma cor do painel de jogos
        const GOLD = '#f5b942';
        const FONT = '-apple-system,BlinkMacSystemFont,Roboto,sans-serif';
        const MAX_FAVS = 20, META_TTL_MS = 90 * 1000;
        const WIDGET_ID = 'vk-ar-fav-widget', STAR_ATTR = 'data-ar-fav-star';
        const TOPIC_RE = /^\/topic-?(\d+)_(\d+)/;
        const BOARD_RE = /^\/board-?(\d+)\/?$/;
        const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
        const fmt = n => Number(n).toLocaleString('pt-BR');
        const plural = (n, one, many) => fmt(n) + ' ' + (Number(n) === 1 ? one : many);

        api.ui.addStyle(`
.vk-ar-fav-star{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;margin-right:8px;box-sizing:border-box;
  border:1px solid rgba(128,128,128,.35);border-radius:8px;background:transparent;color:inherit;
  font:600 13px/1 ${FONT};cursor:pointer;vertical-align:middle;white-space:nowrap;transition:background .15s,border-color .15s}
.vk-ar-fav-star:hover{background:rgba(128,128,128,.14)}
.vk-ar-fav-star.is-fallback{margin:8px 0 0 4px}
.vk-ar-fav-star .vk-ar-fav-ico{font-size:15px;line-height:1}
.vk-ar-fav-star.is-on{border-color:${GOLD}}
.vk-ar-fav-star.is-on .vk-ar-fav-ico{color:${GOLD}}
.vk-ar-fav-tabs{display:flex;flex:0 0 auto;border-bottom:1px solid rgba(128,128,128,.18)}
.vk-ar-fav-tab{flex:1 1 0;padding:9px 6px;margin-bottom:-1px;background:none;border:0;border-bottom:2px solid transparent;color:inherit;
  opacity:.6;font:600 12px ${FONT};cursor:pointer;transition:opacity .15s}
.vk-ar-fav-tab:hover{opacity:.9}
.vk-ar-fav-tab.is-active{opacity:1;border-bottom-color:${BRAND}}
.vk-ar-fav-tab i{font-style:normal;font-weight:500;font-size:11px;opacity:.6;margin-left:4px}
.vk-ar-fav-list{overflow-y:auto;padding:4px 6px;display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
.vk-ar-fav-item{border-bottom:1px solid rgba(128,128,128,.14)}
.vk-ar-fav-item:last-child{border-bottom:0}
.vk-ar-fav-row{display:flex;align-items:center;gap:2px;margin:3px 0;padding:6px 4px 6px 10px;border-radius:8px}
.vk-ar-fav-row:hover{background:rgba(128,128,128,.1)}
.vk-ar-fav-main{flex:1 1 auto;min-width:0;color:inherit;text-decoration:none}
.vk-ar-fav-t{font-size:12.5px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.vk-ar-fav-s{margin-top:2px;font-size:11px;opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vk-ar-fav-x,.vk-ar-fav-chev{flex:0 0 auto;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:none;color:inherit;cursor:pointer;
  display:flex;align-items:center;justify-content:center}
.vk-ar-fav-x{font-size:11px;opacity:.3}
.vk-ar-fav-row:hover .vk-ar-fav-x{opacity:.7}
.vk-ar-fav-x:hover,.vk-ar-fav-chev:hover{opacity:1;background:rgba(128,128,128,.18)}
.vk-ar-fav-chev{font-size:18px;line-height:1;opacity:.6;transition:transform .15s}
.vk-ar-fav-chev.is-open{transform:rotate(90deg)}
.vk-ar-fav-sub{margin:0 6px 8px 14px;padding-left:10px;border-left:2px solid rgba(128,128,128,.25);display:flex;flex-direction:column;gap:1px}
.vk-ar-fav-sublink{display:flex;justify-content:space-between;gap:8px;padding:5px 6px;border-radius:6px;color:inherit;text-decoration:none;font-size:11.5px;line-height:1.3}
.vk-ar-fav-sublink:hover{background:rgba(128,128,128,.1)}
.vk-ar-fav-subt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vk-ar-fav-subd{flex:0 0 auto;font-size:10.5px;opacity:.55}
.vk-ar-fav-note{padding:6px;font-size:11px;opacity:.6}
.vk-ar-fav-empty{padding:24px 16px;text-align:center;font-size:12px;line-height:1.5;opacity:.65}
`, 'vk-ar-fav-css');

        // ---------- Armazenamento ----------
        const validFav = f => !!f && (f.type === 'topic' || f.type === 'board') && typeof f.key === 'string' &&
            Number.isSafeInteger(f.g) && f.g > 0 && (f.type === 'board' || (Number.isSafeInteger(f.t) && f.t > 0));
        const loadFavs = () => { const v = LS.json('items', []); return Array.isArray(v) ? v.filter(validFav) : []; };
        const saveFavs = list => LS.setJson('items', list.slice(0, MAX_FAVS));
        const hrefOf = f => f.type === 'board' ? '/board' + f.g : '/topic-' + f.g + '_' + f.t;
        function patchFav(key, patch) {
            const favs = loadFavs(), f = favs.find(x => x.key === key);
            if (!f) return;
            Object.assign(f, patch);
            saveFavs(favs);
        }

        // ---------- Página atual ----------
        function currentPage() {
            const path = location.pathname;
            let m = TOPIC_RE.exec(path);
            if (m) return { type: 'topic', g: Number(m[1]), t: Number(m[2]), key: 't:' + m[1] + '_' + m[2] };
            m = BOARD_RE.exec(path);
            if (m) return { type: 'board', g: Number(m[1]), t: 0, key: 'b:' + m[1] };
            return null;
        }
        function pageGroupName() {   // primeiro item do "Comunidade > Discussões > Tópico"
            const a = document.querySelector('h2 a[role="link"]');
            return a ? clean(a.textContent) : '';
        }
        function pageTitle(p) {
            if (p.type === 'board') return pageGroupName() || ('Fórum ' + p.g);
            const h1 = document.querySelector('h1');
            let t = h1 ? clean(h1.textContent) : '';
            if (!t) t = clean(document.title).replace(/\s*[|\-–—·]\s*(VK|ВКонтакте|VKontakte)\s*$/i, '');
            return t || ('Tópico ' + p.t);
        }

        // ---------- Botão ☆ no topo do tópico/fórum ----------
        function starTip(type, on) {
            const g = pageGroupName(), de = g ? ' da comunidade ' + g : ' da comunidade';
            if (type === 'board') return (on ? 'Remover dos favoritos o fórum' : 'Favoritar o fórum') + de;
            return (on ? 'Remover dos favoritos este tópico' : 'Favoritar este tópico') + de;
        }
        function paintStar(star, on) {
            star.classList.toggle('is-on', on);
            star.firstChild.textContent = on ? '★' : '☆';
            star.lastChild.textContent = on ? 'Favorito' : 'Favoritar';
            star.setAttribute('aria-pressed', on ? 'true' : 'false');
            const tip = starTip(star.dataset.type, on);
            if (star.title !== tip) star.title = tip;
        }
        function buildStar(p) {
            const b = mk('', null, 'button');
            b.type = 'button';
            b.className = 'vk-ar-fav-star';
            b.setAttribute(STAR_ATTR, '1');
            b.dataset.key = p.key;
            b.dataset.type = p.type;
            const ico = mk('', '☆', 'span');
            ico.className = 'vk-ar-fav-ico';
            b.append(ico, mk('', 'Favoritar', 'span'));
            b.addEventListener('click', ev => {
                ev.preventDefault(); ev.stopPropagation();
                toggleFav(currentPage() || p, b);
            }, true);
            return b;
        }
        function findAnchor(p) {   // botão principal do cabeçalho: nosso "Atualizar Fórum" (fórum) ou "Editar o tópico" (tópico)
            if (p.type === 'board') {   // enquanto o "Atualizar Fórum" não entrou, usa o "Criar um tópico" para o ☆ já nascer no cabeçalho
                const own = document.querySelector('[data-ar-board-refresh]');
                if (own) return own;
                return [...document.querySelectorAll('button,a')].find(b => b.parentElement && /^\s*(criar um tópico|create (a )?topic|создать тему)\s*$/i.test(b.textContent || '')) || null;
            }
            return document.querySelector('a[href^="/topic-"][href$="/edit"]');
        }
        function boardSearchActive() {   // tela "Resultados da pesquisa" do quadro
            const inp = document.querySelector('[data-testid="board-search-input"]');
            if (inp && String(inp.value || '').trim()) return true;
            return /[?&](q|query|search)=/i.test(location.search);
        }
        function syncStar() {
            const p = currentPage();
            const all = [...document.querySelectorAll('[' + STAR_ATTR + ']')];
            if (!p || (p.type === 'board' && boardSearchActive())) { all.forEach(e => e.remove()); return; }
            let star = all.find(e => e.dataset.key === p.key) || null;
            all.forEach(e => { if (e !== star) e.remove(); });
            if (!star) star = buildStar(p);
            const anchor = findAnchor(p);
            if (anchor && anchor.parentElement) {
                if (star.parentElement !== anchor.parentElement || star.nextElementSibling !== anchor) anchor.parentElement.insertBefore(star, anchor);
                star.classList.remove('is-fallback');
            } else if (!star.isConnected) {   // sem botão de referência (ex.: quem não pode editar o tópico): fica logo abaixo do título
                if (p.type === 'board' && performance.now() < 8000) return;   // fórum: espera o cabeçalho do VK desenhar o "Criar um tópico"
                const h2 = document.querySelector('h2');
                if (!h2) return;
                star.classList.add('is-fallback');
                h2.insertAdjacentElement('afterend', star);
            }
            paintStar(star, loadFavs().some(f => f.key === p.key));
        }
        function toggleFav(p, btn) {
            if (!p) return;
            const favs = loadFavs(), i = favs.findIndex(f => f.key === p.key);
            if (i >= 0) {
                favs.splice(i, 1);
            } else {
                if (favs.length >= MAX_FAVS) {
                    if (btn) { btn.lastChild.textContent = 'Limite: ' + MAX_FAVS; setTimeout(() => syncStar(), 1800); }
                    return;
                }
                favs.push({ key: p.key, type: p.type, g: p.g, t: p.t, title: pageTitle(p), group: pageGroupName(), at: Date.now() });
            }
            saveFavs(favs);
            syncStar();
            render();
        }

        // ---------- Dados do VK (contagens e últimos tópicos) ----------
        const meta = new Map(), pending = new Set(), nameTried = new Set();
        const expanded = new Set();   // fóruns com a lista de últimos tópicos aberta (sempre começam fechados)
        let needsSession = false;
        const isFresh = key => { const m = meta.get(key); return (m && Date.now() - m.at < META_TTL_MS) || pending.has(key); };
        function ago(sec) {
            const d = Math.max(0, Date.now() / 1000 - Number(sec || 0));
            if (d < 60) return 'agora';
            if (d < 3600) return 'há ' + Math.floor(d / 60) + ' min';
            if (d < 86400) return 'há ' + Math.floor(d / 3600) + ' h';
            return 'há ' + Math.floor(d / 86400) + ' d';
        }
        async function fillNames(groups) {
            for (const g of groups) {
                try {
                    const r = await api.vk.request('groups.getById', { group_id: g });
                    const arr = Array.isArray(r) ? r : (r && Array.isArray(r.groups) ? r.groups : []);
                    const name = arr[0] ? clean(arr[0].name) : '';
                    if (name) loadFavs().filter(f => f.g === g).forEach(f => patchFav(f.key, f.type === 'board' ? { group: name, title: name } : { group: name }));
                } catch (e) { /* o nome fica como está */ }
            }
        }
        async function refreshMeta() {
            if (!open) return;
            if (!api.vk.getSessionInfo().ready) { needsSession = true; return; }
            needsSession = false;
            const favs = loadFavs(), jobs = [];
            if (tab === 'topics') {   // uma chamada por comunidade, com todos os tópicos favoritos dela
                const byGroup = new Map();
                favs.filter(f => f.type === 'topic' && !isFresh(f.key)).forEach(f => {
                    if (!byGroup.has(f.g)) byGroup.set(f.g, []);
                    byGroup.get(f.g).push(f);
                });
                byGroup.forEach((list, g) => {
                    list.forEach(f => pending.add(f.key));
                    jobs.push(async () => {
                        try {
                            const r = await api.vk.request('board.getTopics', { group_id: g, topic_ids: list.map(f => f.t).join(','), count: Math.min(100, list.length) });
                            const items = (r && r.items) || [];
                            list.forEach(f => {
                                const it = items.find(x => Number(x.id) === f.t);
                                meta.set(f.key, it ? { at: Date.now(), n: Number(it.comments) } : { at: Date.now(), err: true });
                                const title = it ? clean(it.title) : '';
                                if (title && title !== f.title) patchFav(f.key, { title });
                            });
                        } catch (e) { list.forEach(f => meta.set(f.key, { at: Date.now(), err: true })); }
                        list.forEach(f => pending.delete(f.key));
                    });
                });
            } else {   // um fórum por vez (evita estourar o limite de chamadas do VK)
                favs.filter(f => f.type === 'board' && !isFresh(f.key)).forEach(f => {
                    pending.add(f.key);
                    jobs.push(async () => {
                        try {
                            const r = await api.vk.request('board.getTopics', { group_id: f.g, count: 3, order: 1 });
                            meta.set(f.key, {
                                at: Date.now(), n: Number(r && r.count),
                                topics: ((r && r.items) || []).slice(0, 3).map(t => ({ id: t.id, title: clean(t.title), when: t.updated || t.created }))
                            });
                        } catch (e) { meta.set(f.key, { at: Date.now(), err: true, topics: [] }); }
                        pending.delete(f.key);
                    });
                });
            }
            const missing = [...new Set(favs.filter(f => (!f.group || (f.type === 'board' && /^Fórum \d+$/.test(f.title))) && !nameTried.has(f.g)).map(f => f.g))];
            if (missing.length) { missing.forEach(g => nameTried.add(g)); jobs.push(() => fillNames(missing)); }
            for (const run of jobs) { await run(); if (open) renderList(); }
        }

        // ---------- Painel flutuante ----------
        let widget = null, panel = null, toggleBtn = null, tabsEl = null, listEl = null, tabBtns = {};
        let open = LS.get('open') === '1', lastSig = '';
        let tab = LS.get('tab') === 'boards' ? 'boards' : 'topics';

        const sigNow = () => JSON.stringify([loadFavs().map(f => [f.key, f.title, f.group]), tab, open]);

        function applyOpen() {
            if (!panel) return;
            panel.style.display = open ? 'flex' : 'none';
            if (open) {   // aberto: rótulo vertical, como no painel de jogos
                toggleBtn.style.writingMode = 'vertical-rl';
                toggleBtn.style.textOrientation = 'mixed';
                toggleBtn.style.padding = '16px 6px';
                toggleBtn.style.fontSize = '12px';
                toggleBtn.textContent = '';
                const star = mk('color:' + GOLD + ';margin-bottom:6px;', '★', 'span');
                toggleBtn.append(star, mk('', 'Favoritos', 'span'));
            } else {      // fechado: só a estrela
                toggleBtn.style.writingMode = 'horizontal-tb';
                toggleBtn.style.padding = '10px';
                toggleBtn.style.fontSize = '16px';
                toggleBtn.textContent = '';
                toggleBtn.appendChild(mk('color:' + GOLD + ';', '★', 'span'));
            }
        }
        function setOpen(v) {
            open = !!v;
            LS.set('open', open ? '1' : '0');
            applyOpen();
            if (open) {   // fecha o painel de jogos
                document.dispatchEvent(new CustomEvent('salvavk:dock-open', { detail: 'favorites' }));
                closeGames();
            }
            syncDock();
            render();
            place();
        }
        function setTab(name) {
            tab = name === 'boards' ? 'boards' : 'topics';
            LS.set('tab', tab);
            renderList();
            refreshMeta();
        }
        function removeFav(key) {
            saveFavs(loadFavs().filter(f => f.key !== key));
            meta.delete(key);
            expanded.delete(key);
            syncStar();
            render();
        }

        function rowEl(f, title, sub) {
            const row = mk('');
            row.className = 'vk-ar-fav-row';
            const a = mk('', null, 'a');
            a.className = 'vk-ar-fav-main';
            a.href = hrefOf(f);
            a.title = title;
            const t = mk('', title), s = mk('', sub);
            t.className = 'vk-ar-fav-t';
            s.className = 'vk-ar-fav-s';
            a.append(t, s);
            row.appendChild(a);
            return row;
        }
        function xBtn(f) {
            const b = mk('', '✕', 'button');
            b.type = 'button';
            b.className = 'vk-ar-fav-x';
            b.title = 'Remover dos favoritos';
            b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); removeFav(f.key); });
            return b;
        }
        function topicRow(f) {
            const m = meta.get(f.key);
            const parts = [];
            if (f.group) parts.push(f.group);
            if (m && Number.isFinite(m.n)) parts.push(plural(m.n, 'post', 'posts'));
            const row = rowEl(f, f.title || hrefOf(f), parts.join(' · '));
            row.appendChild(xBtn(f));
            const item = mk('');
            item.className = 'vk-ar-fav-item';
            item.appendChild(row);
            return item;
        }
        function noteEl(text) { const n = mk('', text); n.className = 'vk-ar-fav-note'; return n; }
        function subList(f) {
            const box = mk('');
            box.className = 'vk-ar-fav-sub';
            const m = meta.get(f.key);
            if (!m) box.appendChild(noteEl(needsSession ? 'Aguardando a sessão do VK…' : 'Carregando…'));
            else if (m.err) box.appendChild(noteEl('Indisponível agora.'));
            else if (!m.topics.length) box.appendChild(noteEl('Nenhum tópico.'));
            else m.topics.forEach(t => {
                const a = mk('', null, 'a');
                a.className = 'vk-ar-fav-sublink';
                a.href = '/topic-' + f.g + '_' + t.id;
                a.title = t.title;
                const n = mk('', t.title || ('Tópico ' + t.id), 'span'), d = mk('', ago(t.when), 'span');
                n.className = 'vk-ar-fav-subt';
                d.className = 'vk-ar-fav-subd';
                a.append(n, d);
                box.appendChild(a);
            });
            return box;
        }
        function boardRow(f) {
            const m = meta.get(f.key);
            const isOpen = expanded.has(f.key);
            const sub = 'Fórum' + (m && Number.isFinite(m.n) ? ' · ' + plural(m.n, 'tópico', 'tópicos') : '');
            const row = rowEl(f, f.title || f.group || hrefOf(f), sub);
            const chev = mk('', '›', 'button');
            chev.type = 'button';
            chev.className = 'vk-ar-fav-chev' + (isOpen ? ' is-open' : '');
            chev.title = isOpen ? 'Ocultar últimos tópicos' : 'Ver últimos tópicos';
            chev.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            chev.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                if (expanded.has(f.key)) expanded.delete(f.key); else expanded.add(f.key);
                renderList();
                refreshMeta();
            });
            row.append(xBtn(f), chev);
            const item = mk('');
            item.className = 'vk-ar-fav-item';
            item.appendChild(row);
            if (isOpen) item.appendChild(subList(f));
            return item;
        }
        function renderList() {
            if (!listEl) return;
            const favs = loadFavs();
            const topics = favs.filter(f => f.type === 'topic'), boards = favs.filter(f => f.type === 'board');
            tabBtns.topics.lastChild.textContent = topics.length || '';
            tabBtns.boards.lastChild.textContent = boards.length || '';
            Object.keys(tabBtns).forEach(k => tabBtns[k].classList.toggle('is-active', k === tab));
            const items = tab === 'topics' ? topics : boards, top = listEl.scrollTop;
            listEl.textContent = '';
            if (!items.length) {
                const empty = mk('');
                empty.className = 'vk-ar-fav-empty';
                empty.append(tab === 'topics' ? 'Nenhum tópico favorito.' : 'Nenhum fórum favorito.', document.createElement('br'),
                    tab === 'topics' ? 'Use o botão ☆ no topo de um tópico.' : 'Use o botão ☆ no topo do quadro de discussões.');
                listEl.appendChild(empty);
                return;
            }
            items.forEach(f => listEl.appendChild(f.type === 'topic' ? topicRow(f) : boardRow(f)));
            listEl.scrollTop = top;
        }
        function render() {
            if (!widget) return;
            lastSig = sigNow();
            if (!open) return;
            renderList();
            refreshMeta();
        }

        function buildWidget() {
            widget = mk('position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:99999;font:13px ' + FONT + ';display:flex;align-items:center;');
            widget.id = WIDGET_ID;
            panel = mk('width:272px;max-width:calc(100vw - 48px);display:none;flex-direction:column;overflow:hidden;background:var(--vkui--color_background_content, #fff);color:var(--vkui--color_text_primary, #000);border:1px solid rgba(128,128,128,0.3);border-radius:8px 0 0 8px;box-shadow:-6px 0 20px rgba(0,0,0,0.2);');
            const header = mk('padding:8px 12px;background:' + BRAND + ';color:#fff;font-weight:bold;display:flex;justify-content:space-between;align-items:center;font-size:12px;flex-shrink:0;');
            const closeBtn = mk('cursor:pointer;padding:0 4px;font-size:14px;', '✕', 'span');
            closeBtn.title = 'Fechar';
            closeBtn.addEventListener('click', () => setOpen(false));
            header.append(mk('', 'Favoritos', 'span'), closeBtn);
            tabsEl = mk('');
            tabsEl.className = 'vk-ar-fav-tabs';
            [['topics', 'Tópicos'], ['boards', 'Fóruns']].forEach(([k, label]) => {
                const b = mk('', null, 'button');
                b.type = 'button';
                b.className = 'vk-ar-fav-tab';
                b.append(mk('', label, 'span'), mk('', '', 'i'));
                b.addEventListener('click', () => setTab(k));
                tabBtns[k] = b;
                tabsEl.appendChild(b);
            });
            listEl = mk('');
            listEl.className = 'vk-ar-fav-list';
            panel.append(header, tabsEl, listEl);
            toggleBtn = mk('cursor:pointer;background:' + BRAND + ';color:#fff;border-radius:8px 0 0 8px;font-weight:600;box-shadow:2px 0 10px rgba(0,0,0,0.2);user-select:none;flex-shrink:0;display:flex;align-items:center;justify-content:center;');
            toggleBtn.title = 'Favoritos';
            toggleBtn.addEventListener('click', () => setOpen(!open));
            widget.append(panel, toggleBtn);
            document.body.appendChild(widget);
            applyOpen();
            render();
        }

        // Painel de jogos: visível? (funciona mesmo com a versão antiga do módulo de jogos)
        const gamesPanelOpen = () => {
            const g = document.getElementById('vk-ar-rdc-widget'), p = g && g.firstElementChild;
            return !!p && p.style.display !== 'none';
        };
        function closeGames() {
            const g = document.getElementById('vk-ar-rdc-widget');
            if (g && g.lastElementChild && gamesPanelOpen()) g.lastElementChild.click();   // o mesmo clique do usuário no botão de jogos
        }

        // Só um painel por vez: com um aberto, o botão do outro some (visibility mantém o layout e a posição).
        function syncDock() {
            if (!widget) return;
            const g = document.getElementById('vk-ar-rdc-widget');
            if (open && gamesPanelOpen()) closeGames();   // os dois abertos (ex.: estado salvo): fica só o de favoritos
            if (g) g.style.visibility = open ? 'hidden' : '';
            widget.style.visibility = (!open && gamesPanelOpen()) ? 'hidden' : '';
        }

        // O botão fica logo acima do botão do painel de jogos (e acompanha quando ele muda de tamanho);
        // o painel abre centralizado em relação ao botão, sem sair da tela.
        function place() {
            if (!widget) return;
            const games = document.getElementById('vk-ar-rdc-widget');
            const t = games && games.lastElementChild;
            let centerY = window.innerHeight / 2 - 70 - toggleBtn.offsetHeight / 2;
            if (t) { const r = t.getBoundingClientRect(); if (r.height) centerY = r.top - 8 - toggleBtn.offsetHeight / 2; }
            widget.style.top = Math.round(centerY) + 'px';
            panel.style.maxHeight = Math.max(200, Math.min(400, window.innerHeight - 16)) + 'px';
            panel.style.transform = '';
            if (open) {   // se centralizar empurraria o painel para fora da tela, desliza só o painel
                const r = panel.getBoundingClientRect();
                let dy = 0;
                if (r.top < 8) dy = 8 - r.top;
                else if (r.bottom > window.innerHeight - 8) dy = window.innerHeight - 8 - r.bottom;
                if (dy) panel.style.transform = 'translateY(' + Math.round(dy) + 'px)';
            }
        }

        function tick() {
            syncStar();
            if (!document.body) return;
            if (!widget || !widget.isConnected) buildWidget();
            else if (sigNow() !== lastSig) render();
            syncDock();
            place();
        }

        // ---------- Ciclo de vida ----------
        favDockHandler = e => {
            if (e.detail !== 'favorites' && open) { open = false; LS.set('open', '0'); applyOpen(); render(); }
            setTimeout(syncDock, 0);
        };
        document.addEventListener('salvavk:dock-open', favDockHandler);
        favClickHandler = () => setTimeout(() => { try { syncDock(); place(); } catch (e) { /* ignora */ } }, 0);
        document.addEventListener('click', favClickHandler, true);
        favResizeHandler = () => place();
        window.addEventListener('resize', favResizeHandler);
        favSessionOff = api.vk.onSessionChange(() => {
            if (needsSession && open && widget) refreshMeta();
        });
        favTimer = setInterval(() => { try { tick(); } catch (e) { /* ignora */ } }, 700);
        try { tick(); } catch (e) { /* ignora */ }
    },
    stop() {
        if (favTimer != null) clearInterval(favTimer);
        favTimer = null;
        if (favSessionOff) { try { favSessionOff(); } catch (e) { /* ignora */ } favSessionOff = null; }
        if (favDockHandler) { document.removeEventListener('salvavk:dock-open', favDockHandler); favDockHandler = null; }
        if (favResizeHandler) { window.removeEventListener('resize', favResizeHandler); favResizeHandler = null; }
        if (favClickHandler) { document.removeEventListener('click', favClickHandler, true); favClickHandler = null; }
        const games = document.getElementById('vk-ar-rdc-widget');
        if (games) games.style.visibility = '';
        const widget = document.getElementById('vk-ar-fav-widget');
        if (widget) widget.remove();
        document.querySelectorAll('[data-ar-fav-star]').forEach(e => e.remove());
    }
});
