// Salva VK — módulo de reações personalizadas
// Extraído do núcleo v6.33; usa somente a API pública SalvaVK v1.
SalvaVK.modules.register({
    id: 'reactions',
    version: '1.0.0',
    apiVersion: 1,
    start(api) {
        const LS = api.storage;
        const addStyle = api.ui.addStyle, mk = api.ui.mk;
        const themeColors = api.ui.themeColors, avatarEl = api.ui.avatarEl;
        const COMMENT_SEL = api.ui.selectors.comment;
        const COMMENT_ID_RE = new RegExp(api.ui.selectors.commentId);
        const TOPIC_RE = new RegExp(api.ui.selectors.topic);
        const idOf = api.ui.commentId.idOf, numId = api.ui.commentId.numId;
        const LIKE_COUNT_COLOR = api.ui.colors.likeCount;
        const HEART_OUTLINE = api.ui.colors.heartOutline, LIKE_GRAY = api.ui.colors.likeGray;
        const DEBUG = true;

    'use strict';
    // Com @grant, "window" é uma cópia isolada: o gancho de fetch/XHR precisa ir para a janela REAL da página

    // ===== CONFIGURAÇÃO =====
    const RX_ICON_PX = 17;          // tamanho do ícone das reações e do coração
    const RX_FONT_PX = 13;          // tamanho dos números
    const RX_NO_HEART_TIP = true;   // o coração só abre o seletor de reações (sem o balão "X pessoas avaliaram")
    const RX_URL = 'https://salva-vk-api.salvavk.workers.dev/';
    const RX_STEPS = [5000, 15000, 300000];   // intervalos da leitura (ms): sobe um degrau a cada RX_STEP_AFTER leituras iguais
    const RX_STEP_AFTER = 1;
    const RX_NUDGE_GAP_MS = 30000;   // gatilhos (mouse, volta à aba): no máximo 1 leitura a cada 30 s
    const RX_RETURN_MS = 60000;      // voltar à aba só lê se ficou fora mais que isso
    const RX_GROW_GAP_MS = 15000;    // comentários novos na tela: no máximo 1 leitura a cada 15 s
    const RX_CHANGE_STEP = 1;       // degrau para onde a leitura volta quando OUTRAS pessoas mudam algo (0 = volta a 5 s, como na v6.33). Ação sua e troca de página sempre voltam a 5 s
    const RX_IDLE_AFTER_MS = 2 * 60 * 1000;   // sem mouse/teclado/rolagem/toque por esse tempo = aba parada (ociosa)
    const RX_IDLE_POLL_MS = 900000;  // aba parada: a leitura nunca fica mais frequente que isso; ao voltar a mexer, lê na hora
    const RX_MIN_GAP_MS = 2000;     // intervalo mínimo entre duas leituras, mesmo as forçadas
    const RX_FULL_EVERY_MS = 10 * 60 * 1000;   // leitura completa de tempos em tempos (corrige deriva)
    const RX_HIDDEN_POLL_MS = 0;    // aba escondida: 0 = não lê (lê na hora ao voltar); ou um intervalo em ms
    const RX_HOVER_MS = 350;        // tempo com o mouse no coração até abrir o seletor
    const RX_LOCAL_MS = 8000;       // quanto tempo a sua reação "vale" na tela antes de o servidor confirmar
    const RX_GAP_IDS = 1000000;     // ids de comentários com distância maior que isso não contam como a mesma janela (ignora id provisório)
    const RX_NT_NEGATIVE = false;   // false = só reações positivas geram notificação (as negativas não dão curtida no VK)
    const RX_NT_POP_RETRY_MS = [1200, 2000, 3000, 4000];   // pop-up: se a reação ainda não chegou ao banco, tenta de novo nesses intervalos
    const RX_NT_LIST_RETRY_MS = [4000, 10000, 30000];      // janela: idem; esgotadas, só olha de novo a cada 2 min
    const RX_NT_MIRROR_DAYS = 3;                // espelho local: reações dos últimos N dias
    const RX_NT_MIRROR_EVERY_MS = 300000;       // atualização do espelho (só o que mudou); 0 = desliga
    const RX_NT_MIRROR_LIST_MS = 30000;         // idem, com a janela de notificações aberta
    const RX_NT_MIRROR_IDLE_MS = 900000;        // idem, com a aba parada (ociosa)
    const RX_NAV_SETTLE_MS = 1500;           // troca de página: espera a navegação estabilizar antes de ler
    const RX_PAGE_CACHE_MS = 10 * 60 * 1000; // validade do cache por página (igual ao RX_FULL_EVERY_MS)
    const RX_PAGE_CACHE_MAX = 8;             // páginas guardadas por tópico
    const RX_NT = { title: 'Alguém Reagiu ao Seu Comentário', verbOne: 'reagiu', verbMany: 'reagiram', with: 'com', tail: 'ao seu comentário' };
    const RX_NT_LIKE_RE = /(curti|like|оцени|понрав)[\s\S]*?(coment|comment|комментар)/i;   // "curtiu seu comentário" (pt, en, ru)
    // ========================

    const rxLog = (...a) => DEBUG && console.log('[Salva VK · Reações]', ...a);
    const TAB_ID = Math.random().toString(36).slice(2, 10);
    const safe = f => { try { const p = f(); if (p && p.catch) p.catch(() => {}); } catch (e) {} };

    // ---------- Utilidades ----------
    let toastTimer = null;
    function toast(msg) {
        if (!document.body) return;
        let el = document.getElementById('vk-arx-toast');
        if (!el) {
            el = mk('position:fixed;left:8px;bottom:8px;z-index:100002;font:12px/1.3 monospace;background:rgba(0,0,0,.75);color:#fff;border-radius:6px;padding:5px 9px;max-width:80vw;');
            el.id = 'vk-arx-toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }

    // ---------- Seletores do VK ----------
    const LIKE_ANY = '[data-testid*="like"]:not([data-testid="ar-top-liked"])';
    const commentNodes = root => [...root.querySelectorAll(COMMENT_SEL)].filter(n => COMMENT_ID_RE.test(idOf(n)));
    const isTopic = () => TOPIC_RE.test(location.pathname);
    const topicKey = () => { const m = location.pathname.match(TOPIC_RE); return m ? m[1] + '_' + m[2] : null; };

    // O VK usa dois ícones: coração cheio (like_16 = curtido por você) e contorno (like_outline_16)

    // Botão de curtir de um comentário (o data-testid muda conforme o estado, então parte do ícone do coração)
    function findLikeBox(card) {
        const el = card.querySelector('[data-testid="comment-like"]');
        if (el) return el;
        const svg = card.querySelector('svg[class*="vkuiIcon--like_"]');
        return svg ? (svg.closest(LIKE_ANY) || svg.parentElement) : null;
    }
    // Elemento folha que contém só o número de curtidas dentro do botão
    function findCountEl(btn) {
        return [btn].concat([...btn.querySelectorAll('*')])
            .filter(e => !e.children.length && !e.classList.contains('ar-rx-hc') && /^\d+$/.test((e.textContent || '').trim())).pop() || null;
    }

    // Chamadas VK usam exclusivamente a sessão capturada pelo núcleo nesta aba.
    async function apiCall(method, params) { return api.vk.request(method, params || {}); }

    // Resolve o autor do comentário para guardar quem deve receber a notificação.
    async function rxCommentOwnerId(card) {
        const a = card && card.querySelector('[data-testid="comment-owner"]');
        if (!a) throw new Error('não consegui identificar o autor deste comentário');
        const href = String(a.getAttribute('href') || a.href || '').trim();
        const path = href.replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0].replace(/\/+$/, '');
        let m = path.match(/^\/(?:id|club|public)(\d+)$/i);
        if (m) return /^\/(?:club|public)/i.test(path) ? -Number(m[1]) : Number(m[1]);
        const screenName = path.replace(/^\//, '');
        if (!screenName || screenName.includes('/')) throw new Error('endereço do autor não reconhecido');
        const r = await apiCall('users.get', { user_ids: screenName });
        const u = Array.isArray(r) ? r[0] : (r && Array.isArray(r.items) ? r.items[0] : null);
        if (!u || !u.id) throw new Error('não consegui resolver o ID do autor do comentário');
        return Number(u.id);
    }

    // ---------- Quem é você ----------
    const ME_KEY = 'vk_ar_me_id';
    // Não reutiliza o ID salvo: o localStorage é compartilhado entre contas do VK no mesmo navegador.
    // Cada sessão precisa confirmar o usuário atual pela API antes de gravar reações.
    let meId = null, meFresh = false, meTries = 0, meAt = 0;

    async function learnMeApi() {
        if (meFresh || !api.vk.getSessionInfo().ready || meTries >= 5 || Date.now() - meAt < 30000) return;
        meAt = Date.now(); meTries++;
        try {
            const r = await apiCall('users.get', {});
            const u = Array.isArray(r) ? r[0] : (r && Array.isArray(r.items) ? r.items[0] : null);
            if (!u || !u.id) throw new Error('resposta sem id');
            if (meId !== Number(u.id)) rx.meMissing = true;
            meId = Number(u.id); meFresh = true; LS.set(ME_KEY, meId);
            rxLog('Usuário logado identificado:', meId);
        } catch (e) { rxLog('Não consegui identificar o usuário pela API:', e && e.message); }
    }

    // ---------- Estilos ----------
    const pillH = RX_ICON_PX + 6;
    const lk = s => '[data-testid^="board-comment-"] [data-testid="comment-like"]' + s + ',[data-ar-top] [data-testid="comment-like"]' + s + ',[data-ar-rxfirst] [data-testid="comment-like"]' + s;
    addStyle([
        '[data-ar-rxrow]{display:flex !important;align-items:center;gap:8px}',
        '.ar-rx{display:inline-flex;align-items:center;gap:8px}.ar-rx:empty{display:none !important}',
        '.ar-rx-pill{appearance:none;cursor:pointer;font:inherit;font-size:' + RX_FONT_PX + 'px;line-height:' + RX_ICON_PX + 'px;height:' + pillH + 'px;display:inline-flex;align-items:center;gap:5px;' +
            'padding:0 9px 0 6px;margin:-' + Math.round((pillH - 16) / 2) + 'px 0;border:0;border-radius:' + Math.round(pillH / 2) + 'px;background:rgba(128,128,128,.14);color:' + LIKE_COUNT_COLOR + ';transition:background-color .12s,box-shadow .12s}',
        '.ar-rx-pill:hover{background:rgba(128,128,128,.24)}',
        '.ar-rx-pill.ar-rx-mine{background:rgba(42,88,133,.16);box-shadow:inset 0 0 0 1px rgba(42,88,133,.6);color:var(--vkui--color_text_accent,#2a5885);font-weight:600}',
        'html[data-ar-dark] .ar-rx-pill.ar-rx-mine{background:rgba(113,170,235,.2);box-shadow:inset 0 0 0 1px rgba(113,170,235,.7);color:#a6d0ff}',
        '.ar-rx-n,.ar-rx-hc,[data-ar-rxn]{cursor:pointer}.ar-rx-n:hover,.ar-rx-hc:hover,[data-ar-rxn]:hover{text-decoration:underline}',
        '@keyframes ar-rx-fade{from{opacity:0}to{opacity:1}}@keyframes ar-rx-pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}',
        '.ar-rx-tab{appearance:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:5px 12px;margin:0;border:0;border-radius:16px;font:inherit;font-size:13px;color:inherit;background:rgba(128,128,128,.14);transition:background-color .12s}',
        '.ar-rx-tab:hover{background:rgba(128,128,128,.24)}.ar-rx-tab .n{opacity:.65}',
        '.ar-rx-tab.ar-on{background:rgba(42,88,133,.16);box-shadow:inset 0 0 0 1px rgba(42,88,133,.55);color:var(--vkui--color_text_accent,#2a5885);font-weight:600}',
        'html[data-ar-dark] .ar-rx-tab.ar-on{background:rgba(113,170,235,.2);box-shadow:inset 0 0 0 1px rgba(113,170,235,.7);color:#a6d0ff}',
        '.ar-rx-row{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 20px;text-decoration:none;color:inherit;transition:background-color .12s}',
        '.ar-rx-row:hover{background:rgba(128,128,128,.12)}',
        '.ar-rx-x{appearance:none;cursor:pointer;display:flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;opacity:.6;font-size:15px;transition:background-color .12s,opacity .12s}',
        '.ar-rx-x:hover{background:rgba(128,128,128,.2);opacity:1}',
        '[data-ar-top-clip] .ar-top-like-ov{gap:8px}',
        '.ar-rx-opt{appearance:none;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:4px;margin:0;border:0;border-radius:10px;background:transparent;transition:transform .1s}',
        '.ar-rx-opt:hover{transform:scale(1.22);background:rgba(128,128,128,.15)}',
        '.ar-rx-opt.ar-rx-mine{background:rgba(42,88,133,.18)}',
        '#ar-rx-picker{position:fixed;z-index:100000;display:none;gap:2px;padding:4px 6px;border-radius:16px;background:var(--vkui--color_background_content,#fff);box-shadow:0 6px 24px rgba(0,0,0,.28);border:1px solid rgba(128,128,128,.35)}',
        // tamanho do ícone/número do coração nativo
        lk('') + '{margin:-' + Math.round((RX_ICON_PX - 16) / 2) + 'px 0}',
        lk(' svg') + '{width:' + RX_ICON_PX + 'px !important;height:' + RX_ICON_PX + 'px !important}',
        lk(' *') + '{font-size:' + RX_FONT_PX + 'px !important;line-height:' + RX_ICON_PX + 'px !important}',
        // número ao lado do coração: sempre cinza secundário (o vermelho fica só no ícone)
        '[data-testid="comment-like"] span,[data-testid="comment-like"] .ar-rx-hc,[data-testid="comment-like"] [data-ar-rxce]{color:' + LIKE_COUNT_COLOR + ' !important;' +
            '--vkui--color_text_primary:' + LIKE_COUNT_COLOR + ' !important;--vkui--color_text_accent:' + LIKE_COUNT_COLOR + ' !important;--vkui--color_text_negative:' + LIKE_COUNT_COLOR + ' !important}',
        '[data-testid="comment-like"] span *{color:inherit !important}',
        // janela de notificações
        '[data-ar-nt-hide]{display:none !important}[data-ar-nt-host]{position:relative}',
        '.ar-nt-bd{--arb:var(--vkui--color_background_content,#fff);position:absolute;right:-5px;bottom:-5px;width:26px;height:26px;box-sizing:border-box;border-radius:50%;display:flex;align-items:center;justify-content:center;' +
            'background:#f0f2f5;box-shadow:0 0 0 3px var(--arb),0 1px 4px 1px rgba(0,0,0,.2);pointer-events:none}',
        'html[data-ar-dark] .ar-nt-bd{--arb:var(--vkui--color_background_content,#232324);background:#3b3c3f;box-shadow:0 0 0 3px var(--arb),0 1px 4px 1px rgba(0,0,0,.5)}',
        '@keyframes ar-nt-pop{0%{transform:scale(.7)}60%{transform:scale(1.18)}100%{transform:scale(1)}}',
        '[data-testid^="notification-item-"]:hover .ar-nt-bd{animation:ar-nt-pop .3s cubic-bezier(.2,.9,.3,1)}',
        '@media (prefers-reduced-motion:reduce){.ar-nt-bd{animation:none !important}}',
        '.ar-nt-chip{font-weight:550;color:var(--vkui--color_text_accent,#2a5885)}',
        'html[data-ar-dark] .ar-nt-chip{color:#a6d0ff}',
        '.notifier_baloon .ar-nt-chip{color:#a6d0ff !important}',
    ].join(''), 'vk-arx-css');

    // ---------- Reações ----------
    // Ícones e ids do próprio VK. id 1 = coração = curtida nativa (não vai para o Supabase). fb = emoji de reserva.
    // noLike: true = reação negativa: NÃO dá a curtida nativa no VK (e tira a curtida, se você já tinha dado).
    // O id 0 é reservado: no banco, emoji = '0' significa "sem reação" (remoção lógica, para a leitura por delta enxergar a remoção).
    const RX_LIST = [
        { id: 1, name: 'Coração', fb: '❤️', img: 'https://sun1-57.userapi.com/s/v1/s2/ANm2DG_5t7fPrmeAhECmu5qvAZPRFmwnXYiN5biDW4O9Jr9chK5hhxDfvfRJGkMV5vpy9WAQ3giKa2GMUsLuE74.svg' },
        { id: 2, name: 'Foguinho', fb: '🔥', img: 'https://sun9-56.userapi.com/s/v1/s2/iLoIErNjY4yga3YAbx8wtJeut-HqvvGWAteP6-VnoIiEESuMI1vUxJsLBpLRIbkGSOngwaykHXlwZF4pKylTESs.svg' },
        { id: 3, name: 'Risada', fb: '😂', img: 'https://sun9-48.userapi.com/s/v1/s2/DbyHbkmEOiS3llQKEPWZEafgIy5DloPacPax2ObRQIl9zIxfdpqxEG6w83piLhNlv68xeID3GFuF3vZAbnhl35M.svg' },
        { id: 26, name: 'Palmas', fb: '👏', img: 'https://sun1-23.userapi.com/s/v1/s2/Zzysh-8t4hyBvLI4C7FpXzZmHLBKqRjSZec1zvPK_MNwb8UMAiWKp-tmrUUANRSK-qZ4r9Fux7rnXCdajJvIfDs.svg', adj: 'translate(0,-2.5px)', pillClip: 'inset(18% 0 0 0)', pillAdj: 'translate(0,-1.5px)' },
        { id: 19, name: 'Surpresa', fb: '😮', img: 'https://sun1-27.userapi.com/s/v1/s2/DJSrHsK6WIV2r-SO4_ef57sZdu2m4eDeAeSYla8HNSh4t3TP44BDnjuIvjd4wejt_mwFEdn-jvITLO-Fd571bF0.svg' },
        { id: 39, name: 'Diabinho', fb: '😈', img: 'https://sun1-83.userapi.com/s/v1/s2/372vSKMBRDEIm366NF5tcZwx1iVVU3IDdsgFFHCH0J-f4OV7i01PiUc3CNEXqU02ZT0BFg4Oda8X-E1CE-cOFlQ.svg' },
        { id: 22, name: 'Desdém', fb: '🙄', img: 'https://sun1-56.userapi.com/s/v1/s2/W4swqWNQcNOZoA7c9XxDAKvgkI_eTxdp3baixdxFKPZDjRuS-GXr9fb0Ha4OOgnZJvCXkYRvorQ0cuG3vw4Fss4.svg', noLike: true },
        { id: 17, name: 'Palhaço', fb: '🤡', img: 'https://sun9-9.userapi.com/s/v1/s2/PzDPR5_qLylXfFBmx78CLPec6VkqNGHVcV-2LYhsAhVUngr0I4P27UNIno0Kp42NKCGvovUbNmz4yqOgtFZoNlI.svg', noLike: true },
        { id: 7, name: 'Choro', fb: '😢', img: 'https://sun1-28.userapi.com/s/v1/s2/Ko6jOFBPclTnWinVZVRHcAjJVdUoVIPRyUviU3hH4K203aPIIvxARwZzhb9vMSgOr8RDejrvDoHg2rn2ZcIVnU8.svg', noLike: true },
        { id: 31, name: 'Raiva', fb: '🤬', img: 'https://sun1-89.userapi.com/s/v1/s2/ZOcBE3-24QPGljrDPEgj1AeVjzgssgxOqlAsZ5-vBJC8DkFtVip492RIVflYW5ePwnC98ucOHhqHwVDjmE262js.svg', noLike: true }
    ];
    const RX_BY_ID = {};
    RX_LIST.forEach(r => { RX_BY_ID[String(r.id)] = r; });

    // rows: comentário -> { idDaReação: quantidade }; mine: comentário -> id da SUA reação; local: o que você acabou de clicar
    // store: linhas do servidor (chave "comentário:usuário"); cursor: updated_at da última linha recebida (base do delta); fullAt: hora da última leitura completa
    const rx = { topic: null, rows: new Map(), mine: new Map(), local: new Map(), who: new Map(), raw: [], digest: '', step: 0, same: 0, last: 0, sentLo: undefined, sentHi: undefined, sentFx: '', force: false, meMissing: false, busy: false, acting: new Set(), self: false, store: new Map(), cursor: null, fullAt: 0, firstId: null, firstTry: 0, pages: new Map(), navKey: '', navSince: 0, storeKey: null, storeHi: null };
    const RX_SHARE_KEY = 'vk_arx_shared';

    function rxIcon(r, size) {
        const im = document.createElement('img');
        im.alt = r.fb;
        im.width = size;
        im.height = size;
        im.style.cssText = 'width:' + size + 'px;height:' + size + 'px;display:block;flex:none;object-fit:contain';
        if (size >= 28) { if (r.adj) im.style.transform = r.adj; }
        else {
            if (r.pillClip) im.style.clipPath = r.pillClip;
            if (r.pillAdj) im.style.transform = r.pillAdj;
        }
        im.addEventListener('error', () => {   // imagem do VK indisponível: usa o emoji
            const s = document.createElement('span');
            s.textContent = r.fb;
            s.style.cssText = 'font-size:' + Math.round(size * 0.85) + 'px;line-height:' + size + 'px;display:block';
            im.replaceWith(s);
        }, { once: true });
        im.src = r.img;
        return im;
    }

    // asText = true: pede CSV (bem menor que JSON) e devolve o texto cru
    async function rxReq(method, query, payload, prefer, asText) {
        const headers = { 'Content-Type': 'application/json' };
        if (prefer) headers.Prefer = prefer;
        if (asText) headers.Accept = 'text/csv';
        const result = await api.network.request({ method, url: RX_URL + query, headers, data: payload ? JSON.stringify(payload) : undefined, timeout: 15000 });
        const responseText = result.responseText || '';
        if (asText) return responseText;
        try { return responseText ? JSON.parse(responseText) : null; } catch (e) { return null; }
    }

    // Leitor CSV compatível com o Worker D1: topic, comment_id, user_id, emoji, updated_at.
    const RX_SEL = '?select=topic,comment_id,user_id,comment_owner_id,emoji,updated_at';
    function rxParseCsv(txt) {
        const out = [];
        String(txt || '').split(/\r?\n/).forEach(line => {
            if (!line || /^(?:topic,|comment_id,)/.test(line)) return;
            const p = line.split(',').map(s => s.replace(/^\"|\"$/g, '').replace(/\"\"/g, '\"'));
            if (p.length === 4) { p.unshift(''); p.splice(3, 0, ''); } // formato antigo sem topic e sem comment_owner_id
            else if (p.length === 5) p.splice(3, 0, ''); // formato anterior sem comment_owner_id
            const cid = Number(p[1]), uid = Number(p[2]);
            if (!Number.isSafeInteger(cid) || !Number.isSafeInteger(uid)) return;
            out.push({ topic: p[0], comment_id: cid, user_id: uid, comment_owner_id: Number(p[3]) || null, emoji: p[4], t: p[5] || '' });
        });
        return out;
    }
    const rxGet = async q => rxParseCsv(await rxReq('GET', RX_SEL + q, null, null, true));
    const rxCursorOf = r => JSON.stringify([r.t, r.topic, Number(r.comment_id), Number(r.user_id)]);
    const rxCursorParts = c => { try { const a = JSON.parse(c); return Array.isArray(a) && a.length === 4 && typeof a[0] === 'string' ? a : null; } catch (e) { return null; } };
    const rxCursorTime = c => { const a = rxCursorParts(c); return a ? a[0] : c; };
    const rxCursorCompare = (a, b) => {
        const x = rxCursorParts(a), y = rxCursorParts(b);
        if (!x) return -1; if (!y) return 1;
        for (let i = 0; i < 4; i++) { const c = x[i] < y[i] ? -1 : x[i] > y[i] ? 1 : 0; if (c) return c; }
        return 0;
    }

    // Comentário da lista (board-comment-<id>) que contém o elemento
    const rxListCard = el => {
        let c = el && el.closest ? el.closest(COMMENT_SEL) : null;
        while (c && !COMMENT_ID_RE.test(idOf(c))) c = c.parentElement && c.parentElement.closest(COMMENT_SEL);
        return c;
    };
    // 1º post do tópico: fica fixo no topo, fora da lista (sem board-comment-<id>); só vale depois de descobrir o id dele
    const rxIsFirstBlock = b => !!b && rx.firstId != null && isTopic() && !rxListCard(b) &&
        !b.closest('[data-testid="board-comment-composer"],[data-ar-top]') && !commentNodes(b).length;
    const rxFirstBlockOf = el => { const b = el && el.closest ? el.closest('[data-testid="comment"]') : null; return rxIsFirstBlock(b) ? b : null; };
    function rxFirstBlock() {   // bloco do 1º post, se estiver visível (fora da página 1 o Salva VK o esconde)
        for (const o of document.querySelectorAll('[data-testid="comment-owner"]')) {
            const b = o.closest('[data-testid="comment"]');
            if (rxIsFirstBlock(b) && b.getBoundingClientRect().height > 0) return b;
        }
        return null;
    }

    // Comentário (da lista) a que um elemento pertence. Dentro do cartão "post em destaque" do Salva VK, devolve o comentário original, se estiver na tela.
    const rxCardOf = el => {
        const top = el && el.closest ? el.closest('[data-ar-top]') : null;
        if (top) {
            const id = top.getAttribute('data-ar-top-id');
            // com o comentário original na tela, age nele; sem ele (outra página do tópico), age no próprio cartão em destaque
            return [...document.querySelectorAll('[data-testid="board-comment-' + id + '"]')]
                .find(n => !n.closest('[data-ar-top]') && !n.hasAttribute('data-ar-dup')) || top;
        }
        return rxListCard(el) || rxFirstBlockOf(el);
    };
    const rxCardId = c => c.hasAttribute('data-ar-top') ? Number(c.getAttribute('data-ar-top-id'))
        : (COMMENT_ID_RE.test(idOf(c) || '') ? numId(c) : (rx.firstId != null ? rx.firstId : NaN));
    const rxCidOf = el => { const c = rxCardOf(el); return c ? rxCardId(c) : NaN; };
    const rxIsLiked = card => card.hasAttribute('data-ar-liked') || !!card.querySelector('svg[class*="vkuiIcon--like_16"]');

    // Alterna a curtida NATIVA: clica no próprio botão do VK (ele cuida da chamada e de atualizar o coração)
    function rxToggleLike(card) {
        const lb = findLikeBox(card);
        if (!lb) return;
        rx.self = true;
        try { lb.click(); } finally { rx.self = false; }
    }

    // Contagens e a SUA reação, já considerando o que você acabou de clicar (até o servidor confirmar)
    function rxView(cid) {
        const counts = Object.assign({}, rx.rows.get(cid) || {});
        let mine = rx.mine.get(cid) || null;
        const l = rx.local.get(cid);
        if (l) {
            if (Date.now() - l.at > RX_LOCAL_MS || (l.id || null) === mine) rx.local.delete(cid);
            else {
                if (mine) counts[mine] = Math.max(0, (counts[mine] || 1) - 1);
                if (l.id) counts[l.id] = (counts[l.id] || 0) + 1;
                mine = l.id || null;
            }
        }
        return { counts, mine };
    }

    // Faixa de ids do grupo principal de comentários da tela (um id provisório isolado não conta)
    function rxMainCluster(ids) {
        if (!ids.length) return null;
        const groups = [];
        [...new Set(ids)].sort((a, b) => a - b).forEach(v => {
            const g = groups[groups.length - 1];
            if (g && v - g.hi <= RX_GAP_IDS) { g.hi = v; g.n++; } else groups.push({ lo: v, hi: v, n: 1 });
        });
        let best = groups[0];
        groups.forEach(g => { if (g.n >= best.n) best = g; });
        return best;
    }

    // Ids que a tela precisa: faixa dos comentários visíveis + os do cartão "post em destaque" (se houver)
    function rxWanted() {
        const ids = [];
        commentNodes(document).forEach(n => {
            if (n.hasAttribute('data-ar-dup') || n.hasAttribute('data-ar-deleted')) return;
            const id = numId(n);
            if (Number.isFinite(id)) ids.push(id);
        });
        const win = rxMainCluster(ids);
        const fx = [];
        document.querySelectorAll('[data-ar-top-id]').forEach(el => {
            const n = Number(el.getAttribute('data-ar-top-id'));
            if (Number.isFinite(n) && fx.indexOf(n) < 0 && !(win && n >= win.lo && n <= win.hi)) fx.push(n);
        });
        // 1º post do tópico (fixo no topo): seu id costuma ficar longe da janela da lista, então entra à parte
        if (rx.firstId != null && fx.indexOf(rx.firstId) < 0 && !(win && rx.firstId >= win.lo && rx.firstId <= win.hi) && rxFirstBlock()) fx.push(rx.firstId);
        fx.sort((a, b) => a - b);
        if (!win && !fx.length) return null;
        return { lo: win ? win.lo : null, hi: win ? win.hi : null, fx };
    }

    function rxFilters(w) {
        const filters = [], range = w.lo != null
            ? 'and(comment_id.gte.' + w.lo + ',comment_id.lte.' + w.hi + ')'
            : null;
        const chunks = [];
        for (let i = 0; i < w.fx.length; i += 95) chunks.push(w.fx.slice(i, i + 95));
        if (!chunks.length) chunks.push([]);
        chunks.forEach(ids => {
            const parts = [];
            if (range) parts.push(range);
            if (ids.length) parts.push('comment_id.in.(' + ids.join(',') + ')');
            filters.push('or=(' + parts.join(',') + ')');
        });
        return filters;
    }

    // Monta os mapas a partir das linhas e devolve uma "impressão digital" (para saber se mudou algo desde a leitura anterior)
    function rxApplyRows(rows) {
        rows = rows.filter(r => r.emoji != null && String(r.emoji) !== '1' && RX_BY_ID[String(r.emoji)]);   // reação fora da lista ou marca '0' vira curtida comum
        const map = new Map(), mine = new Map(), who = new Map(), keys = [];
        rows.forEach(r => {
            const m = map.get(r.comment_id) || {};
            m[r.emoji] = (m[r.emoji] || 0) + 1;
            map.set(r.comment_id, m);
            const w = who.get(r.comment_id) || {};
            (w[r.emoji] = w[r.emoji] || []).push(Number(r.user_id));
            who.set(r.comment_id, w);
            if (meId != null && String(r.user_id) === String(meId)) mine.set(r.comment_id, String(r.emoji));
            keys.push(r.comment_id + ':' + r.user_id + ':' + r.emoji);
        });
        rx.rows = map;
        rx.mine = mine;
        rx.who = who;
        rx.raw = rows;
        rx.meMissing = meId == null;
        return keys.sort().join('|');
    }

    // Dados novos: se nada mudou, o próximo intervalo sobe um degrau; se mudou, volta ao mais curto
    function rxIngest(rows) {
        const d = rxApplyRows(rows);
        if (d === rx.digest) {
            if (++rx.same >= RX_STEP_AFTER && rx.step < RX_STEPS.length - 1) { rx.step++; rx.same = 0; }
        } else { rx.step = Math.min(RX_CHANGE_STEP, RX_STEPS.length - 1); rx.same = 0; rx.digest = d; }   // leitura forçada (sua ação/troca de página) = 5 s; mudança de terceiros = RX_CHANGE_STEP
        rx.force = false;
        rxSync();
    }

    function rxBoost() { rx.step = 0; rx.same = 0; rx.force = true; }
    // Uma leitura imediata, sem reiniciar a escada de intervalos; limitada por RX_NUDGE_GAP_MS.
    function rxNudge(skipGap) {
        if (!skipGap && Date.now() - rx.last < RX_NUDGE_GAP_MS) return;
        rx.force = true;
    }
    let rxHiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { rxHiddenAt = Date.now(); return; }
        if (rxHiddenAt && Date.now() - rxHiddenAt >= RX_RETURN_MS) rxNudge(true);
    });

    // Ociosidade: sem interação por RX_IDLE_AFTER_MS, a leitura e o espelho espaçam; ao voltar a mexer, lê na hora.
    let rxLastActive = Date.now();
    const rxIdle = () => Date.now() - rxLastActive > RX_IDLE_AFTER_MS;
    function rxActivity() {
        const wasIdle = rxIdle();
        rxLastActive = Date.now();
        if (wasIdle) rxNudge();
    }
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll'].forEach(ev => {
        try { document.addEventListener(ev, rxActivity, { passive: true, capture: true }); } catch (e) { /* ignora */ }
    });

    // Outra aba (visível) acabou de ler a mesma faixa: aproveita, sem repetir a consulta
    function rxAdoptShared(key, want) {
        const s = LS.json(RX_SHARE_KEY);
        if (!s || s.by === TAB_ID || s.topic !== key || !Array.isArray(s.rows) || !s.c) return false;
        if (Date.now() - s.t > RX_STEPS[rx.step] / 2) return false;
        const winOk = want.lo == null || (s.lo != null && want.lo >= s.lo && want.hi <= s.hi);
        if (!winOk || !want.fx.every(x => (s.fx || []).indexOf(x) >= 0)) return false;
        rx.store = new Map();
        s.rows.forEach(a => rx.store.set(a[0] + ':' + a[1], { comment_id: a[0], user_id: a[1], emoji: String(a[2]), t: '' }));
        rx.cursor = s.c;
        rx.fullAt = s.fa || s.t;
        rxIngest(rxStoreRows());
        return true;
    }

    // Leitura completa paginada; no delta usa cursor composto para não perder linhas com o mesmo timestamp.
    async function rxFetch(want, key, since) {
        const out = [], seen = new Set();
        for (const filter of rxFilters(want)) {
            const common = '&' + filter + '&topic=eq.' + encodeURIComponent(key);
            if (since == null) {
                let offset = 0;
                for (let page = 0; page < 100; page++) {
                    const rows = await rxGet('&limit=1000&offset=' + offset + '&order=comment_id.asc' + common + '&emoji=neq.0');
                    rows.forEach(r => {
                        const k = r.comment_id + ':' + r.user_id;
                        if (!seen.has(k)) { seen.add(k); out.push(r); }
                    });
                    if (rows.length < 1000) break;
                    offset += rows.length;
                }
            } else {
                let cursor = since;
                for (let page = 0; page < 100; page++) {
                    const tuple = rxCursorParts(cursor);
                    const after = tuple ? '&after=' + encodeURIComponent(cursor) : '&updated_at=gt.' + encodeURIComponent(cursor);
                    const rows = await rxGet('&limit=1000&order=updated_at.asc' + common + after);
                    rows.forEach(r => {
                        const k = r.comment_id + ':' + r.user_id;
                        if (!seen.has(k)) { seen.add(k); out.push(r); }
                    });
                    if (rows.length < 1000) break;
                    cursor = rxCursorOf(rows[rows.length - 1]);
                }
            }
        }
        return out;
    }

    // Reações "vivas" do armazenamento local (a marca '0' significa sem reação)
    const rxStoreRows = () => [...rx.store.values()].filter(r => String(r.emoji) !== '0');

    // Id do 1º post do tópico (o mais antigo). Nunca muda, então fica guardado por tópico.
    const RX_FIRST_KEY = 'vk_arx_first_v1';
    const rxFirstIds = LS.json(RX_FIRST_KEY, {}) || {};
    async function rxLoadFirstId(key) {
        if (rx.firstId != null) return;
        if (rxFirstIds[key]) { rx.firstId = Number(rxFirstIds[key]); rxSync(); return; }
        const m = location.pathname.match(TOPIC_RE);
        if (!m || !api.vk.getSessionInfo().ready || Date.now() < rx.firstTry) return;
        rx.firstTry = Date.now() + 10000;
        try {
            const r = await apiCall('board.getComments', { group_id: m[1], topic_id: m[2], count: 1, offset: 0, sort: 'asc' });
            const items = (r && r.items) || [];
            const it = items.find(i => !i.deleted) || items[0];
            if (!it || rx.topic !== key) return;
            rx.firstId = Number(it.id);
            rxFirstIds[key] = rx.firstId;
            const ks = Object.keys(rxFirstIds);
            if (ks.length > 300) delete rxFirstIds[ks[0]];
            LS.setJson(RX_FIRST_KEY, rxFirstIds);
            rxSync();
        } catch (e) { rxLog('Não consegui descobrir o 1º post do tópico:', e && e.message); }
    }

    // Guarda as reações da janela que está na tela (só se o store pertence a ela)
    function rxPageSave() {
        if (!rx.storeKey || rx.cursor == null) return;
        rx.pages.delete(rx.storeKey);   // reinsere no fim: o mais antigo sai primeiro
        rx.pages.set(rx.storeKey, { store: rx.store, cursor: rx.cursor, fullAt: rx.fullAt, hi: rx.storeHi });
        while (rx.pages.size > RX_PAGE_CACHE_MAX) rx.pages.delete(rx.pages.keys().next().value);
    }
    
    // Janela já vista há pouco: desenha na hora e agenda só um delta (sem leitura completa)
    function rxPageRestore(want, winKey, fxKey) {
        const e = rx.pages.get(winKey);
        if (!e) return false;
        if (Date.now() - e.fullAt > RX_PAGE_CACHE_MS || (want.hi || 0) > (e.hi || 0)) {   // vencido, ou a faixa cresceu
            rx.pages.delete(winKey);
            return false;
        }
        rx.store = new Map(e.store);
        rx.cursor = e.cursor;
        rx.fullAt = e.fullAt;
        rx.storeKey = winKey;
        rx.storeHi = want.hi;
        rx.sentLo = want.lo; rx.sentHi = want.hi; rx.sentFx = fxKey;
        rx.force = true;
        rxIngest(rxStoreRows());   // desenha o que estava guardado
        rx.step = RX_STEPS.length - 1; rx.same = 0; rx.force = true;   // uma leitura de delta depois de estabilizar; depois, leitura lenta
        rx.last = Date.now() - RX_MIN_GAP_MS + RX_NAV_SETTLE_MS;
        rxLog('Cache de página: ' + winKey + ' restaurada (' + rx.store.size + ' linhas); delta em ~' + RX_NAV_SETTLE_MS / 1000 + ' s');
        return true;
    }

    async function rxPoll() {
        if (rx.busy || !isTopic()) return;
        if (document.hidden && !RX_HIDDEN_POLL_MS) return;
        const key = topicKey();
        if (!key) return;
        if (rx.topic !== key) {
            Object.assign(rx, { topic: key, rows: new Map(), mine: new Map(), local: new Map(), who: new Map(), raw: [], digest: '', step: 0, same: 0, last: 0, sentLo: undefined, sentHi: undefined, sentFx: '', force: false, store: new Map(), cursor: null, fullAt: 0, firstId: null, firstTry: 0, pages: new Map(), navKey: '', navSince: 0, storeKey: null, storeHi: null });
        }
        rxLoadFirstId(key);
        if (meId == null || !meFresh) learnMeApi();
        if (meId != null && rx.meMissing) { rx.meMissing = false; rxApplyRows(rx.raw); rxSync(); }
        const want = rxWanted();
        if (!want) return;
        const now = Date.now(), fxKey = want.fx.join(',');
        const winKey = want.lo + '|' + fxKey;
        const changed = rx.sentLo !== want.lo || rx.sentFx !== fxKey;   // outra página ou destaque novo
    
        if (!changed) {
            rx.navKey = winKey;
        } else {
            if (rx.navKey !== winKey) {   // janela nova (ainda não vista nesta navegação)
                rx.navKey = winKey;
                rx.navSince = now;
                rxPageSave();             // guarda a janela que está saindo
                rx.storeKey = null;
                if (rx.sentLo !== undefined && rxPageRestore(want, winKey, fxKey)) return;   // cache: sem rede
            }
            // navegação rápida: só lê quando a janela ficar parada por RX_NAV_SETTLE_MS (a 1ª leitura do tópico não espera)
            if (rx.sentLo !== undefined && now - rx.navSince < RX_NAV_SETTLE_MS) return;
            rx.force = true; rx.step = 0; rx.same = 0;
        }
    
        const interval = document.hidden ? RX_HIDDEN_POLL_MS : (rxIdle() ? Math.max(RX_STEPS[rx.step], RX_IDLE_POLL_MS) : RX_STEPS[rx.step]);
        const due = now - rx.last >= interval;
        const grew = !changed && rx.sentHi !== undefined && rx.sentHi !== want.hi && now - rx.last >= RX_GROW_GAP_MS;   // apareceram comentários novos
    const forced = grew || (rx.force && (changed || now - rx.last >= RX_MIN_GAP_MS));
        if (!due && !forced) return;
        rx.last = now;
        const full = changed || rx.cursor == null || rx.sentHi !== want.hi || now - rx.fullAt > RX_FULL_EVERY_MS;
        rx.sentLo = want.lo;
        rx.sentHi = want.hi;
        rx.sentFx = fxKey;
        if (full && rxAdoptShared(key, want)) { rx.storeKey = winKey; rx.storeHi = want.hi; return; }
        rx.busy = true;
        try {
            const rows = await rxFetch(want, key, full ? null : rx.cursor);
            if (rx.topic !== key) return;
            if (full) { rx.store = new Map(); rx.cursor = null; rx.fullAt = Date.now(); }
            rows.forEach(r => {
                rx.store.set(r.comment_id + ':' + r.user_id, r);
                const cursor = rxCursorOf(r);
                if (!rx.cursor || rxCursorCompare(cursor, rx.cursor) > 0) rx.cursor = cursor;
            });
            if (!rx.cursor) rx.cursor = new Date(Date.now() - 60000).toISOString();
            rx.storeKey = winKey;
            rx.storeHi = want.hi;
            const live = rxStoreRows();
            rxIngest(live);
            LS.setJson(RX_SHARE_KEY, { t: Date.now(), by: TAB_ID, topic: key, lo: want.lo, hi: want.hi, fx: want.fx, c: rx.cursor, fa: rx.fullAt, rows: live.map(r => [r.comment_id, r.user_id, r.emoji]) });
            rxLog('Reações (' + (full ? 'completa' : 'delta') + '): ' + rows.length + ' linha(s), ' + live.length + ' no total | janela ' + want.lo + '–' + want.hi + ' | próxima leitura em ' + (RX_STEPS[rx.step] / 1000) + ' s');
        } catch (e) {
            rx.cursor = null;
            rx.storeKey = null;   // não guarda no cache uma janela com leitura incompleta
            rxLog('Erro ao ler as reações:', e && e.message);
        } finally {
            rx.busy = false;
        }
    }

    // Grava (sid = '2'..'99') ou apaga (sid = null) a SUA reação; aparece na hora e desfaz se falhar
    // Apagar = marcar emoji '0' (e não DELETE), para a leitura por delta das outras telas enxergar a remoção
    async function rxSet(cid, sid, commentOwnerId) {
        if (!meFresh || meId == null) throw new Error('usuário ainda não foi confirmado pela API do VK');
        const key = topicKey();
        if (!key) return;
        rx.local.set(cid, { id: sid, at: Date.now() });
        rxSync();
        try {
            if (sid) await rxReq('POST', '?on_conflict=topic,comment_id,user_id', { topic: key, comment_id: cid, user_id: Number(meId), comment_owner_id: Number(commentOwnerId), emoji: sid }, 'resolution=merge-duplicates');
            else await rxReq('PATCH', '?topic=eq.' + key + '&comment_id=eq.' + cid + '&user_id=eq.' + Number(meId), { emoji: '0' });
            rxBoost();
            rxLog('Comentário ' + cid + ' → ' + (sid && RX_BY_ID[sid] ? RX_BY_ID[sid].name : 'sem reação'));
        } catch (e) {
            rx.local.delete(cid);
            rxSync();
            toast('⚠ reação falhou: ' + (e && e.message));
            rxLog('Erro ao gravar a reação:', e);
        }
    }

    // O que acontece ao escolher uma opção (no seletor, num contador ou no coração vazio). rid 1 = coração (curtida nativa)
    async function rxChoose(card, rid) {
        const cid = rxCardId(card);
        if (!Number.isFinite(cid) || !topicKey() || rx.acting.has(cid)) return;
        if (meId == null || !meFresh) { learnMeApi(); toast('⚠ confirmando sua conta do VK; tente reagir novamente em instantes'); return; }
        rx.acting.add(cid);
        try {
            const liked = rxIsLiked(card), cur = rxView(cid).mine;
            if (rid === 1) {
                if (cur) { await rxSet(cid, null); if (!liked) rxToggleLike(card); }   // troca a reação pelo coração simples: continua curtido
                else rxToggleLike(card);                                               // sem reação: o coração só alterna a curtida
            } else if (cur === String(rid)) {
                if (liked) rxToggleLike(card);                                         // a mesma reação de novo: remove tudo
                await rxSet(cid, null);
            } else {
                const commentOwnerId = await rxCommentOwnerId(card);
                const wantLike = !(RX_BY_ID[String(rid)] || {}).noLike;                // positiva: curte no VK; negativa: sem curtida
                if (liked !== wantLike) rxToggleLike(card);
                await rxSet(cid, String(rid), commentOwnerId);
            }
        } finally {
            rx.acting.delete(cid);
        }
    }

    // Os contêineres do coração podem estar invisíveis (o VK só os mostra no hover quando não há curtidas): mantém visível se há reações
    function rxKeepVisible(card, el, on) {
        for (let p = el; p && p !== card; p = p.parentElement) {
            if (on) {
                p.style.setProperty('opacity', '1', 'important');
                p.style.setProperty('visibility', 'visible', 'important');
                p.setAttribute('data-ar-rxvis', '1');
            } else if (p.hasAttribute('data-ar-rxvis')) {
                p.style.removeProperty('opacity');
                p.style.removeProperty('visibility');
                p.removeAttribute('data-ar-rxvis');
            }
        }
    }

    // Contadores na MESMA linha do coração (à esquerda dele). Sem reações: nada é criado
    function rxPills(card, lb, v, total) {
        const prev = lb.previousElementSibling;
        let box = prev && prev.classList.contains('ar-rx') ? prev : null;
        const row = lb.parentElement;
        if (!total) {
            if (box) { rxKeepVisible(card, box, false); box.remove(); }
            row.removeAttribute('data-ar-rxrow');
            return;
        }
        const sig = RX_LIST.map(r => v.counts[r.id] || 0).join(',') + '|' + (v.mine || '');
        if (!box) {
            box = document.createElement('span');
            box.className = 'ar-rx';
            lb.insertAdjacentElement('beforebegin', box);
        }
        if (box.getAttribute('data-sig') !== sig) {
            box.setAttribute('data-sig', sig);
            box.textContent = '';
            RX_LIST.forEach(r => {
                const n = v.counts[r.id] || 0;
                if (r.id === 1 || !n) return;   // o coração é a curtida nativa, que o próprio VK desenha
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'ar-rx-pill' + (v.mine === String(r.id) ? ' ar-rx-mine' : '');
                b.setAttribute('data-rid', String(r.id));
                b.setAttribute('aria-label', r.name);
                b.appendChild(rxIcon(r, RX_ICON_PX));
                const num = document.createElement('span');
                num.className = 'ar-rx-n';
                num.textContent = String(n);
                b.appendChild(num);
                box.appendChild(b);
            });
        }
        if (!row.classList.contains('ar-top-like-ov')) row.setAttribute('data-ar-rxrow', '1');
        rxKeepVisible(card, box, true);
    }

    // Visão do script: uma reação por pessoa. O número do coração conta só os corações "puros" (curtidas − quem reagiu com outra
    // reação) e, se a SUA reação não é o coração, o coração aparece vazio. Quem não tem o script vê tudo como curtida.
    function rxHeart(lb, v, total) {
        const ce = findCountEl(lb);
        let hc = lb.querySelector('.ar-rx-hc');
        if (total > 0) {
            const h = Math.max(0, (ce ? (parseInt(ce.textContent, 10) || 0) : 0) - total);   // sempre o valor real do VK
            if (ce) { ce.setAttribute('data-ar-rxce', '1'); ce.style.setProperty('display', 'none', 'important'); }
            if (h > 0 && ce) {
                if (!hc) {
                    hc = ce.cloneNode(false);
                    hc.classList.add('ar-rx-hc');
                    hc.removeAttribute('data-ar-rxce');
                    hc.style.setProperty('color', LIKE_COUNT_COLOR, 'important');
                    ce.insertAdjacentElement('afterend', hc);
                }
                hc.style.removeProperty('display');
                hc.textContent = String(h);
            } else if (hc) hc.remove();
        } else {
            if (hc) hc.remove();
            lb.querySelectorAll('[data-ar-rxce]').forEach(e => { e.style.removeProperty('display'); e.removeAttribute('data-ar-rxce'); });
        }
        // sem reações no comentário: o número NATIVO do VK também sublinha e abre a lista de quem curtiu
        lb.querySelectorAll('[data-ar-rxn]').forEach(e => { if (!(total === 0 && e === ce)) e.removeAttribute('data-ar-rxn'); });
        if (total === 0 && ce && (parseInt(ce.textContent, 10) || 0) > 0) ce.setAttribute('data-ar-rxn', '1');
        const nat = [...lb.querySelectorAll('svg')].find(s => !s.hasAttribute('data-ar-hov'));
        let ov = lb.querySelector('svg[data-ar-hov]');
        if (v.mine && nat) {
            if (!ov) {
                const t = document.createElement('template');
                t.innerHTML = '<svg data-ar-hov="1" aria-hidden="true" display="block" class="vkuiIcon vkuiIcon--16 vkuiIcon--w-16 vkuiIcon--h-16" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="width:16px;height:16px;color:' + LIKE_GRAY + '">' + HEART_OUTLINE + '</svg>';
                ov = t.content.firstElementChild;
                nat.insertAdjacentElement('afterend', ov);
            }
            if (nat.style.display !== 'none') { nat.style.display = 'none'; nat.setAttribute('data-ar-rxhide', '1'); }
        } else {
            if (ov) ov.remove();
            lb.querySelectorAll('[data-ar-rxhide]').forEach(s => { s.style.display = ''; s.removeAttribute('data-ar-rxhide'); });
        }
    }

    function rxApplyLike(card, cid, lb) {
        const v = rxView(cid);
        let total = 0, likeTotal = 0;   // total = todas as reações (pílulas); likeTotal = só as que também curtiram no VK
        RX_LIST.forEach(r => {
            if (r.id === 1) return;
            const n = v.counts[r.id] || 0;
            total += n;
            if (!r.noLike) likeTotal += n;
        });
        rxPills(card, lb, v, total);
        rxHeart(lb, v, likeTotal);
    }

    function rxSync() {
        if (!isTopic()) { document.querySelectorAll('.ar-rx').forEach(e => e.remove()); return; }
        commentNodes(document).forEach(card => {
            if (card.hasAttribute('data-ar-dup') || card.hasAttribute('data-ar-deleted')) return;
            const lb = findLikeBox(card), id = numId(card);
            if (lb && lb.parentElement && Number.isFinite(id)) rxApplyLike(card, id, lb);
        });
        const fb = rxFirstBlock();   // 1º post do tópico, fixo no topo
        if (fb) {
            fb.setAttribute('data-ar-rxfirst', '1');
            const lb = findLikeBox(fb);
            if (lb && lb.parentElement) rxApplyLike(fb, rx.firstId, lb);
        }
        // cartão do post em destaque do Salva VK (o original e a cópia do rodapé do modo compacto), se existir
        document.querySelectorAll('[data-ar-top-mode="card"]').forEach(top => {
            const cid = Number(top.getAttribute('data-ar-top-id'));
            if (!Number.isFinite(cid)) return;
            top.querySelectorAll('[data-testid="comment-like"]').forEach(lb => { if (lb.parentElement) rxApplyLike(top, cid, lb); });
        });
    }

    // ---------- Nomes e fotos dos usuários ----------
    // Um só cache (id -> nome, link, foto). Nome e link ficam no localStorage; a foto só vale na sessão.
    const RX_USERS_KEY = 'vk_arx_users_v2';
    const rxUsers = new Map();
    { const a = LS.json(RX_USERS_KEY); if (Array.isArray(a)) a.forEach(x => rxUsers.set(x[0], { name: x[1], href: x[2], photo: '' })); }
    const rxUserOf = id => rxUsers.get(id) || { name: 'id' + id, href: '/id' + id, photo: '' };
    async function rxResolve(ids, withPhoto) {
        const need = ids.filter(id => { const u = rxUsers.get(id); return !u || (withPhoto && !u.photo); });
        if (!need.length) return;
        try {
            const r = await apiCall('users.get', { user_ids: need.join(','), fields: 'photo_100,photo_50,screen_name' });
            (Array.isArray(r) ? r : ((r && r.items) || [])).forEach(u => rxUsers.set(u.id, {
                name: [u.first_name, u.last_name].filter(Boolean).join(' '),
                href: '/' + (u.screen_name || ('id' + u.id)),
                photo: u.photo_100 || u.photo_50 || ''
            }));
            LS.setJson(RX_USERS_KEY, [...rxUsers].slice(-3000).map(([id, u]) => [id, u.name, u.href]));
        } catch (err) { rxLog('users.get falhou:', err && err.message); }
    }

    // ---------- Balão ao parar o mouse numa pílula ----------
    let tipEl = null, tipFor = null, tipTimer = null, tipHideT = null;

    function rxHideTip() {
        clearTimeout(tipTimer);
        clearTimeout(tipHideT);
        tipFor = null;
        if (tipEl) tipEl.style.display = 'none';
    }

    function rxShowTip(pill, cid, rid, n, users) {
        if (!tipEl) {
            tipEl = mk('position:fixed;z-index:100000;width:max-content;max-width:320px;padding:8px 12px;border-radius:12px;' +
                       'font:13px/1.3 -apple-system,BlinkMacSystemFont,Roboto,"Segoe UI",sans-serif;cursor:pointer;display:none;' +
                       'box-shadow:0 6px 24px rgba(0,0,0,.28);border:1px solid rgba(128,128,128,.35);');
            tipEl.id = 'vk-arx-tip';
            tipEl.addEventListener('mouseenter', () => clearTimeout(tipHideT));
            tipEl.addEventListener('mouseleave', () => { clearTimeout(tipHideT); tipHideT = setTimeout(rxHideTip, 350); });
            tipEl.addEventListener('click', ev => {
                const k = tipEl.__k;
                if (!k) return;
                ev.preventDefault();
                ev.stopPropagation();
                rxHideTip();
                rxOpenModal(k.cid, k.rid);
            });
            document.body.appendChild(tipEl);
        }
        const th = themeColors();
        tipEl.style.background = th.bg;
        tipEl.style.color = th.color;
        tipEl.textContent = '';
        tipEl.__k = { cid, rid };
        const row = mk('display:flex;gap:6px;align-items:center;');
        users.slice(0, 3).forEach(u => row.appendChild(avatarEl(u.photo, 20)));
        row.appendChild(mk('', n === 1 ? '1 pessoa avaliou' : n + ' pessoas avaliaram'));
        row.appendChild(mk('opacity:.5;margin-left:2px;', '›', 'span'));
        tipEl.appendChild(row);
        tipEl.style.display = 'block';
        const r = pill.getBoundingClientRect(), h = tipEl.offsetHeight, w = tipEl.offsetWidth;
        let top = r.top - h - 2;
        if (top < 8) top = r.bottom + 2;
        tipEl.style.top = top + 'px';
        tipEl.style.left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8) + 'px';
    }

    // ---------- Janelas ----------
    const rxCloseModal = () => { const m = document.getElementById('vk-arx-modal'); if (m) m.remove(); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') rxCloseModal(); }, true);

    function rxModalBase(titleText) {
        rxCloseModal();
        rxHideTip();
        rxHidePicker(true);
        const th = themeColors();
        const ov = mk('position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;animation:ar-rx-fade .15s ease-out;');
        ov.id = 'vk-arx-modal';
        ov.addEventListener('click', ev => { if (ev.target === ov) rxCloseModal(); });
        const box = mk('width:min(400px,92vw);max-height:80vh;display:flex;flex-direction:column;border-radius:16px;overflow:hidden;' +
                       'box-shadow:0 12px 40px rgba(0,0,0,.4);font:14px/1.4 -apple-system,BlinkMacSystemFont,Roboto,"Segoe UI",sans-serif;' +
                       'background:' + th.bg + ';color:' + th.color + ';animation:ar-rx-pop .18s cubic-bezier(.2,.9,.3,1);');
        const head = mk('flex:none;display:flex;align-items:center;gap:8px;padding:16px 14px 10px 20px;');
        const total = mk('font-size:13px;opacity:.55;', '', 'span');
        const close = mk('', '✕', 'button');
        close.type = 'button';
        close.className = 'ar-rx-x';
        close.style.marginLeft = 'auto';
        close.setAttribute('aria-label', 'Fechar');
        close.addEventListener('click', rxCloseModal);
        head.append(mk('font-weight:700;font-size:16px;', titleText, 'span'), total, close);
        box.appendChild(head);
        ov.appendChild(box);
        document.body.appendChild(ov);
        return { box, total };
    }

    function rxUserRow(u, icon) {
        const a = mk('', null, 'a');
        a.className = 'ar-rx-row';
        a.href = u.href;
        a.append(avatarEl(u.photo, 40), mk('flex:1;min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', u.name, 'span'));
        if (icon) a.appendChild(icon);
        return a;
    }

    // Quem curtiu no VK (curtida nativa): normaliza um item de likes.getList
    const rxNormLiker = i => {
        if (!i || typeof i !== 'object') { const n = Number(i) || 0; return { id: n, name: 'id' + n, href: '/id' + n, photo: '' }; }
        const raw = Math.abs(i.id || i.user_id || 0);
        const group = i.type === 'group' || (i.name && !i.first_name);
        return {
            id: group ? -raw : raw,   // comunidade fica negativa, para nunca coincidir com o id de um usuário
            name: group ? i.name : ([i.first_name, i.last_name].filter(Boolean).join(' ') || ('id' + raw)),
            href: '/' + (i.screen_name || ((group ? 'club' : 'id') + raw)),
            photo: i.photo_100 || i.photo_50 || ''
        };
    };
    async function rxLoadLikes(cid) {
        const m = location.pathname.match(TOPIC_RE);
        if (!m) throw new Error('não é uma página de tópico');
        const r = await apiCall('likes.getList', { type: 'topic_comment', owner_id: '-' + m[1], item_id: cid, extended: 1, count: 1000, fields: 'photo_100,photo_50,screen_name' });
        const items = ((r && r.items) || []).map(rxNormLiker);
        return { count: r && typeof r.count === 'number' ? r.count : items.length, items };
    }

    // Janela única "Reações": reações do script (uma aba por reação) + curtidas nativas do VK (sempre a última aba).
    // As curtidas nativas listadas são só as de quem NÃO reagiu pelo script (quem reagiu já aparece na sua reação).
    // startId: id de uma reação abre a aba dela; 1 (coração) abre a aba das curtidas nativas; outro valor abre "Todas".
    function rxOpenModal(cid, startId) {
        if (!Number.isFinite(cid)) return;
        const who = rx.who.get(cid) || {};
        const groups = RX_LIST.filter(r => r.id !== 1 && (who[r.id] || []).length).map(r => ({ r, ids: who[r.id] }));
        const all = [].concat(...groups.map(g => g.ids.map(id => ({ id, r: g.r }))));
        const reactorIds = new Set(all.map(x => x.id));
        const heart = RX_BY_ID['1'];
        const { box, total } = rxModalBase('Reações');

        const tabs = mk('flex:none;display:flex;gap:6px;flex-wrap:wrap;padding:0 20px 12px;border-bottom:1px solid rgba(128,128,128,.25);');
        const list = mk('flex:1 1 auto;min-height:60px;overflow:auto;padding:6px 0;');
        const foot = mk('flex:none;display:flex;gap:8px;align-items:flex-start;padding:10px 20px;font-size:12px;line-height:1.4;opacity:.7;' +
                        'background:rgba(128,128,128,.07);border-top:1px solid rgba(128,128,128,.2);');
        foot.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="flex:none;margin-top:2px">' +
            '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path></svg>';
        foot.appendChild(mk('', 'As reações também contam como curtida na versão nativa do VK; com exceção das reações negativas (🙄 🤡 😢 🤬).', 'span'));
        box.append(tabs, list, foot);
        list.appendChild(mk('padding:24px 20px;text-align:center;opacity:.6;', 'carregando…'));

        Promise.all([
            rxResolve([...reactorIds], true),
            rxLoadLikes(cid).catch(e => { rxLog('Erro ao carregar as curtidas:', e && e.message); return null; })
        ]).then(([, lk]) => {
            if (!box.isConnected) return;
            const only = lk ? lk.items.filter(u => !reactorIds.has(u.id)) : [];   // curtiram, mas não reagiram pelo script
            const nativeCount = lk ? (lk.items.length >= lk.count ? only.length : Math.max(only.length, lk.count - all.filter(x => !x.r.noLike).length)) : 0;
            const failed = !lk;
            total.textContent = String(all.length + nativeCount);
            let cur = startId === 1 && nativeCount ? 'hearts' : (groups.some(g => g.r.id === startId) ? startId : 'all');

            const muted = txt => mk('padding:14px 20px;text-align:center;font-size:12px;opacity:.6;', txt);
            const drawTabs = () => {
                tabs.textContent = '';
                const mkTab = (id, icon, n) => {
                    const b = mk('', null, 'button');
                    b.type = 'button';
                    b.className = 'ar-rx-tab' + (cur === id ? ' ar-on' : '');
                    if (icon) b.appendChild(rxIcon(icon, 16)); else b.appendChild(document.createTextNode('Todas'));
                    b.appendChild(mk('', String(n), 'span')).className = 'n';
                    b.addEventListener('click', () => { cur = id; drawTabs(); drawList(); });
                    tabs.appendChild(b);
                };
                mkTab('all', null, all.length + nativeCount);
                groups.forEach(g => mkTab(g.r.id, g.r, g.ids.length));
                if (nativeCount) mkTab('hearts', heart, nativeCount);   // curtidas nativas: sempre a última
            };
            // Linha-resumo das curtidas nativas na aba "Todas": foto de quem curtiu por último + "Fulano e + X usuários" + coração
            const heartSummary = () => {
                const last = only[0], more = nativeCount - 1;   // o VK lista da curtida mais recente para a mais antiga
                const row = mk('cursor:pointer;');
                row.className = 'ar-rx-row';
                row.setAttribute('role', 'button');
                row.tabIndex = 0;
                const go = () => { cur = 'hearts'; drawTabs(); drawList(); };
                row.addEventListener('click', go);
                row.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
                row.append(avatarEl(last.photo, 40),
                           mk('flex:1;min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
                              last.name + (more > 0 ? ' e + ' + more + (more === 1 ? ' usuário' : ' usuários') : ''), 'span'),
                           rxIcon(heart, 22));
                return row;
            };
            const drawList = () => {
                list.textContent = '';
                if (cur === 'hearts') {
                    only.forEach(u => list.appendChild(rxUserRow(u, null)));
                    if (only.length < nativeCount) list.appendChild(muted('e mais ' + (nativeCount - only.length) + ' que não couberam na lista'));
                    return;
                }
                if (cur === 'all') {
                    all.forEach(x => list.appendChild(rxUserRow(rxUserOf(x.id), rxIcon(x.r, 22))));
                    if (nativeCount && only.length) list.appendChild(heartSummary());   // sempre a última linha
                    if (failed) list.appendChild(muted('Não foi possível carregar as curtidas do VK'));
                    if (!all.length && !nativeCount && !failed) list.appendChild(mk('padding:24px 20px;text-align:center;opacity:.6;', 'Ninguém reagiu ainda'));
                    return;
                }
                const g = groups.find(x => x.r.id === cur);
                (g ? g.ids : []).forEach(id => list.appendChild(rxUserRow(rxUserOf(id), null)));
            };
            drawTabs();
            drawList();
        });
    }

    // ---------- Seletor de reações ----------
    let rxPickEl = null, rxShowTimer = null, rxHideTimer = null, rxPickFor = null;

    function rxHidePicker(now) {
        clearTimeout(rxHideTimer);
        const f = () => { if (rxPickEl) rxPickEl.style.display = 'none'; rxPickFor = null; };
        if (now) f(); else rxHideTimer = setTimeout(f, 300);
    }

    function rxShowPicker(lb) {
        const card = rxCardOf(lb);
        if (!card || !lb.isConnected) return;
        const mine = rxView(rxCardId(card)).mine, liked = rxIsLiked(card);
        if (!rxPickEl) {
            rxPickEl = document.createElement('div');
            rxPickEl.id = 'ar-rx-picker';
            rxPickEl.addEventListener('mouseenter', () => clearTimeout(rxHideTimer));
            rxPickEl.addEventListener('mouseleave', () => rxHidePicker());
            document.body.appendChild(rxPickEl);
        }
        rxPickEl.textContent = '';
        RX_LIST.forEach(r => {
            const b = document.createElement('button');
            b.type = 'button';
            const on = r.id === 1 ? (liked && !mine) : mine === String(r.id);
            b.className = 'ar-rx-opt' + (on ? ' ar-rx-mine' : '');
            b.title = r.name;
            b.appendChild(rxIcon(r, 28));
            b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); rxHidePicker(true); rxChoose(card, r.id); });
            rxPickEl.appendChild(b);
        });
        rxPickEl.style.display = 'flex';
        const rc = lb.getBoundingClientRect(), w = rxPickEl.offsetWidth, h = rxPickEl.offsetHeight;
        let top = rc.top - h - 6;
        if (top < 8) top = rc.bottom + 6;
        rxPickEl.style.top = top + 'px';
        rxPickEl.style.left = Math.min(Math.max(8, rc.right - w), window.innerWidth - w - 8) + 'px';
        rxPickFor = lb;
    }

    // ---------- Eventos (na janela, fase de captura: rodam antes dos tratadores do VK e do Salva VK) ----------
    const rxEl = e => (e.target && e.target.closest ? e.target : null);
    const rxLikeTarget = e => {   // botão de curtir (de um comentário) sob o evento
        const t = rxEl(e) && e.target.closest(LIKE_ANY);
        return t && rxCardOf(t) ? t : null;
    };

    window.addEventListener('mouseover', e => {
        const tg = rxEl(e);
        if (!tg) return;
        const pill = tg.closest('.ar-rx-pill');
        if (pill) {
            clearTimeout(tipHideT);
            if (pill === tipFor) return;
            rxHideTip();
            tipFor = pill;
            tipTimer = setTimeout(async () => {
                const cid = rxCidOf(pill), rid = Number(pill.getAttribute('data-rid'));
                const nEl = pill.querySelector('.ar-rx-n');
                const n = nEl ? (parseInt(nEl.textContent, 10) || 0) : 0;
                const ids = (((rx.who.get(cid) || {})[rid]) || []).slice(0, 3);
                if (ids.length) await rxResolve(ids, true);
                if (tipFor !== pill || !pill.isConnected) return;
                rxShowTip(pill, cid, rid, n, ids.map(rxUserOf));
            }, 250);
            return;
        }
        const t = rxLikeTarget(e);
        if (!t) return;
        rxNudge(); if (RX_NO_HEART_TIP) e.stopPropagation();   // sem o balão "X pessoas avaliaram" (do VK ou do Salva VK)
        if (t === rxPickFor) { clearTimeout(rxHideTimer); return; }
        clearTimeout(rxShowTimer);
        rxShowTimer = setTimeout(() => rxShowPicker(t), RX_HOVER_MS);
    }, true);

    window.addEventListener('mouseout', e => {
        const tg = rxEl(e);
        if (!tg) return;
        const pill = tg.closest('.ar-rx-pill');
        if (pill) {
            if (tipFor === pill && !(e.relatedTarget && (pill.contains(e.relatedTarget) || (tipEl && tipEl.contains(e.relatedTarget))))) {
                clearTimeout(tipTimer);
                clearTimeout(tipHideT);
                tipHideT = setTimeout(rxHideTip, 350);
            }
            return;
        }
        const t = rxLikeTarget(e);
        if (!t) return;
        if (RX_NO_HEART_TIP) e.stopPropagation();
        clearTimeout(rxShowTimer);
        if (!(e.relatedTarget && (t.contains(e.relatedTarget) || (rxPickEl && rxPickEl.contains(e.relatedTarget))))) rxHidePicker();
    }, true);

    if (RX_NO_HEART_TIP) {
        ['pointerover', 'pointerout'].forEach(type => window.addEventListener(type, e => { if (rxLikeTarget(e)) e.stopPropagation(); }, true));
    }

    window.addEventListener('scroll', e => {
        if (tipEl && e.target === tipEl) return;
        rxHideTip();
        rxHidePicker(true);
    }, true);

    window.addEventListener('click', e => {
        const tg = rxEl(e);
        if (!tg || rx.self) return;

        // Pílula de reação: clicar no número abre a lista; clicar no resto alterna a sua reação
        const pill = tg.closest('.ar-rx-pill');
        if (pill) {
            e.preventDefault();
            e.stopPropagation();
            const rid = Number(pill.getAttribute('data-rid'));
            if (tg.closest('.ar-rx-n')) { rxOpenModal(rxCidOf(pill), rid); return; }
            const card = rxCardOf(pill);
            if (card) rxChoose(card, rid);
            return;
        }

        const t = tg.closest(LIKE_ANY);
        if (!t) return;

        // Número do coração (o que o script desenha): abre a janela única, na aba das curtidas nativas
        if (tg.closest('.ar-rx-hc')) {
            e.preventDefault();
            e.stopPropagation();
            rxOpenModal(rxCidOf(t), 1);
            return;
        }

        // Número de curtidas nativo (comentário sem reações): idem
        // (achado na hora do clique, sem depender da marca: o script principal troca o botão de curtir dos comentários novos e apaga a marca)
        const nce = findCountEl(t);
        if (nce && (nce === tg || nce.contains(tg)) && (parseInt(nce.textContent, 10) || 0) > 0) {
            const ncid = rxCidOf(t);
            if (Number.isFinite(ncid)) {
                e.preventDefault();
                e.stopPropagation();
                rxOpenModal(ncid, 1);
                return;
            }
        }

        // Coração vazio (a sua reação é outra): vira coração simples (a reação sai, a curtida fica)
        const card = rxCardOf(t);
        if (!card || meId == null || !topicKey()) return;
        if (!rxView(rxCardId(card)).mine) return;   // sem reação: o clique é a curtida padrão do VK
        e.preventDefault();
        e.stopPropagation();
        rxChoose(card, 1);
    }, true);

    // ---------- Notificações (pop-ups e janela) ----------
    // Troca "curtiu seu comentário" por "reagiu com 🔥 ao seu comentário" quando a curtida veio de uma reação do script.
    const rxNorm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const rxHash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

    // Agenda a próxima tentativa; esgotados os intervalos, marca como morto (lastGap == null) ou espera lastGap
    function rxRetry(st, gaps, lastGap) {
        const g = gaps[st.tries++];
        if (g != null) st.next = Date.now() + g;
        else if (lastGap == null) st.dead = true;
        else st.next = Date.now() + lastGap;
    }

    // id de reação -> objeto da reação, ou null se não deve virar "reação" na notificação
    const rxNtReaction = sid => {
        const r = RX_BY_ID[String(sid)];
        if (!r || r.id === 1) return null;
        return (r.noLike && !RX_NT_NEGATIVE) ? null : r;
    };

    // ---------- Espelho local das reações ----------
    // "tópico:comentário" -> { m: Map(user_id -> id da reação), ft: hora da última leitura completa desse comentário }
    // Guardado no localStorage e atualizado só com o que mudou (delta): a janela de notificações abre já resolvida, sem "piscar" item por item.
    const RX_NT_MIRROR_KEY = 'vk_arx_nt_mirror_v1';
    const rxNtMirror = new Map();
    const RX_NT_MIRROR_AT_KEY = 'vk_arx_nt_mirror_at_v1';   // hora da última atualização bem-sucedida do espelho (compartilhada entre abas)
    let rxNtCursor = null, rxNtMirrorAt = 0, rxNtMirrorBusy = false, rxNtSavedAt = 0;

    function rxNtEntry(k) {
        let e = rxNtMirror.get(k);
        if (!e) { e = { m: new Map(), t: new Map(), o: null, ft: 0 }; rxNtMirror.set(k, e); }
        return e;
    }
    function rxNtMirrorSet(key, cid, uid, emoji, owner, updated) {
        const e = rxNtEntry(key + ':' + cid), id = Number(uid), em = String(emoji);
        if (owner != null && Number.isFinite(Number(owner))) e.o = Number(owner);
        if (em === '0') { e.m.delete(id); e.t.delete(id); }
        else { e.m.set(id, em); if (updated) e.t.set(id, String(updated)); }
    }
    {
        const s = LS.json(RX_NT_MIRROR_KEY);
        if (s && s.v === 2 && Array.isArray(s.r)) {
            s.r.forEach(a => rxNtMirrorSet(a[0], a[1], a[2], a[3], a[4], a[5]));
            rxNtCursor = s.c || null;
            if (Array.isArray(s.f)) s.f.forEach(k => { rxNtEntry(k).ft = 1; });
            // Espelho salvo há pouco (por esta ou outra aba): não refaz a consulta só porque a página foi recarregada.
            const at = Number(LS.get(RX_NT_MIRROR_AT_KEY));
            if (Number.isFinite(at) && at <= Date.now() && Date.now() - at < RX_NT_MIRROR_EVERY_MS && rxNtCursor) rxNtMirrorAt = at;
        }
    }
    function rxNtMirrorSave() {
        const r = [], f = [];
        rxNtMirror.forEach((e, k) => {
            const i = k.lastIndexOf(':');
            e.m.forEach((emoji, uid) => r.push([k.slice(0, i), Number(k.slice(i + 1)), uid, emoji, e.o, e.t.get(uid) || '']));
            if (e.ft) f.push(k);
        });
        rxNtSavedAt = Date.now();
        LS.setJson(RX_NT_MIRROR_KEY, { v: 2, c: r.length > 8000 ? null : rxNtCursor, r: r.slice(-8000), f: f.slice(-4000) });
    }

    async function rxNtMirrorRefresh() {
        if (rxNtMirrorBusy || !RX_NT_MIRROR_EVERY_MS) return;
        rxNtMirrorBusy = true;
        rxNtMirrorAt = Date.now();
        try {
            const floor = Date.now() - RX_NT_MIRROR_DAYS * 86400000;
            // Só aceita o cursor composto atual. Cursors antigos (timestamp simples) forçam reconstrução integral.
            const validCursor = rxCursorParts(rxNtCursor);
            const savedTime = validCursor ? Date.parse(validCursor[0]) : NaN;
            let since = validCursor && Number.isFinite(savedTime) && savedTime > floor ? rxNtCursor : new Date(floor).toISOString();
            const reset = since !== rxNtCursor;
            if (reset) rxNtMirror.clear(); // cursor ausente/antigo: reconstrói a janela de N dias
            let n = 0;
            for (let page = 0; page < 6; page++) {
                const tuple = rxCursorParts(since);
                const cursorQuery = tuple ? '&after=' + encodeURIComponent(since) : '&updated_at=gt.' + encodeURIComponent(since);
                const rows = await rxGet('&order=updated_at.asc&limit=1000' + cursorQuery);
                rows.forEach(r => rxNtMirrorSet(r.topic, r.comment_id, r.user_id, r.emoji, r.comment_owner_id, r.t));
                n += rows.length;
                if (rows.length) since = rxCursorOf(rows[rows.length - 1]);
                if (rows.length < 1000) break;
            }
            rxNtCursor = since;
            if (n || reset) rxNtMirrorSave();
            LS.set(RX_NT_MIRROR_AT_KEY, String(Date.now()));
            if (n) {
                // O espelho mudou: invalida a lista preparada para reconstruí-la já, sem nova consulta ao D1.
                rxNtOwnAt = 0;
                rxNtSched();
            }
            if (n) rxLog('Espelho das reações: +' + n + ' linha(s)');
        } catch (e) {
            rxLog('Espelho das reações: erro:', e && e.message);
        } finally {
            rxNtMirrorBusy = false;
        }
    }

    // Leitura completa de alguns comentários de um tópico, numa única consulta; grava no espelho (inclusive os sem reação)
    async function rxNtBatch(key, cids) {
        const rows = [];
        for (let i = 0; i < cids.length; i += 95) {
            const batch = cids.slice(i, i + 95);
            for (let offset = 0; ; offset += 1000) {
                const page = await rxGet('&limit=1000&offset=' + offset + '&topic=eq.' + key + '&comment_id=in.(' + batch.join(',') + ')&emoji=neq.0');
                rows.push(...page);
                if (page.length < 1000) break;
                if (offset >= 100000) throw new Error('Lote de reações atingiu o limite de 101.000 linhas');
            }
        }
        const fresh = new Map();
        cids.forEach(c => fresh.set(c, new Map()));
        rows.forEach(r => { const m = fresh.get(r.comment_id); if (m) m.set(r.user_id, String(r.emoji)); });
        fresh.forEach((m, cid) => {
            const e = rxNtEntry(key + ':' + cid);
            e.m = m; e.t = new Map();
            rows.filter(r => Number(r.comment_id) === Number(cid)).forEach(r => {
                if (r.t) e.t.set(Number(r.user_id), r.t);
                if (r.comment_owner_id != null) e.o = Number(r.comment_owner_id);
            });
            e.ft = Date.now();
        });
        if (Date.now() - rxNtSavedAt > 5000) rxNtMirrorSave();
    }
    async function rxNtReactors(key, cid, fresh) {
        const k = key + ':' + cid, e = rxNtMirror.get(k);
        if (e && e.ft && !fresh && Date.now() - e.ft < 4000) return e.m;
        await rxNtBatch(key, [cid]);
        return rxNtMirror.get(k).m;
    }

    // ---------- Quem aparece na notificação ----------
    // O VK nem sempre põe o id no link do avatar (/alanroberto) e nas notificações agrupadas só há o nome (alt):
    // o cache de usuários (id -> nome e @apelido) permite casar quem reagiu com quem aparece.
    const rxNtUserTry = new Map();
    async function rxNtEnsureUsers(uids) {
        const now = Date.now();
        const need = [...new Set(uids)].filter(u => !rxUsers.has(u) && now >= (rxNtUserTry.get(u) || 0)).slice(0, 200);
        if (!need.length) return;
        need.forEach(u => rxNtUserTry.set(u, now + 15000));
        await rxResolve(need);
        rxNtSched();
    }
    // Quem na notificação (i = { uid, sn, alt }) corresponde a qual reação em ent (entrada do espelho)
    function rxNtMatchOne(i, ent) {
        for (const [uid, e] of ent.m) {
            if (i.uid != null) { if (uid === i.uid) return rxNtReaction(e); continue; }
            const d = rxUsers.get(uid);
            if (!d) continue;
            const sn = /^\/id\d+$/.test(d.href) ? '' : d.href.slice(1);
            if ((i.sn && sn && rxNorm(sn) === rxNorm(i.sn)) || (i.alt && rxNorm(d.name) === rxNorm(i.alt))) return rxNtReaction(e);
        }
        return null;
    }

    // nome da reação em negrito e cor de destaque, no mesmo fluxo do texto (sem ícone)
    function rxNtChip(r) {
        const name = document.createElement('span');
        name.className = 'ar-nt-chip';
        name.textContent = r.name.toLocaleLowerCase('pt-BR');
        return name;
    }

    function rxNtAppendPhrase(target, reaction, many) {
        target.style.fontWeight = '400';
        const T = s => document.createTextNode(s);
        target.append(T((many ? 'reagiram' : 'reagiu') + ' com '), rxNtChip(reaction), T(' ao seu comentário'));
    }

    function rxNtNodes(rs, orig) {
        const got = rs.filter(Boolean), uniq = [...new Map(got.map(r => [Number(r.id), r])).values()];
        const T = s => document.createTextNode(s);
        // todos reagiram com a mesma reação: "reagiu com [ícone Nome] ao seu comentário"
        if (got.length === rs.length && uniq.length === 1) {
            return [T(' ' + (rs.length > 1 ? RX_NT.verbMany : RX_NT.verbOne) + ' com '), rxNtChip(uniq[0]), T(' ' + RX_NT.tail + ' ')];
        }
        // reações diferentes (ou só alguns reagiram): texto + pílulas em sequência
        const out = [T(got.length === rs.length ? ' ' + (rs.length > 1 ? RX_NT.verbMany : RX_NT.verbOne) + ' ' + RX_NT.tail + ' ' : (orig || '') + ' ')];
        uniq.forEach(r => { out.push(rxNtChip(r)); out.push(T(' ')); });
        return out;
    }

    // ----- Pop-up (.notifier_baloon) -----
    const rxNtPop = new WeakMap();

    function rxNtPopInfo(msg) {
        const uids = [...msg.querySelectorAll('a.mem_link, a[mention_id]')].map(a => {
            const m = (a.getAttribute('mention_id') || a.getAttribute('href') || '').match(/id(\d+)/);
            return m ? Number(m[1]) : NaN;
        }).filter(Number.isFinite);
        const a = [...msg.querySelectorAll('a[href*="post="]')].find(x => {
            try { return TOPIC_RE.test(new URL(x.href, location.href).pathname); } catch (e) { return false; }
        });
        if (!uids.length || !a) return null;
        const u = new URL(a.href, location.href), m = u.pathname.match(TOPIC_RE), cid = Number(u.searchParams.get('post'));
        if (!m || !Number.isFinite(cid)) return null;
        return { uids, key: m[1] + '_' + m[2], cid };
    }

    function rxNtPopApply(el, msg, rs) {
        if (msg.querySelector('[data-ar-nt]')) return;
        const lastMem = [...msg.querySelectorAll('a.mem_link')].pop();
        const anchor = lastMem && (lastMem.closest('b') || lastMem);
        const tn = anchor && anchor.nextSibling;
        if (!tn || tn.nodeType !== 3) return;   // o texto do verbo é o nó de texto logo depois do nome
        const wrap = document.createElement('span');
        wrap.style.fontWeight = '400';
        wrap.setAttribute('data-ar-nt', '1');
        const gotPop = rs.filter(Boolean);
        wrap.appendChild(document.createTextNode(gotPop.length === rs.length
            ? ' ' + (rs.length > 1 ? RX_NT.verbMany : RX_NT.verbOne) + ' ' + RX_NT.tail + ' '
            : tn.nodeValue));
        tn.replaceWith(wrap);
        const got = rs.filter(Boolean);
        if (got.length === rs.length) {
            const title = el.querySelector('[data-testid="notifier-title"]');
            if (title) title.textContent = RX_NT.title;
            const uniq = [...new Set(got)];
            const fi = el.querySelector('.feedback_photo_icon');   // o coração vermelho vira o ícone da reação
            if (fi && uniq.length === 1) { fi.textContent = ''; fi.appendChild(rxIcon(uniq[0], 20)); }
        }
    }

    async function rxNtPopup(el) {
        let st = rxNtPop.get(el);
        if (!st) { st = { tries: 0, next: 0, busy: false, done: false, dead: false, rs: null }; rxNtPop.set(el, st); }
        if (st.busy || st.dead) return;
        const msg = el.querySelector('[data-testid="notifier-text"], .notifier_baloon_msg');
        if (!msg) return;
        if (st.done) { rxNtPopApply(el, msg, st.rs); return; }   // o VK redesenhou: reaplica
        if (Date.now() < st.next) return;
        const info = rxNtPopInfo(msg);
        if (!info) { st.dead = true; return; }
        st.busy = true;
        try {
            const map = await rxNtReactors(info.key, info.cid, st.tries > 0);
            const rs = info.uids.map(u => rxNtReaction(map.get(u)));
            if (rs.some(Boolean)) {
                st.done = true;
                st.rs = rs;
                rxNtPopApply(el, msg, rs);
                rxLog('Notificação (pop-up) reescrita: comentário ' + info.cid + ' | ' + rs.map(r => r ? r.name : 'curtida').join(', '));
            } else rxRetry(st, RX_NT_POP_RETRY_MS);
        } catch (e) {
            rxLog('Notificação (pop-up): erro:', e && e.message);
            rxRetry(st, RX_NT_POP_RETRY_MS);
        } finally {
            st.busy = false;
        }
    }

    // ----- Janela de notificações -----
    // 1) Com os ids do link da notificação (?post= e /idNNN dos avatares): resolve de forma SÍNCRONA pelo espelho local.
    // 2) O que o espelho não souber é consultado em lote (uma consulta por tópico), nunca item por item.
    // 3) Quem aparece na notificação é casado por id, @apelido do link do avatar ou nome (alt).
    // Um observador do DOM reaplica tudo antes da próxima pintura quando o React recria os elementos.
    const rxNtDone = new Map();   // assinatura da notificação -> { done, tries, next, busy }

    function rxNtRowOf(t) {
        let row = t;
        while (row && !(row.querySelector('[data-testid="notification-time"]') && row.querySelector('img'))) row = row.parentElement;
        return row;
    }
    // Ids que o HTML da notificação traz: o link da notificação (?post=) e os avatares, que podem ser /idNNN, /apelido ou só o nome (alt)
    function rxNtListIds(t, row) {
        let key = null, cid = null;
        const a = t.closest('a[href*="post="]');
        if (a) {
            try {
                const u = new URL(a.href, location.href), m = u.pathname.match(TOPIC_RE), n = Number(u.searchParams.get('post'));
                if (m && Number.isFinite(n)) { key = m[1] + '_' + m[2]; cid = n; }
            } catch (e) {}
        }
        const scope = a || row;
        const links = [...scope.querySelectorAll('a[data-testid="notification-avatar"][href]')];
        const ident = links.length
            ? links.map(x => {
                const m = String(x.getAttribute('href') || '').match(/^(?:https?:\/\/[^/]+)?\/([^/?#]+)/);
                const seg = m ? m[1] : '', idm = seg.match(/^id(\d+)$/), im = x.querySelector('img[alt]');
                return { uid: idm ? Number(idm[1]) : null, sn: idm ? null : seg, alt: im ? im.getAttribute('alt') : '' };
            })
            : [...scope.querySelectorAll('[data-testid="notification-additional-avatar"] img[alt]')]
                .map(i => ({ uid: null, sn: null, alt: i.getAttribute('alt') || '' }));
        return { key, cid, ident };
    }
    function rxNtListInfo(t) {
        const row = rxNtRowOf(t);
        if (!row) return null;
        const q = row.querySelector('[style*="textclamp-lines"]');
        const hd = row.querySelector('[data-testid="notification-header"]');
        const header = hd ? hd.textContent : '';
        const ids = rxNtListIds(t, row);
        const sig = rxHash(rxNorm([t.textContent, q ? q.textContent : '', header, ids.key, ids.cid, JSON.stringify(ids.ident)].join('|')));
        return { row, header, ids, sig };
    }
    // Situação da notificação pelo espelho (síncrono). final = já dá para mostrar (ou para afirmar que é curtida comum)
    //  - complete: o comentário foi lido por inteiro e, se foi preciso casar por nome/apelido, todos os que reagiram têm nome conhecido
    function rxNtState(info) {
        const { ids, header } = info;
        if (!ids.key || ids.cid == null || !ids.ident.length) return null;
        const ent = rxNtMirror.get(ids.key + ':' + ids.cid);
        if (!ent) return null;
        const dirOk = !ids.ident.some(i => i.uid == null) || [...ent.m.keys()].every(u => rxUsers.has(u));
        const complete = !!ent.ft && dirOk;
        const rs = ids.ident.map(i => rxNtMatchOne(i, ent));
        if (/\d/.test(header)) rs.push(null);   // "e + N": há gente além dos avatares, então nunca afirma que "todos" reagiram
        const n = rs.filter(Boolean).length;
        return { rs, n, complete, final: complete || (n > 0 && n === rs.length) };
    }

    function rxNtListClean(t, row) {
        const nx = t.nextElementSibling;
        if (nx && nx.hasAttribute('data-ar-nt-list')) nx.remove();
        t.removeAttribute('data-ar-nt-hide');
        if (row) row.querySelectorAll('.ar-nt-bd').forEach(e => e.remove());
    }
    // Esconde o texto original (sem mexer no nó do React) e coloca ao lado o texto novo; o ícone da reação também vai no canto do avatar
    function rxNtListApply(t, rs, info) {
        const h = info.sig + '-' + rxHash(rs.map(r => r ? r.id : 0).join(',')), nx = t.nextElementSibling;
        if (!(nx && nx.getAttribute('data-ar-nt-list') === h)) {
            rxNtListClean(t, info.row);
            const span = document.createElement('span');
            span.className = t.className;
            span.setAttribute('data-ar-nt-list', h);
            rxNtNodes(rs, (t.textContent || '').trim(), 18).forEach(n => span.appendChild(n));
            t.insertAdjacentElement('afterend', span);
        }
        t.setAttribute('data-ar-nt-hide', '1');
        const uniq = [...new Set(rs.filter(Boolean))];
        rxNtListBadge(info, uniq.length === 1 ? uniq[0] : null, h);
    }

    // Cria o selo. A animação toca ao passar o mouse na notificação (regra de CSS acima).
    function rxNtBadgeEl(r, sig) {
        const bd = document.createElement('span');
        bd.className = 'ar-nt-bd';
        bd.setAttribute('data-sig', sig);
        bd.appendChild(rxIcon(r, 20));
        return bd;
    }

    // Selo no canto do avatar (r = reação, ou o coração para curtida nativa; null remove)
    function rxNtListBadge(info, r, h) {
        const av = info.row.querySelector('[data-testid="notification-avatar"], [data-testid="notification-additional-avatar"]');
        const host = av && av.parentElement;
        if (!host) return;
        const old = [...host.children].find(c => c.classList.contains('ar-nt-bd'));
        if (!r) { if (old) old.remove(); return; }
        if (old && old.getAttribute('data-sig') === h) return;
        if (old) old.remove();
        host.setAttribute('data-ar-nt-host', '1');
        host.appendChild(rxNtBadgeEl(r, h));
    }
    
    // Rótulos em russo que o VK mostra como "texto" da prévia quando o comentário só tem mídia.
    function rxNtMediaLabelPt(raw) {
        const s = String(raw || '').trim().toLocaleLowerCase('ru');
        if (s === 'видео') return 'Comentário com vídeo';
        if (s === 'стикер') return 'Comentário com sticker';
        if (s === 'граффити') return 'Comentário com grafite';
        if (s === 'gif' || s === 'гиф') return 'Comentário com GIF';
        // "Фото", "Фотография", "3 фото", "2 фотографии"
        const m = s.match(/^(?:(\d+)\s*)?(?:фото|фотографии|фотография|фотографий)$/);
        if (m) return m[1] && Number(m[1]) > 1 ? 'Comentário com ' + m[1] + ' imagens' : 'Comentário com imagem';
        return '';
    }
    
    function rxNtListMediaPreview() {
        document.querySelectorAll('[data-testid^="notification-item-"]').forEach(item => {
            try {
                if (item.hasAttribute('data-ar-nt-own')) return;
                const reactionText = item.querySelector('[data-testid="notification-text"]');
                if (!reactionText || !RX_NT_LIKE_RE.test(reactionText.textContent || '')) return;
                const preview = item.querySelector('[style*="textclamp-lines"]');
                if (!preview) return;
    
                // Já traduzida por nós: só garante que o ícone não voltou
                const done = preview.hasAttribute('data-ar-nt-media-preview');
                const tn = [...preview.childNodes].filter(n => n.nodeType === 3 && n.nodeValue.trim()).pop();
                const raw = tn ? tn.nodeValue : preview.textContent;
                const translated = rxNtMediaLabelPt(raw);
                if (!translated && !done) return;
    
                if (translated) {
                    if (tn) { if (tn.nodeValue.trim() !== translated) tn.nodeValue = translated; }
                    else if (preview.textContent.trim() !== translated) preview.textContent = translated;
                    preview.setAttribute('data-ar-nt-media-preview', String(raw).trim().toLocaleLowerCase('ru'));
                }
    
                // Esconde o ícone (em vez de remover o nó, para não conflitar com o React do VK)
                preview.querySelectorAll('svg').forEach(s => {
                    if (s.style.display !== 'none') s.style.setProperty('display', 'none', 'important');
                });
                preview.style.color = 'var(--vkui--color_text_secondary, rgb(129, 140, 153))';
            } catch (e) {}
        });
    }

    function rxNtListQuick() {
        rxNtListMediaPreview();
        document.querySelectorAll('[data-testid="notification-text"]').forEach(t => {
            try {
                if (!RX_NT_LIKE_RE.test(t.textContent || '')) { rxNtListClean(t, null); return; }
                const info = rxNtListInfo(t);
                if (!info) return;
                const st = rxNtState(info);
                if (st && st.final && st.n > 0) rxNtListApply(t, st.rs, info);
                else if (st && st.final) {   // curtida nativa confirmada: mantém "curtiu seu comentário"; só o coração no avatar
                    const nx = t.nextElementSibling;
                    if (nx && nx.hasAttribute('data-ar-nt-list')) nx.remove();
                    t.removeAttribute('data-ar-nt-hide');
                    rxNtListBadge(info, RX_BY_ID['1'], info.sig + '-h');
                } else rxNtListClean(t, info.row);
            } catch (e) {}
        });
    }
    let rxNtRaf = false;
    function rxNtSched() {
        if (rxNtRaf) return;
        rxNtRaf = true;
        requestAnimationFrame(() => { rxNtRaf = false; rxNtListQuick(); safe(rxNtOwnTick); });
    }
    try { new MutationObserver(rxNtSched).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}

    // ----- Notificações próprias para reações negativas -----
    // Renderiza apenas reações negativas presentes no espelho incremental já sincronizado com o D1.
    const RX_NT_OWN_PREFIX = 'notification-item-salvavk-';
    const RX_NT_OWN_PREPARE_MS = 10000; // prepara em segundo plano, sem depender da abertura da aba
    const RX_NT_OWN_COMMENT_KEY = 'vk_arx_nt_own_comments_v1';
    let rxNtOwnAt = 0, rxNtOwnBusy = false, rxNtOwnRows = [], rxNtOwnRenderedAt = 0;
    const rxNtOwnComments = new Map();
    const rxNtOwnMediaOnly = new Set();
    const rxNtOwnCommentPending = new Map();
    const rxNtOwnCommentRetry = new Map();
    {
        const saved = LS.json(RX_NT_OWN_COMMENT_KEY);
        if (Array.isArray(saved)) saved.forEach(a => {
            if (Array.isArray(a) && a.length >= 2 && String(a[1]) !== 'Comentário indisponível') {
                const key = String(a[0]);
                const value = rxNtOwnFormatPreview(String(a[1]));
                // Entradas antigas com o rótulo genérico serão atualizadas pela API.
                if (value !== 'Comentário com anexo' && value !== 'Comentário sem texto' && !rxNtOwnMediaLabelFromText(value)) {
                    rxNtOwnComments.set(key, value);
                    if (a[2] === true) rxNtOwnMediaOnly.add(key);
                }
            }
        });
    }

    // Ao clicar na notificação própria, força uma navegação completa para o tópico/comentário.
    // Isso evita que o roteador SPA do VK intercepte o clique e preserve o estado antigo da página.
    document.addEventListener('click', e => {
        const link = e.target && e.target.closest ? e.target.closest('a[data-ar-nt-own-link]') : null;
        if (!link) return;
        const href = link.href;
        if (!href) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        location.href = href;
    }, true);

    function rxNtOwnTime(value) {
        const t = Date.parse(value || '');
        if (!Number.isFinite(t)) return 'agora';
        const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
        if (sec < 60) return 'agora';
        if (sec < 3600) return 'há ' + Math.floor(sec / 60) + ' min';
        if (sec < 86400) {
            const hours = Math.floor(sec / 3600);
            return hours + (hours === 1 ? ' hora atrás' : ' horas atrás');
        }
        const days = Math.floor(sec / 86400);
        if (days < 7) return days + (days === 1 ? ' dia atrás' : ' dias atrás');
        const weeks = Math.floor(days / 7);
        return weeks + (weeks === 1 ? ' semana atrás' : ' semanas atrás');
    }

    function rxNtOwnContainers() {
        const texts = [...document.querySelectorAll('[data-testid="notification-text"]')]
            .filter(t => !t.closest('[data-ar-nt-own]'));
        const candidates = texts.map(text => {
            const link = text.closest('a[href*="post="]');
            const item = link && link.closest('[data-testid^="notification-item-"]');
            if (!item || !item.parentElement) return null;

            // Nunca usar notificações agrupadas ("Fulano e mais N"): elas têm pilha de avatares
            // de terceiros e não representam o formato individual que precisamos clonar.
            const avatar = item.querySelector('a[data-testid="notification-avatar"]');
            const avatarImages = avatar ? avatar.querySelectorAll('img') : [];
            const extraAvatars = item.querySelector('[data-testid="notification-additional-avatar"]');
            const header = item.querySelector('[data-testid="notification-header"]')?.textContent || '';
            const preview = item.querySelector('[style*="textclamp-lines"]');
            if (!avatar || avatarImages.length !== 1 || extraAvatars || /\bmais\s+\d+/i.test(header) || !preview) return null;
            const host = item.closest('[data-testid="notifications-list-viewed"]');
            if (!host) return null;
            return { item, host };
        }).filter(Boolean);

        // O VK mantém a lista do painel lateral e a da página completa ao mesmo tempo.
        // Renderizamos em cada host para manter ambas sincronizadas.
        const seen = new Set();
        return candidates.filter(candidate => {
            if (seen.has(candidate.host)) return false;
            seen.add(candidate.host);
            return true;
        });
    }

    // Busca pelo ID exato. O VK às vezes falha em start_comment_id; nesse caso,
    // localizamos a posição por busca binária e consultamos o comentário por offset.
    async function rxNtOwnFetchComment(topic, commentId) {
        const m = String(topic).match(/^(-?\d+)_(\d+)$/);
        if (!m) throw new Error('tópico inválido');
        const groupId = Number(m[1]), topicId = Number(m[2]), wanted = Number(commentId);
        const pick = result => (result && Array.isArray(result.items) ? result.items : [])
            .find(x => Number(x.id != null ? x.id : x.comment_id) === wanted && !x.deleted) || null;

        try {
            const direct = await apiCall('board.getComments', {
                group_id: groupId, topic_id: topicId,
                start_comment_id: wanted, count: 1, offset: 0, sort: 'asc'
            });
            const exact = pick(direct);
            if (exact) return exact;
        } catch (e) {
            if (/token|auth/i.test(String(e && e.message))) throw e;
            rxLog('Busca direta do comentário ' + wanted + ' falhou; tentando por posição:', e && e.message);
        }

        const probe = async (offset, sort) => {
            const result = await apiCall('board.getComments', {
                group_id: groupId, topic_id: topicId,
                count: 1, offset, sort
            });
            const item = result && Array.isArray(result.items) ? result.items[0] : null;
            return {
                total: Number(result && result.count) || 0,
                id: item ? Number(item.id != null ? item.id : item.comment_id) : null
            };
        };

        const [first, last] = await Promise.all([probe(0, 'asc'), probe(0, 'desc')]);
        if (!first.total || first.id == null || last.id == null) throw new Error('o tópico não retornou comentários');
        let lo = 0, hi = first.total - 1;
        if (wanted <= first.id) hi = 0;
        else if (wanted > last.id) lo = hi;
        else {
            for (let n = 0; hi - lo > 1 && n < 30; n++) {
                const mid = Math.max(lo + 1, Math.min(hi - 1, (lo + hi) >> 1));
                const p = await probe(mid, 'asc');
                if (p.id == null) throw new Error('consulta vazia durante a busca por posição');
                if (p.id >= wanted) hi = mid;
                else lo = mid;
            }
        }
        const result = await apiCall('board.getComments', {
            group_id: groupId, topic_id: topicId,
            count: 1, offset: hi, sort: 'asc'
        });
        const exact = pick(result);
        if (!exact) throw new Error('comentário não encontrado no tópico (ID ' + wanted + ')');
        return exact;
    }

    // Converte marcações de perfil do VK para o nome visível no tópico.
    function rxNtOwnFormatPreview(value) {
        return String(value || '').replace(/\[(?:id|club|public)\d+(?::[^\]]*)?\|([^\]]+)\]/gi, '$1');
    }

    // O VK pode devolver rótulos de anexos como se fossem o texto do comentário.
    function rxNtOwnMediaLabelFromText(value) {
        const label = String(value || '').trim().toLocaleLowerCase('ru');
        if (label === 'видео') return 'Comentário com vídeo';
        if (label === 'стикер') return 'Comentário com sticker';
        return rxNtMediaLabelPt(value);
    }

    // Identifica os tipos de mídia retornados pelo board.getComments do VK.
    function rxNtOwnAttachmentLabel(comment) {
        const attachments = Array.isArray(comment && comment.attachments) ? comment.attachments : [];
        const counts = { gif: 0, imagem: 0, vídeo: 0, sticker: 0 };
        attachments.forEach(a => {
            if (!a || typeof a !== 'object') return;
            const type = String(a.type || '').toLowerCase();
            const item = a[type] && typeof a[type] === 'object' ? a[type] : a;
            const ext = String(item.ext || item.extension || '').toLowerCase();
            const title = String(item.title || item.name || '').toLowerCase();
            if (type === 'sticker' || item.sticker_id != null || item.sticker && typeof item.sticker === 'object') counts.sticker++;
            else if (type === 'video') counts['vídeo']++;
            else if (type === 'photo' || type === 'graffiti' || type === 'market_photo' || /\.(png|jpe?g|webp|bmp)$/i.test(title)) counts.imagem++;
            else if ((type === 'doc' && (ext === 'gif' || /\.gif$/i.test(title))) || ext === 'gif' || /\.gif$/i.test(title)) counts.gif++;
            else if (type === 'doc' && /\.(png|jpe?g|webp|bmp)$/i.test(ext)) counts.imagem++;
        });
        const parts = [];
        if (counts.gif) parts.push(counts.gif === 1 ? 'GIF' : counts.gif + ' GIFs');
        if (counts.imagem) parts.push(counts.imagem === 1 ? 'imagem' : counts.imagem + ' imagens');
        if (counts['vídeo']) parts.push(counts['vídeo'] === 1 ? 'vídeo' : counts['vídeo'] + ' vídeos');
        if (counts.sticker) parts.push(counts.sticker === 1 ? 'sticker' : counts.sticker + ' stickers');
        return parts.length ? 'Comentário com ' + parts.join(', ') : 'Comentário sem texto';
    }

    function rxNtOwnCommentText(row) {
        const key = String(row.topic) + ':' + String(row.comment_id);
        if (rxNtOwnComments.has(key)) return Promise.resolve(rxNtOwnFormatPreview(rxNtOwnComments.get(key)));
        if (rxNtOwnCommentPending.has(key)) return rxNtOwnCommentPending.get(key);
        if (Date.now() < (rxNtOwnCommentRetry.get(key) || 0)) return Promise.resolve('Comentário indisponível no momento');
        const pending = (async () => {
            let value = 'Comentário indisponível no momento', found = false, timer = 0;
            try {
                const comment = await Promise.race([
                    rxNtOwnFetchComment(row.topic, row.comment_id),
                    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('tempo esgotado ao buscar comentário')), 15000); })
                ]);
                const commentText = rxNtOwnFormatPreview(String(comment.text || comment.message || '').trim());
                const mediaLabel = rxNtOwnMediaLabelFromText(commentText);
                if (mediaLabel) {
                    value = mediaLabel;
                    rxNtOwnMediaOnly.add(key);
                } else if (commentText) {
                    value = commentText;
                    rxNtOwnMediaOnly.delete(key);
                } else {
                    value = rxNtOwnAttachmentLabel(comment);
                    rxNtOwnMediaOnly.add(key);
                }
                found = true;
            } catch (e) {
                rxLog('Não foi possível carregar o comentário ' + row.comment_id + ':', e && e.message);
            } finally {
                if (timer) clearTimeout(timer);
            }
            if (found) {
                rxNtOwnComments.set(key, value);
                rxNtOwnCommentRetry.delete(key);
                if (rxNtOwnComments.size > 500) {
                    const oldest = rxNtOwnComments.keys().next().value;
                    rxNtOwnComments.delete(oldest);
                    rxNtOwnMediaOnly.delete(oldest);
                }
                LS.setJson(RX_NT_OWN_COMMENT_KEY, [...rxNtOwnComments].map(([k, v]) => [k, v, rxNtOwnMediaOnly.has(k)]).slice(-500));
            } else {
                // Falhas e resultados vazios são temporários: não gravar no cache definitivo.
                rxNtOwnCommentRetry.set(key, Date.now() + 60000);
            }
            return value;
        })();
        rxNtOwnCommentPending.set(key, pending);
        pending.finally(() => rxNtOwnCommentPending.delete(key));
        return pending;
    }

    // Ordena blocos completos da lista, mesmo quando o item está aninhado em um wrapper.
    // O horário próprio vem do timestamp D1; o nativo é interpretado do rótulo do VK.
    function rxNtOwnSort(host) {
        if (!host || !host.isConnected) return;
        const timestampOf = item => {
            const ownTime = Number(item.getAttribute('data-ar-nt-own-time'));
            if (item.hasAttribute('data-ar-nt-own') && Number.isFinite(ownTime) && ownTime > 0) return ownTime;

            // O VK inclui o timestamp Unix exato no final do data-testid:
            // notification-item-s25_0_1794605741
            const testid = item.getAttribute('data-testid') || '';
            const idMatch = testid.match(/^notification-item-[a-z0-9]+_\d+_(\d+)$/i);
            if (idMatch) {
                const seconds = Number(idMatch[1]);
                if (Number.isSafeInteger(seconds) && seconds > 0) return seconds * 1000;
            }

            const timeEl = item.querySelector('[data-testid="notification-time"]');
            if (!timeEl) return NaN;
            const exact = timeEl.getAttribute('datetime') || timeEl.getAttribute('title');
            if (exact) {
                const parsed = Date.parse(exact);
                if (Number.isFinite(parsed)) return parsed;
            }

            // Fallback apenas para formatos sem timestamp no identificador.
            const label = (timeEl.textContent || '').trim().toLocaleLowerCase('pt-BR');
            const now = Date.now();
            if (!label) return NaN;
            if (/^(agora|agora mesmo|há poucos segundos|menos de um minuto)/.test(label)) return now;
            if (/\bontem\b/.test(label)) return now - 86400000;
            const match = label.match(/(?:há\s*)?(\d+)\s*(semanas?|m[eê]ses?|anos?|segundos?|seg|minutos?|min|horas?|h|dias?|d|s)(?:\s+atr[aá]s)?/i);
            if (!match) return NaN;
            const amount = Number(match[1]), unit = match[2].toLowerCase();
            const factors = {
                s: 1000, seg: 1000, segundo: 1000, segundos: 1000,
                min: 60000, minuto: 60000, minutos: 60000,
                h: 3600000, hora: 3600000, horas: 3600000,
                d: 86400000, dia: 86400000, dias: 86400000,
                semana: 604800000, semanas: 604800000,
                mês: 2592000000, meses: 2592000000,
                ano: 31536000000, anos: 31536000000
            };
            return factors[unit] ? now - amount * factors[unit] : NaN;
        };
        const blocks = [...host.children].map((block, index) => {
            const items = [...block.querySelectorAll('[data-testid^="notification-item-"]')];
            if (block.matches && block.matches('[data-testid^="notification-item-"]')) items.unshift(block);
            const times = items.map(timestampOf).filter(Number.isFinite);
            return { block, index, time: times.length ? Math.max(...times) : NaN, valid: items.length > 0 };
        }).filter(entry => entry.valid);
        if (blocks.length < 2) return;
        const ordered = blocks.slice().sort((a, b) => {
            const av = Number.isFinite(a.time), bv = Number.isFinite(b.time);
            if (av && bv) return (b.time - a.time) || (a.index - b.index);
            if (av !== bv) return av ? -1 : 1;
            return a.index - b.index;
        });
        if (ordered.every((entry, i) => entry.block === blocks[i].block)) return;
        const marker = document.createComment('salvavk-notification-order');
        host.insertBefore(marker, blocks[0].block);
        const fragment = document.createDocumentFragment();
        ordered.forEach(entry => fragment.appendChild(entry.block));
        host.insertBefore(fragment, marker);
        marker.remove();
    }

    function rxNtOwnRender(host, template, rows) {
        const grouped = new Map(), wanted = new Set(), previews = [];
        rows.forEach(r => {
            const uid = Number(r.user_id), cid = Number(r.comment_id), rid = String(r.emoji);
            const reaction = RX_BY_ID[rid];
            if (!reaction || !reaction.noLike || !Number.isSafeInteger(uid) || !Number.isSafeInteger(cid)) return;
            const key = [r.topic, cid, rid].join('-');
            let group = grouped.get(key);
            if (!group) {
                group = { key, topic: r.topic, comment_id: cid, emoji: rid, reaction, rows: [], time: 0 };
                grouped.set(key, group);
            }
            group.rows.push(r);
            const t = Date.parse(r.t || '');
            if (Number.isFinite(t) && t > group.time) group.time = t;
        });

        grouped.forEach(group => {
            const key = group.key;
            wanted.add(key);
            const testid = RX_NT_OWN_PREFIX + key.replace(/[^a-zA-Z0-9_-]/g, '_');
            let item = [...host.querySelectorAll('[data-ar-nt-own]')]
                .find(n => n.getAttribute('data-ar-nt-own') === key);
            if (!item) {
                item = template.cloneNode(true);
                item.setAttribute('data-ar-nt-own', key);
                item.setAttribute('data-testid', testid);
                const oldLink = item.querySelector('a[href*="post="]');
                if (!oldLink) return;
                oldLink.href = 'https://vk.ru/topic-' + group.topic + '?post=' + group.comment_id;
                oldLink.setAttribute('data-ar-nt-own-link', '1');
                const menu = item.querySelector('[data-testid="notification-menu"]');
                if (menu) {
                    // Reproduz os três pontos nativos como indicador visual, sem ação de botão.
                    const source = document.createElement('span');
                    source.className = menu.className || '';
                    source.style.cssText = menu.style.cssText || '';
                    const dots = menu.querySelector('svg');
                    if (dots) source.appendChild(dots.cloneNode(true));
                    source.setAttribute('role', 'img');
                    source.setAttribute('aria-label', 'Notificação gerada pelo script (reações negativas não contam como curtida no VK)');
                    source.setAttribute('title', 'Notificação gerada pelo script (reações negativas não contam como curtida no VK)');
                    source.setAttribute('data-ar-nt-own-source', '1');
                    source.style.cssText += ';display:inline-flex;align-items:center;justify-content:center;flex:none;pointer-events:auto;cursor:help;';
                    menu.replaceWith(source);
                }
                item.querySelectorAll('[data-ar-nt-list], .ar-nt-bd').forEach(n => n.remove());
                item.querySelectorAll('[data-ar-nt-hide]').forEach(n => n.removeAttribute('data-ar-nt-hide'));

                // Um único aviso por comentário + emoji, em grupo irmão dos grupos nativos.
                const wrapper = document.createElement('div');
                wrapper.setAttribute('data-ar-nt-own-group', key);
                wrapper.appendChild(item);
                let templateGroup = template;
                while (templateGroup.parentElement && templateGroup.parentElement !== host) {
                    templateGroup = templateGroup.parentElement;
                }
                host.insertBefore(wrapper, templateGroup);
            }

            const actors = group.rows
                .slice()
                .sort((a, b) => Date.parse(b.t || 0) - Date.parse(a.t || 0))
                .map(r => ({ row: r, user: rxUserOf(Number(r.user_id)) }));
            const names = actors.map(a => a.user.name);
            const header = item.querySelector('[data-testid="notification-header"]');
            if (header) {
                const latestName = (names[0] || 'Usuário').trim();
                const latestFirstName = latestName.split(/\s+/)[0];
                header.textContent = names.length <= 1 ? latestName :
                    latestFirstName + ' e mais ' + (names.length - 1);
            }

            const time = item.querySelector('[data-testid="notification-time"]');
            if (time) time.textContent = rxNtOwnTime(group.rows.reduce((latest, r) =>
                Date.parse(r.t || 0) > Date.parse(latest.t || 0) ? r : latest, group.rows[0]).t);
            item.setAttribute('data-ar-nt-own-time', String(group.time || 0));

            const body = item.querySelector('[data-testid="notification-text"]');
            if (body) {
                body.style.fontWeight = '400';
                body.removeAttribute('data-ar-nt-hide');
                body.textContent = '';
                rxNtAppendPhrase(body, group.reaction, names.length > 1);
            }

            const commentLink = item.querySelector('a[data-ar-nt-own-link]');
            if (commentLink) commentLink.href = 'https://vk.ru/topic-' + group.topic + '?post=' + group.comment_id;

            // Reutiliza a caixa nativa de prévia do comentário: uma busca por agrupamento.
            const preview = item.querySelector('[style*="textclamp-lines"]');
            if (preview) {
                const commentKey = String(group.topic) + ':' + String(group.comment_id);
                preview.textContent = rxNtOwnFormatPreview(rxNtOwnComments.get(commentKey) || 'Carregando comentário…');
                // Comentários apenas com mídia ficam na cor secundária; texto escrito acompanha a reação.
                if (rxNtOwnMediaOnly.has(commentKey)) {
                    preview.style.color = 'var(--vkui--color_text_secondary, rgb(129, 140, 153))';
                } else {
                    const reactionText = item.querySelector('[data-testid="notification-text"]');
                    if (reactionText) preview.style.color = getComputedStyle(reactionText).color;
                }
                previews.push({ row: group.rows[0], item, preview, commentKey });
            }

            // Com uma pessoa, preserva exatamente o avatar nativo do template.
            // A pilha com posicionamento absoluto só é aplicada quando há mais de um ator.
            let avatar = item.querySelector('a[data-testid="notification-avatar"]');
            const avatarHost = avatar && avatar.parentElement;
            if (avatar && avatarHost && actors.length) {
                avatarHost.setAttribute('data-ar-nt-host', '1');
    avatarHost.querySelectorAll(':scope > .ar-nt-bd').forEach(n => { if (n.getAttribute('data-sig') !== key + '-' + group.emoji) n.remove(); });
                
                if (actors.length === 1) {
                    // Desfaz qualquer estilo de empilhamento de uma renderização anterior.
                    const candidates = [...avatarHost.querySelectorAll('a[data-testid="notification-avatar"], a[data-ar-nt-own-avatar]')];
                    avatar = candidates[0] || avatar;
                    candidates.slice(1).forEach(n => n.remove());
                    avatar.removeAttribute('data-ar-nt-own-avatar');
                    avatar.setAttribute('data-testid', 'notification-avatar');
                    ['position', 'left', 'top', 'z-index', 'border-radius', 'overflow', 'box-sizing', 'border']
                        .forEach(prop => avatar.style.removeProperty(prop));
                    ['position', 'width', 'height', 'flex'].forEach(prop => avatarHost.style.removeProperty(prop));
                    const actor = actors[0];
                    avatar.href = actor.user.href;
                    const img = avatar.querySelector('img');
                    if (img) {
                        img.alt = actor.user.name;
                        if (actor.user.photo) img.src = actor.user.photo;
                        else img.removeAttribute('src');
                    }
                } else {
                    // Replica a estrutura nativa VK AvatarStack (notification-additional-avatar).
                    // O VK controla a sobreposição pelo componente e suas classes, não por anchors absolutos.
                    const sourceAvatar = avatar.cloneNode(true);
                    avatarHost.querySelectorAll('a[data-testid="notification-avatar"], a[data-ar-nt-own-avatar]')
                        .forEach(n => n.remove());

                    const stack = document.createElement('div');
                    stack.className = 'vkit-sCIJBQ vkit-X4aorD vkit-uQqhAT vkuiInternalTappable GQPZ8m _0kJL6j _6iiopx KZD2Fo ZjZOwx';
                    stack.style.setProperty('--vkui_internal--avatarstack_size', '48px');
                    stack.style.setProperty('--vkui_internal--avatarstack_avatar_size', '36px');
                    stack.style.width = '48px';
                    stack.style.height = '48px';
                    stack.setAttribute('data-testid', 'notification-additional-avatar');

                    const shown = actors.slice(0, 2);
                    shown.forEach(actor => {
                        const face = document.createElement('div');
                        face.className = 'meXqZJ JXVtku SEJNrr KZD2Fo ZjZOwx';
                        face.style.width = '36px';
                        face.style.height = '36px';

                        const img = sourceAvatar.querySelector('img');
                        if (img) {
                            const picture = img.cloneNode(false);
                            picture.alt = actor.user.name;
                            picture.width = 36;
                            picture.height = 36;
                            if (actor.user.photo) picture.src = actor.user.photo;
                            else picture.removeAttribute('src');
                            face.appendChild(picture);
                        }

                        const decoration = sourceAvatar.querySelector('[aria-hidden="true"].xwZAqX');
                        if (decoration) face.appendChild(decoration.cloneNode(true));
                        stack.appendChild(face);
                    });
                    avatarHost.appendChild(stack);
                }

                if (!avatarHost.querySelector(':scope > .ar-nt-bd')) avatarHost.appendChild(rxNtBadgeEl(group.reaction, key + '-' + group.emoji));
            }
        });

        // Remove grupos que deixaram de ter reação negativa válida.
        [...host.querySelectorAll('[data-ar-nt-own-group]')].forEach(wrapper => {
            const key = wrapper.getAttribute('data-ar-nt-own-group');
            if (!wanted.has(key)) wrapper.remove();
        });

        // Ordena imediatamente após atualizar os itens próprios.
        rxNtOwnSort(host);

        // Busca uma única prévia por agrupamento; no máximo quatro chamadas VK simultâneas.
        let next = 0;
        const workers = Array.from({ length: Math.min(4, previews.length) }, async () => {
            while (next < previews.length) {
                const p = previews[next++];
                const value = await rxNtOwnCommentText(p.row);
                if (p.item.isConnected && p.preview.isConnected &&
                    p.item.getAttribute('data-ar-nt-own') === [p.row.topic, p.row.comment_id, p.row.emoji].join('-')) {
                    p.preview.textContent = value;
                }
            }
        });
        Promise.all(workers).catch(() => {});
    }

    async function rxNtOwnTick() {
        if (rxNtOwnBusy) return;
        rxNtOwnBusy = true;
        try {
            if (meId == null || !meFresh) {
                await learnMeApi();
                if (meId == null || !meFresh) return;
            }

            // Atualiza a lista preparada mesmo com o painel fechado.
            if (!rxNtOwnAt || Date.now() - rxNtOwnAt >= RX_NT_OWN_PREPARE_MS) {
                const rows = [];
                rxNtMirror.forEach((e, key) => {
                    if (Number(e.o) !== Number(meId)) return;
                    const cut = key.lastIndexOf(':');
                    if (cut < 1) return;
                    e.m.forEach((rid, uid) => {
                        if (Number(uid) === Number(meId)) return;
                        const reaction = RX_BY_ID[String(rid)];
                        if (!reaction || !reaction.noLike) return;
                        rows.push({
                            topic: key.slice(0, cut), comment_id: Number(key.slice(cut + 1)),
                            user_id: Number(uid), emoji: String(rid), t: e.t.get(Number(uid)) || ''
                        });
                    });
                });
                rows.sort((a, b) => Date.parse(b.t || 0) - Date.parse(a.t || 0));
                rows.length = Math.min(rows.length, 100);
                rxNtOwnRows = rows;
                rxNtOwnAt = Date.now();

                const users = [...new Set(rows.map(r => Number(r.user_id)).filter(Number.isSafeInteger))];
                // Resolve os usuários em paralelo; não bloquear a inserção por consultas de perfil.
                rxResolve(users, true).then(() => {
                    rxNtOwnContainers().forEach(ready =>
                        rxNtOwnRender(ready.host, ready.item, rxNtOwnRows)
                    );
                }).catch(() => {});
            }

            // A inserção visual nunca espera pelas consultas dos comentários.
            const fresh = rxNtOwnContainers();
            // O VK pode reordenar a lista ao atualizar; reaplicamos a ordem em cada ciclo.
            fresh.forEach(target => rxNtOwnSort(target.host));
            if (fresh.length && Date.now() - rxNtOwnRenderedAt >= 1200) {
                fresh.forEach(target => rxNtOwnRender(target.host, target.item, rxNtOwnRows));
                rxNtOwnRenderedAt = Date.now();
            }
        } catch (e) {
            rxLog('Notificações negativas próprias: erro:', e && e.message);
        } finally {
            rxNtOwnBusy = false;
        }
    }

    // Descoberta: o que o espelho ainda não resolveu. Leitura em lote (uma consulta por tópico) e nomes dos usuários numa chamada só.
    async function rxNtListTick() {
        const need = new Map(), users = new Set();
        document.querySelectorAll('[data-testid="notification-text"]').forEach(t => {
            try {
                if (!RX_NT_LIKE_RE.test(t.textContent || '')) return;
                const info = rxNtListInfo(t);
                if (!info) return;
                const ids = info.ids;
                if (!ids.key || ids.cid == null || !ids.ident.length) return;
                const s = rxNtState(info);
                if (s && s.final) return;
                const ent = rxNtMirror.get(ids.key + ':' + ids.cid);
                if (ent && ent.ft) { ent.m.forEach((_, u) => { if (!rxUsers.has(u)) users.add(u); }); return; }   // lido por inteiro; falta só o nome de quem reagiu
                let st = rxNtDone.get(info.sig);
                if (!st) { st = { tries: 0, next: 0, busy: false }; rxNtDone.set(info.sig, st); }
                if (st.busy || Date.now() < st.next) return;
                let m = need.get(ids.key);
                if (!m) { m = new Map(); need.set(ids.key, m); }
                let arr = m.get(ids.cid);
                if (!arr) { arr = []; m.set(ids.cid, arr); }
                if (!arr.includes(st)) arr.push(st);
            } catch (e) {}
        });
        await Promise.all([...need].map(async ([key, m]) => {
            const sts = [].concat(...m.values());
            sts.forEach(st => { st.busy = true; });
            try {
                await rxNtBatch(key, [...m.keys()]);
                const us = [];
                m.forEach((_, cid) => { const e = rxNtMirror.get(key + ':' + cid); if (e) e.m.forEach((__, u) => us.push(u)); });
                await rxNtEnsureUsers(us);
            } catch (e) { rxLog('Notificação (janela): erro no lote:', e && e.message); }
            finally { sts.forEach(st => { st.busy = false; rxRetry(st, RX_NT_LIST_RETRY_MS, 120000); }); }
        }));
        if (users.size) { try { await rxNtEnsureUsers([...users]); } catch (e) { rxLog('Notificação (janela): erro ao buscar nomes:', e && e.message); } }
        if (need.size || users.size) rxNtSched();
    }

    let rxNtBusy = false;
    async function rxNtTick() {
        if (rxNtBusy) return;
        rxNtBusy = true;
        try {
            const listOpen = !!document.querySelector('[data-testid="notification-text"]');
            const mirrorEvery = listOpen ? RX_NT_MIRROR_LIST_MS : (rxIdle() ? RX_NT_MIRROR_IDLE_MS : RX_NT_MIRROR_EVERY_MS);
            if (!document.hidden && RX_NT_MIRROR_EVERY_MS && Date.now() - rxNtMirrorAt >= mirrorEvery) await rxNtMirrorRefresh();
            const pops = [...document.querySelectorAll('.notifier_baloon[class*="notifier_type_like_topic_comment"]')];
            await Promise.all(pops.map(p => rxNtPopup(p).catch(() => {})));
            if (listOpen) await rxNtListTick();
            await rxNtOwnTick();
        } finally {
            rxNtBusy = false;
        }
    }



        // A troca de sessão invalida a identidade anterior e confirma a nova conta nesta aba.
        api.vk.onSessionChange(() => {
            meId = null; meFresh = false; meTries = 0; meAt = 0;
            learnMeApi();
        });
        if (api.vk.getSessionInfo().ready) learnMeApi();
        const jobs = [[rxPoll, 300, 0], [rxNtTick, 500, 0], [rxSync, 700, 0]];
        setInterval(() => {
            const now = Date.now();
            jobs.forEach(j => { if (now - j[2] >= j[1]) { j[2] = now; safe(j[0]); } });
        }, 100);
        rxLog('Módulo de reações iniciado (v1.0.0).');
    }
});
