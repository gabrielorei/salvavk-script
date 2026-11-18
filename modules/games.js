// Salva VK — módulo de jogos e transmissões
// Extraído do núcleo v6.33; usa somente a API pública SalvaVK v1.
let renderTimer = null;
let hostsTimer = null;

SalvaVK.modules.register({
    id: 'games',
    version: '1.0.0',
    apiVersion: 1,
    start(api) {
        const legacyStorage = api.storage;
        const LS = api.storage.forModule('games');
        const mk = api.ui.mk;
        const DEBUG = true;
        const log = (...a) => DEBUG && console.log('[Salva VK · Jogos]', ...a);
        const esc = s => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        // Migra os caches locais existentes para o espaço isolado deste módulo.
        for (const key of ['vk_ar_rdc_state']) {
            if (LS.get(key) == null) {
                const oldValue = legacyStorage.get(key);
                if (oldValue != null) LS.set(key, oldValue);
            }
        }
        for (const key of ['vk_ar_rdc_cache', 'vk_ar_yt_channels']) {
            if (LS.json(key, null) == null) {
                const oldValue = legacyStorage.json(key, null);
                if (oldValue != null) LS.setJson(key, oldValue);
            }
        }

    // INTEGRAÇÃO: BOLA ROLANDO (FUTEBOL AO VIVO E PRÓXIMOS JOGOS)
    // ===== ENDEREÇOS REMOTOS (trocar de domínio sem atualizar o script) =====
    // O JSON abaixo é baixado ao iniciar e a cada 30 min; a última versão boa fica guardada. Se nada responder, valem os endereços embutidos.
    const CFG_URLS = [
        'https://raw.githubusercontent.com/gabrielorei/salvavk-config/main/salvavk-hosts.json',
        'https://cdn.jsdelivr.net/gh/gabrielorei/salvavk-config@main/salvavk-hosts.json'
    ];
    const CFG_KEY = 'vk_ar_hosts', CFG_REFRESH_MS = 30 * 60 * 1000;
    const HOSTS = {
        bola:      ['https://futebolgratis.org'],     // o site "Bola Rolando" mudou de endereço (antes: bolarolando.org)
        futnatv:   ['https://futnatv.net'],
        ppvApi:    ['https://api.ppv.st'],
        ppvSite:   ['https://ppv.st'],
        rdcApi:    ['https://api.reidoscanais.im', 'https://api.reidoscanais.my', 'https://api.reidoscanais.cam'],   // tenta na ordem
        rdcSite:   ['https://reidoscanais.im/'],
        rdcAgenda: ['https://reidoscanais.im/agenda']
    };
    const HOSTS_DEFAULT = JSON.parse(JSON.stringify(HOSTS));

    function cleanHosts(v) {   // só https, sem usuário/senha, sem "/" no fim
        return (Array.isArray(v) ? v : [v]).map(u => {
            try {
                const x = new URL(String(u));
                if (x.protocol !== 'https:' || x.username || x.password) return null;
                return x.origin + x.pathname.replace(/\/+$/, '');
            } catch (e) { return null; }
        }).filter(Boolean);
    }
    function applyHosts(cfg) {
        if (!cfg || typeof cfg !== 'object') return;
        for (const k of Object.keys(HOSTS_DEFAULT)) {
            const l = cleanHosts(cfg[k]);
            if (l.length) HOSTS[k] = l;
        }
        try {   // links já desenhados (rodapé do painel)
            document.querySelectorAll('[data-host]').forEach(a => {
                const l = HOSTS[a.dataset.host];
                if (l && l[0]) a.href = l[0] + (a.dataset.path || '');
            });
        } catch (e) { /* ignora */ }
    }
    try { applyHosts(LS.json(CFG_KEY, null)); } catch (e) { /* ignora */ }

    async function refreshHosts() {
        for (const u of CFG_URLS) {
            try {
                const cfg = JSON.parse(await rdcGetText(u + '?_=' + Math.floor(Date.now() / 300000)));
                applyHosts(cfg);
                try { LS.setJson(CFG_KEY, cfg); } catch (e) { /* ignora */ }
                return;
            } catch (e) { log('Config de endereços indisponível:', u, e); }
        }
    }
    async function rdcGetFirst(key, path) {   // tenta cada endereço da lista até um responder
        let lastErr = new Error('sem endereço configurado: ' + key);
        for (const base of HOSTS[key]) {
            try { return await rdcGetText(base + path); } catch (e) { lastErr = e; }
        }
        throw lastErr;
    }

    let BOLA_ROLANDO_URL = HOSTS.bola[0] + '/';
    const RDC_STORAGE_KEY = 'vk_ar_rdc_state';

    // O painel de jogos deve estar disponível em qualquer página do VK.
    const isRdcAllowedPage = () => true;

    async function fetchBolaRolandoHTML() {
        let lastErr = new Error('sem endereço configurado: bola');
        for (const b of HOSTS.bola) {
            try {
                const html = await fetchBolaFrom(b + '/');
                BOLA_ROLANDO_URL = b + '/';   // os links relativos dos jogos são resolvidos a partir daqui
                return html;
            } catch (e) { lastErr = e; }
        }
        throw lastErr;
    }

    function fetchBolaFrom(base) {
        const url = base + '?_=' + Math.floor(Date.now() / 60000);
        return rdcGetText(url, { headers: { 'Cache-Control': 'no-cache' } });
    }

    // INTEGRAÇÃO: LIVES DO YOUTUBE (prioridade: CazéTV > GE TV > SportyNet > GOAT > Gol BR > CNN Esportes > Jovem Pan > Bola Rolando)
    const RDC_YT_LIVES = true;        // procura a transmissão no YouTube (canais abaixo) antes do Bola Rolando; false = só Bola Rolando
    const RDC_YT_CHANNELS = [         // a ordem da lista é a ordem de prioridade (todos aparecem no painel com "(Oficial)")
        { name: 'CazéTV',             handle: '@CazeTV',          id: 'UCZiYbVptd3PVPf4f6eR6UaQ', keys: ['caze'] },
        { name: 'GE TV',              handle: '@getv',            id: null, keys: ['getv', '=ge', 'globoesporte'] },
        { name: 'SportyNet',          handle: '@SportyNetBrasil', id: null, keys: ['sporty'] },
        { name: 'GOAT',               handle: '@canalgoatbr',     id: null, keys: ['goat'] },
        { name: 'Gol BR',             handle: '@canalgolbrasil',  id: null, keys: ['golbr'] },
        { name: 'CNN Sports',       handle: '@CNNEsportes',     id: null, keys: ['cnn'] },
        { name: 'JP Esportes', handle: '@jovempanesportes', id: null, keys: ['jovempan'] }
    ];
    const rdcChanLabel = ch => ch.name + ' (Oficial)';
    const RDC_YT_CACHE_MS = 3 * 60 * 1000; // reaproveita o resultado por esse tempo ao abrir/fechar o painel
    const RDC_YT_CH_KEY = 'vk_ar_yt_channels';
    let rdcYtCache = { at: 0, items: [], bolaErr: false, games: [], bola: [], feedCache: new Map(), endedCache: new Map() };
    let rdcRenderSeq = 0;   // evita que uma busca antiga sobrescreva a mais nova

    async function rdcGetText(url, options = {}) {
        const response = await api.network.request({
            method: 'GET', url,
            timeout: options.timeout || 20000,
            headers: options.headers || {}
        });
        return response.responseText;
    }

    async function rdcPool(list, n, fn) {
        let i = 0;
        await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
            while (i < list.length) { const x = list[i++]; await fn(x); }
        }));
    }

    // ---- comparação de jogos (mesmo confronto em fontes diferentes) ----
    const RDC_STOP = new Set(['fc', 'cf', 'sc', 'ac', 'as', 'cd', 'ca', 'club', 'clube', 'de', 'da', 'do', 'del', 'la', 'le', 'the', 'real', 'united', 'city', 'atletico', 'sporting', 'esporte', 'sport', 'futebol', 'vs', 'x']);
    const rdcNorm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    // apelidos que as fontes escrevem de outro jeito (usados só na comparação de jogos)
    const RDC_ALIASES = [
        [/\bpsg\b/g, 'paris saint germain'],
        [/\bwolves\b/g, 'wolverhampton'],
        [/\bspurs\b/g, 'tottenham'],
        [/\bman utd\b/g, 'manchester united'],
        [/\bman city\b/g, 'manchester city'],
        // clubes brasileiros que o futnatv escreve com a sigla do estado e outras fontes com o nome por extenso
        // (a palavra "atletico" é ignorada na comparação, então "Atlético-MG" virava só "mg" e não casava com "Mineiro")
        [/\bathletico\b/g, 'atletico'],
        [/\batletico mg\b/g, 'atletico mineiro'],
        [/\batletico go\b/g, 'atletico goianiense'],
        [/\batletico pr\b/g, 'atletico paranaense'],
        [/\bamerica mg\b/g, 'america mineiro']
    ];
    const rdcTokens = s => {
        let n = rdcNorm(s);
        RDC_ALIASES.forEach(([re, to]) => { n = n.replace(re, to); });
        const all = n.split(' ').filter(w => w.length >= 2);
        const f = all.filter(w => !RDC_STOP.has(w));
        return f.length ? f : all;
    };

    // "AO VIVO: A X B | COMPETIÇÃO | RODADA" ou "Competição: A x B"  ->  { teams: [A, B], sub: 'COMPETIÇÃO · RODADA' }
    function rdcParseTitle(title) {
        let s = String(title || '').replace(/^\s*[^\p{L}\p{N}]*AO\s+VIVO\s*[:\-–|]?\s*/iu, '');
        const segs = s.split('|').map(x => x.trim()).filter(Boolean);
        for (let i = 0; i < segs.length; i++) {
            let seg = segs[i];
            const colon = seg.indexOf(':');
            if (colon > -1 && colon < 30) seg = seg.slice(colon + 1).trim();
            const m = seg.match(/^(.+?)\s+(?:x|vs\.?|v)\s+(.+)$/i);
            if (m) return { teams: [m[1].trim(), m[2].trim()], sub: segs.filter((_, j) => j !== i).join(' · '), line: seg };
        }
        return null;
    }

    function rdcSameSide(a, b) {
        const ta = rdcTokens(a), tb = rdcTokens(b);
        if (ta.some(w => tb.includes(w))) return true;
        // um nome é o começo do outro (Inter / Internazionale), com pelo menos 5 letras
        if (ta.some(x => tb.some(y => Math.min(x.length, y.length) >= 5 && (x.startsWith(y) || y.startsWith(x))))) return true;
        const ca = rdcNorm(a).replace(/ /g, ''), cb = rdcNorm(b).replace(/ /g, '');
        return ca.length >= 4 && cb.length >= 4 && (ca.includes(cb) || cb.includes(ca));
    }

    function rdcSameGame(x, y) {
        const px = rdcParseTitle(x.title), py = rdcParseTitle(y.title);
        if (!px || !py) return false;
        const [a0, a1] = px.teams, [b0, b1] = py.teams;
        const teamsOk = (rdcSameSide(a0, b0) && rdcSameSide(a1, b1)) || (rdcSameSide(a0, b1) && rdcSameSide(a1, b0));
        if (!teamsOk) return false;
        if (Number.isFinite(x.startMs) && Number.isFinite(y.startMs)) return Math.abs(x.startMs - y.startMs) <= 4 * 3600 * 1000;
        return true;
    }

    // Casamento entre fontes: prioriza os dois times; como reserva, aceita um time
    // reconhecível quando o horário é praticamente igual (nomes abreviados/alternativos).
    const RDC_KICKOFF_TOL_MS = 30 * 60 * 1000;
    const RDC_GAME_MATCH_MAX_MS = 4 * 3600 * 1000;
    function rdcBestMatch(want, list, pick) {
        const pw = rdcParseTitle(want.title);
        if (!pw) return null;
        let best = null, bestScore = 0, bestDelta = Infinity;
        list.forEach(x => {
            const y = pick(x);
            if (!y || !Number.isFinite(y.startMs) || !Number.isFinite(want.startMs)) return;
            const delta = Math.abs(want.startMs - y.startMs);
            if (delta > RDC_GAME_MATCH_MAX_MS) return;
            const py = rdcParseTitle(y.title);
            if (!py) return;
            const [a0, a1] = pw.teams, [b0, b1] = py.teams;
            const direct = (rdcSameSide(a0, b0) ? 1 : 0) + (rdcSameSide(a1, b1) ? 1 : 0);
            const reverse = (rdcSameSide(a0, b1) ? 1 : 0) + (rdcSameSide(a1, b0) ? 1 : 0);
            const score = Math.max(direct, reverse);
            // Dois times reconhecidos: tolerância de até 4h. Um só: exige horário até 30 min.
            if (score < 2 && (score < 1 || delta > RDC_KICKOFF_TOL_MS)) return;
            if (score > bestScore || (score === bestScore && delta < bestDelta)) {
                best = x; bestScore = score; bestDelta = delta;
            }
        });
        if (best) log('Jogo casado:', want.title, '=', pick(best).title, 'pontuação:', bestScore, 'diferença (min):', Math.round(bestDelta / 60000));
        return best;
    }

    // ---- YouTube ----
    async function rdcYtChannelId(ch) {
        if (ch.id) return ch.id;
        const saved = LS.json(RDC_YT_CH_KEY, {});
        if (saved[ch.handle]) return saved[ch.handle];
        const html = await rdcGetText('https://www.youtube.com/' + ch.handle);
        const m = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)
        || html.match(/"externalId":"(UC[\w-]{22})"/)
        || html.match(/"channelId":"(UC[\w-]{22})"/);
        if (!m) throw new Error('canal não encontrado: ' + ch.handle);
        saved[ch.handle] = m[1];
        LS.setJson(RDC_YT_CH_KEY, saved);
        return m[1];
    }

    async function rdcYtFeed(ch) {
        const cid = await rdcYtChannelId(ch);
        const xml = await rdcGetText('https://www.youtube.com/feeds/videos.xml?channel_id=' + cid);
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        return Array.from(doc.getElementsByTagName('entry')).map(e => {
            const rawId = (e.getElementsByTagName('id')[0] || {}).textContent || '';
            const t = e.getElementsByTagName('title')[0];
            return { id: rawId.replace(/^yt:video:/, '').trim(), title: t ? t.textContent.trim() : '' };
        }).filter(e => e.id && e.title);
    }

    async function rdcYtStatus(videoId) {
        const t = await rdcGetText('https://www.youtube.com/watch?v=' + videoId);
        const g = re => (t.match(re) || [])[1];
        const toMs = s => !s ? NaN : (/^\d+$/.test(s) ? Number(s) * 1000 : Date.parse(s));
        const end = g(/"endTimestamp":"([^"]+)"/);
        return {
            live: g(/"isLiveNow":(true|false)/) === 'true',
            ended: !!end,
            startMs: toMs(g(/"startTimestamp":"([^"]+)"/)),
            schedMs: toMs(g(/"scheduledStartTime":"([^"]+)"/))
        };
    }

    const rdcHHMM = ms => {
        const d = new Date(ms), now = new Date();
        const hm = String(d.getHours()).padStart(2, '0') + 'H' + String(d.getMinutes()).padStart(2, '0');
        return d.toDateString() === now.toDateString() ? hm : String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + hm;
    };

    // ---- FUTNATV (única lista de jogos do painel; as transmissões são buscadas para cada jogo dela) ----
    // página de hoje do futnatv: endereço em HOSTS.futnatv (os dados dos jogos vêm dentro do próprio HTML)

    // "agora" em Brasília (UTC-3, sem horário de verão), lido com os métodos getUTC*
    const rdcBrt = () => new Date(Date.now() - 3 * 3600e3);

    // posição do canal na prioridade (0 = melhor); canal que não está na lista fica depois de todos, mas antes do Bola Rolando
    const rdcChanRank = name => {
        const n = rdcNorm(name).replace(/ /g, '');
        if (!n) return RDC_YT_CHANNELS.length;
        const i = RDC_YT_CHANNELS.findIndex(c => c.keys.some(k => k.startsWith('=') ? n === k.slice(1) : n.includes(k)));
        return i < 0 ? RDC_YT_CHANNELS.length : i;
    };

    // pega cada objeto de jogo e herda a data do grupo "key" -> "games" da FutNaTV
    function rdcExtractGames(html) {
        const games = [], re = /"home"\s*:\s*"/g;
        let m;
        while ((m = re.exec(html))) {
            const k = m.index;
            const i = html.lastIndexOf('{', k);
            if (i < 0) continue;
            let depth = 0, inStr = false, esc = false, j = i;
            for (; j < html.length; j++) {
                const c = html[j];
                if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
                if (c === '"') inStr = true;
                else if (c === '{') depth++;
                else if (c === '}') { depth--; if (depth === 0) break; }
            }
            if (depth !== 0 || j < k) continue;
            try {
                const o = JSON.parse(html.slice(i, j + 1));
                if (o && o.home) {
                    // A FutNaTV agrupa os jogos em objetos com "key":"AAAA-MM-DD" e "games":[...].
                    // Se o jogo não tiver dateKey próprio, herda a data do grupo.
                    const gamesPos = html.lastIndexOf('"games"', i);
                    if (!(typeof o.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.dateKey)) && gamesPos >= 0) {
                        const groupStart = html.lastIndexOf('{', gamesPos);
                        if (groupStart >= 0) {
                            const header = html.slice(groupStart, gamesPos);
                            const groupDate = header.match(/"key"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
                            if (groupDate) o.dateKey = groupDate[1];
                        }
                    }
                    games.push(o);
                }
            } catch (e) { /* ignora */ }
            re.lastIndex = Math.max(re.lastIndex, j + 1);
        }
        return games;
    }
    // "21h00" (Brasília, hoje) -> milissegundos
    function rdcFutnatStart(timeStr) {
        const m = String(timeStr || '').match(/(\d{1,2})\s*[hH:]\s*(\d{2})?/);
        if (!m) return NaN;
        const b = rdcBrt();
        return Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), Number(m[1]) + 3, Number(m[2] || 0));
    }

    // false só quando o YouTube diz claramente que o vídeo não existe ou é privado; na dúvida (ou falha de rede) mantém o link
    async function rdcYtUsable(url) {
        const m = String(url).match(/[?&]v=([\w-]{11})/) || String(url).match(/youtu\.be\/([\w-]{11})/);
        if (!m) return true;
        try {
            const t = await rdcGetText('https://www.youtube.com/watch?v=' + m[1]);
            const status = (t.match(/"playabilityStatus":\{"status":"([^"]+)"/) || [])[1];
            const reason = (t.match(/"playabilityStatus":\{[^}]*?"reason":"([^"]+)"/) || [])[1] || '';
            if (status === 'ERROR') return false;
            if (status === 'LOGIN_REQUIRED' && /particular|privad|private/i.test(reason)) return false;
            return true;
        } catch (e) { return true; }
    }

    // procura a live do jogo no feed de um dos canais prioritários (quando o futnatv cita o canal mas não traz o link)
    async function rdcFeedLink(chName, game, feedCache, opts = {}) {
        const idx = rdcChanRank(chName);
        if (idx >= RDC_YT_CHANNELS.length) return null;
        if (!feedCache.has(idx)) feedCache.set(idx, rdcYtFeed(RDC_YT_CHANNELS[idx]).catch(() => []));
        const entries = await feedCache.get(idx);
        const want = { title: game.home + ' x ' + game.away, startMs: NaN };
        for (const e of entries) {
            if (!rdcParseTitle(e.title) || !rdcSameGame({ title: e.title, startMs: NaN }, want)) continue;
            const st = await rdcYtStatus(e.id).catch(() => null);
            if (!st) continue;
            if (st.ended && !st.live && !opts.allowEnded) continue;   // live encerrada só vale na busca (replay)
            if (opts.allowEnded && Number.isFinite(st.startMs) && Number.isFinite(opts.startMs) && Math.abs(st.startMs - opts.startMs) > 6 * 3600e3) continue;
            return 'https://www.youtube.com/watch?v=' + e.id;
        }
        return null;
    }

    const RDC_GAME_LIVE_MIN = 120;   // até quantos minutos após o início o jogo conta como "ao vivo" (vale para todos os jogos, qualquer que seja o link)
    const RDC_GAME_ENDING_MIN = 150; // de LIVE_MIN até aqui aparece como "encerrando ou encerrado" (cobre prorrogação/pênaltis); depois disso o jogo some

    // ---- cache salvo no navegador (localStorage) ----
    const RDC_CACHE_KEY = 'vk_ar_rdc_cache';
    const RDC_CACHE_MAX_AGE_MS = 6 * 3600 * 1000;   // cache salvo mais velho que isso é ignorado

    const rdcTodayKey = () => {
        const b = rdcBrt();
        return b.getUTCFullYear() + '-' + String(b.getUTCMonth() + 1).padStart(2, '0') + '-' + String(b.getUTCDate()).padStart(2, '0');
    };

    // situação do jogo pelo horário de início: 'soon' | 'live' | 'ending' | 'ended'
    function rdcGameKind(startMs, now = Date.now()) {
        if (!Number.isFinite(startMs)) return 'soon';
        const diff = (now - startMs) / 60000;
        if (diff > RDC_GAME_ENDING_MIN) return 'ended';
        if (diff >= -3) return diff <= RDC_GAME_LIVE_MIN ? 'live' : 'ending';
        return 'soon';
    }

    // acrescenta kind e statusText calculados com o relógio de agora (por isso o cache guarda só o horário de início)
    function rdcWithStatus(it) {
        const kind = rdcGameKind(it.startMs);
        const statusText = kind === 'live' ? 'AO VIVO'
        : (kind === 'ending' || kind === 'ended') ? 'ENCERRADO'
        : (Number.isFinite(it.startMs) ? rdcHHMM(it.startMs) : (it.timeLabel || ''));
        return { ...it, kind, statusText };
    }

    function rdcSaveCache(items, bolaErr) {
        try {
            LS.setJson(RDC_CACHE_KEY, {
                schema: 2, at: Date.now(), day: rdcTodayKey(), bolaErr: !!bolaErr,
                items: items.map(it => ({ startMs: Number.isFinite(it.startMs) ? it.startMs : null, src: it.src, link: it.link, title: it.title, sub: it.sub, timeLabel: it.timeLabel }))
            });
        } catch (e) { /* sem espaço ou bloqueado: segue sem cache salvo */ }
    }

    function rdcLoadCache() {
        try {
            const c = LS.json(RDC_CACHE_KEY);
            if (!c || c.schema !== 2 || !Array.isArray(c.items) || c.day !== rdcTodayKey() || Date.now() - c.at > RDC_CACHE_MAX_AGE_MS) return null;
            return { bolaErr: !!c.bolaErr, items: c.items.map(it => ({ ...it, startMs: it.startMs == null ? NaN : it.startMs })) };
        } catch (e) { return null; }
    }

    // lista de hoje do futnatv
    async function loadRdcFutnatGames() {
        const html = await rdcGetFirst('futnatv', '/');
        const b = rdcBrt();
        const p2 = n => String(n).padStart(2, '0');
        const todayKey = b.getUTCFullYear() + '-' + p2(b.getUTCMonth() + 1) + '-' + p2(b.getUTCDate());
        const seen = new Set(), games = [];
        const raw = rdcExtractGames(html);
        raw.forEach(g => {
            if (g.sport && g.sport !== 'futebol') return;
            if (!g.home || !g.time) return;
            if (typeof g.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g.dateKey) && g.dateKey !== todayKey) return;
            const key = g.time + '|' + g.home + '|' + g.away;
            if (seen.has(key)) return;
            seen.add(key);
            games.push(g);
        });
        if (!games.length) {
            const trecho = html.slice(0, 120).replace(/\s+/g, ' ');
            log('FutNaTV: página recebida sem jogos legíveis. Início:', html.slice(0, 400));
            throw new Error('não consegui ler a lista de jogos (página com ' + html.length + ' caracteres, ' + raw.length + ' jogos encontrados). Início: ' + trecho);
        }

        const out = [];
        games.forEach(g => {
            const startMs = rdcFutnatStart(g.time);
            out.push({ g, startMs, kind: rdcGameKind(startMs) });
        });
        return out;
    }

    // acha a transmissão de um jogo do futnatv: YouTube (pela prioridade dos canais) -> Bola Rolando -> nada (o jogo não aparece)
    async function resolveRdcGame(entry, feedCache, bolaItems) {
        const { g, startMs, kind } = entry;
        const title = g.home + (g.away ? ' x ' + g.away : '');
        let link = '', src = '';

        const chans = Array.from(String(g.broadcast || '').matchAll(/(?:YouTube|YT)\s*\(([^)]+)\)/gi)).map(m => m[1].trim());
        const url = /^https?:\/\//.test(String(g.youtubeUrl || '')) ? String(g.youtubeUrl).trim() : '';
        if (RDC_YT_LIVES && (chans.length || url)) {
            const first = chans[0] || '';

            // 1) feed do canal (só lista vídeos públicos): procura a live nos canais da lista, do mais prioritário para o menos
            const listed = chans.filter(c => rdcChanRank(c) < RDC_YT_CHANNELS.length).sort((a, b2) => rdcChanRank(a) - rdcChanRank(b2));
            for (const c of listed) {
                try {
                    const l = await rdcFeedLink(c, g, feedCache, { startMs, allowEnded: kind === 'ended' });
                    if (l) { link = l; src = c; break; }
                } catch (e) { log('futnatv: falha ao buscar no feed', c, e); }
            }

            // 2) reserva (vale para qualquer canal): link do futnatv, se o vídeo não estiver privado/indisponível
            if (!link && url && await rdcYtUsable(url)) { link = url; src = first || 'YouTube'; }

            if (link) {
                const r = rdcChanRank(src);
                if (r < RDC_YT_CHANNELS.length) src = rdcChanLabel(RDC_YT_CHANNELS[r]);
                else if (src !== 'YouTube') src = src + ' (Oficial)';
            }
        }

        if (!link) {   // sem YouTube (ou sem achar a live): tenta o Bola Rolando
            const bm = rdcBestMatch({ title, startMs }, bolaItems, x => ({ title: x.rawTitle, startMs: x.startMs }));
            if (bm) { link = bm.link; src = 'Futebol Grátis (🏴‍☠️)'; }
        }
        if (!link) return null;   // nenhuma transmissão: fica fora do painel

        return {
            kind, startMs, src, link, title,
            sub: [g.competition, g.round].filter(Boolean).join(' · '),
            timeLabel: String(g.time).toUpperCase()
        };
    }

    // ---- fontes extras de link: só para jogos do futnatv sem YouTube e sem Bola Rolando (a primeira da lista que tiver o jogo vence) ----
    const RDC_EXTRA_SOURCES = [
        {
            name: 'Link Gringo (🏴‍☠️)',
            load: async () => {
                const json = JSON.parse(await rdcGetFirst('ppvApi', '/api/streams'));
                const out = [];
                (json.streams || []).forEach(cat => {
                    if (!/^football$/i.test(cat.category)) return;
                    (cat.streams || []).forEach(s => {
                        if (s.always_live || !s.name || !s.uri_name || !s.starts_at) return;
                        out.push({ title: s.name, startMs: s.starts_at * 1000, link: HOSTS.ppvSite[0] + '/live/' + s.uri_name });
                    });
                });
                return out;
            }
        },
        {
            name: 'Rei dos Canais (🏴‍☠️)',
            load: async () => {
                // A API nova usa title ("Time A x Time B"); a antiga podia usar teams.home/away.
                // Valida o JSON antes de aceitar um host, para que uma resposta inválida/vazia
                // de um domínio não impeça a tentativa dos próximos endereços configurados.
                let lastErr = new Error('nenhum endereço da API do Rei dos Canais respondeu com dados válidos');
                let json = null;
                for (const base of HOSTS.rdcApi) {
                    try {
                        const txt = await rdcGetText(base + '/sports?category=Futebol');
                        const parsed = JSON.parse(txt);
                        if (!parsed || parsed.success === false || !Array.isArray(parsed.data)) {
                            throw new Error('formato inesperado da API (' + base + ')');
                        }
                        json = parsed;
                        break;
                    } catch (e) {
                        lastErr = e;
                        log('API do Rei indisponível ou inválida:', base, e);
                    }
                }
                if (!json) throw lastErr;
                const site = HOSTS.rdcSite[0].replace(/\/$/, '');
                return json.data.filter(ev => ev && ev.id).map(ev => {
                    const teamsTitle = ev.teams && ev.teams.home && ev.teams.away
                        ? ev.teams.home.name + ' x ' + ev.teams.away.name
                        : String(ev.title || '').trim();
                    const timestamp = Number(ev.start_timestamp);
                    const parsedTime = ev.start_time ? Date.parse(ev.start_time) : NaN;
                    const startMs = Number.isFinite(timestamp) && timestamp > 0
                        ? timestamp * 1000
                        : (Number.isFinite(parsedTime) ? parsedTime : NaN);
                    return {
                        title: teamsTitle,
                        startMs,
                        link: site + '/assistir/' + encodeURIComponent(String(ev.id))
                    };
                }).filter(ev => ev.title && Number.isFinite(ev.startMs));
            }
        }
    ];

    async function rdcLoadExtraGames() {
        const lists = await Promise.all(RDC_EXTRA_SOURCES.map(async (s) => {
            try { return (await s.load()).map(x => ({ ...x, src: s.name })); }
            catch (e) { log('Fonte extra indisponível:', s.name, e); return []; }
        }));
        return lists.flat();   // mantém a ordem de prioridade das fontes
    }

    // itens do painel: só jogos que estão no futnatv, cada um com a melhor transmissão encontrada
    async function loadRdcPanelItems() {
        if (Date.now() - rdcYtCache.at < RDC_YT_CACHE_MS && rdcYtCache.src) return rdcYtCache.items;
        let bolaErr = false;
        const [games, bola] = await Promise.all([
            loadRdcFutnatGames(),
            loadRdcBolaItems().catch(e => { bolaErr = true; log('Erro no Bolarolando:', e); return []; })
        ]);
        const feedCache = new Map(), items = [];
        const unresolved = [];
        await rdcPool(games.filter(e => e.kind !== 'ended'), 4, async (entry) => {
        try {
            const it = await resolveRdcGame(entry, feedCache, bola);
            if (it) items.push(it);
            else unresolved.push(entry);
        } catch (e) {
            log('Erro ao resolver o jogo', entry.g.home, e);
            unresolved.push(entry);
        }
        });
        // sem YouTube e sem Bola Rolando: tenta as fontes extras (só busca se sobrou algum jogo)
        if (unresolved.length) {
            const extras = await rdcLoadExtraGames();
            unresolved.forEach(entry => {
                const title = entry.g.home + (entry.g.away ? ' x ' + entry.g.away : '');
                const hit = rdcBestMatch({ title, startMs: entry.startMs }, extras, x => ({ title: x.title, startMs: x.startMs }));
                if (hit) items.push({ kind: entry.kind, startMs: entry.startMs, src: hit.src, link: hit.link, title,
                                     sub: [entry.g.competition, entry.g.round].filter(Boolean).join(' · '), timeLabel: String(entry.g.time).toUpperCase() });
            });
        }
        items.sort((a, b) => (Number.isFinite(a.startMs) ? a.startMs : Infinity) - (Number.isFinite(b.startMs) ? b.startMs : Infinity));
        rdcYtCache = { at: Date.now(), items, src: true, bolaErr, games, bola, feedCache, endedCache: new Map() };
        rdcSaveCache(items, bolaErr);
        return items;
    }

    // busca por time entre os jogos de hoje; os já encerrados só têm o link procurado quando combinam com a busca
    async function rdcSearchGames(query) {
        const q = rdcNorm(query);
        await loadRdcPanelItems();   // garante a lista e o cache atualizados
        const c = rdcYtCache;
        const items = c.items.filter(it => rdcNorm(it.title).includes(q));
        const ended = c.games.filter(e => e.kind === 'ended' && rdcNorm(e.g.home + ' ' + (e.g.away || '')).includes(q));
        await rdcPool(ended, 3, async (entry) => {
            const key = entry.g.time + '|' + entry.g.home + '|' + entry.g.away;
            if (!c.endedCache.has(key)) {
                let it = null;
                try { it = await resolveRdcGame(entry, c.feedCache, c.bola); } catch (e) { log('Erro ao resolver jogo encerrado', entry.g.home, e); }
                c.endedCache.set(key, it);
            }
            const it = c.endedCache.get(key);
            if (it) items.push(it);
        });
        items.sort((a, b) => (Number.isFinite(a.startMs) ? a.startMs : Infinity) - (Number.isFinite(b.startMs) ? b.startMs : Infinity));
        return items;
    }

    // ---- Bola Rolando ----
    async function loadRdcBolaItems() {
        const htmlText = await fetchBolaRolandoHTML();
        const doc = new DOMParser().parseFromString(htmlText, 'text/html');
        const now = new Date();
        const items = [];
        doc.querySelectorAll('a.latest-match-card').forEach(card => {
            const teamsEl = card.querySelector('.match-teams');
            const title = teamsEl ? teamsEl.textContent.trim() : '';

            // FILTRO 1: APENAS FUTEBOL (Ignora NBA, NBB, UFC, etc.)
            if (/^NBA:|^NBB:|^UFC:|^NFL:|^MLB:/i.test(title)) return;

            const timeEl = card.querySelector('.match-time');
            const dateEl = card.querySelector('.match-date');
            const timeStr = timeEl ? timeEl.textContent.trim() : ''; // Ex: "20H00"
            const dateStr = dateEl ? dateEl.textContent.trim() : ''; // Ex: "23-10-2026"

            let kind = 'soon', startMs = NaN;
            if (timeStr && dateStr) {
                const [day, month, year] = dateStr.split('-').map(Number);
                const [hours, minutes] = timeStr.toUpperCase().replace('H', ':').split(':').map(Number);
                const start = new Date(year, month - 1, day, hours, minutes || 0);
                startMs = start.getTime();
                const diffMinutes = (now.getTime() - startMs) / 60000;
                if (diffMinutes >= 0 && diffMinutes <= 125) kind = 'live';
                else if (diffMinutes > 125 && diffMinutes <= 150) kind = 'ending';
            }

            const href = card.getAttribute('href') || '';
            const link = href.startsWith('http') ? href : new URL(href, BOLA_ROLANDO_URL).href;
            items.push({ kind, startMs, src: 'Futebol Grátis', title, sub: '', link, rawTitle: title,
                        statusText: kind === 'live' ? 'AO VIVO' : (kind === 'ending' ? 'ENCERRADO' : timeStr) });
        });
        log('Futebol Grátis: ' + items.length + ' jogos lidos de ' + BOLA_ROLANDO_URL + ' (' + htmlText.length + ' caracteres)', items.map(i => i.title));
        return items;
    }

    async function loadRdcLiveSports(container, footerElement, query) {
        const seq = ++rdcRenderSeq;
        // mostra na hora o que já está guardado (memória ou localStorage); o status é recalculado com o relógio de agora
        let shown = false;
        if (!query) {
            const saved = rdcYtCache.src ? { items: rdcYtCache.items, bolaErr: rdcYtCache.bolaErr } : rdcLoadCache();
            if (saved) { rdcRenderItems(container, footerElement, saved.items, query, saved.bolaErr); shown = true; }
        }
        if (!shown) container.innerHTML = '<div style="opacity:0.7;text-align:center;padding:16px;font-size:12px;">Buscando jogos de futebol...</div>';
        let items;
        try {
            items = query ? await rdcSearchGames(query) : await loadRdcPanelItems();
        } catch (e) {
            if (seq !== rdcRenderSeq) return;
            if (shown) { log('Erro ao atualizar; mantendo a lista guardada:', e); return; }
            container.innerHTML = `
                <div style="padding:12px;text-align:center;font-size:11.5px;line-height:1.4;">
                    <div style="opacity:0.7;margin-bottom:6px;color:#d32f2f;">Não foi possível extrair a lista de jogos do ${new URL(HOSTS.futnatv[0]).host}/. Verifique se o site está funcionando e dê um F5.</div>
                    <a href="${HOSTS.futnatv[0]}/" target="_blank" rel="noopener" style="color:#2a5885;font-weight:bold;text-decoration:underline;">Abrir no Site ↗</a>
                </div>
            `;
            if (footerElement) footerElement.style.display = 'block';
            log('Erro no FutNaTV:', e);
            return;
        }

        if (seq !== rdcRenderSeq) return;
        const keepTop = container.scrollTop;
        rdcRenderItems(container, footerElement, items, query, rdcYtCache.bolaErr);
        container.scrollTop = keepTop;
    }

    // desenha a lista (ao vivo / próximo / encerrando é recalculado com o relógio de agora)
    function rdcRenderItems(container, footerElement, items, query, bolaErr) {
        items = items.map(it => rdcWithStatus(it)).filter(it => query || it.kind !== 'ended');
        container.innerHTML = '';
        if (bolaErr) {
            const warn = mk('padding:8px 10px;border-radius:6px;background:rgba(255,152,0,0.12);font-size:11px;line-height:1.35;');
            warn.innerHTML = '⚠️ Não foi possível buscar os jogos do site <b>' + new URL(BOLA_ROLANDO_URL).host + '</b>. Jogos de fora do YouTube podem não aparecer.<br><br>Tente trocar o DNS do navegador ou verifique se o site trocou de domínio.';
            container.appendChild(warn);
        }
        items.forEach(it => {
            const item = mk('padding:8px 10px;border-radius:6px;background:rgba(128,128,128,0.06);text-decoration:none;color:inherit;display:block;transition:background .15s;', null, 'a');
            item.href = it.link;
            item.target = '_blank';
            item.rel = 'noopener noreferrer';
            item.addEventListener('mouseenter', () => item.style.background = 'rgba(128,128,128,0.15)');
            item.addEventListener('mouseleave', () => item.style.background = 'rgba(128,128,128,0.06)');

            const statusColor = it.kind === 'live' ? '#4caf50' : (it.kind === 'ending' ? '#FF7747' : (it.kind === 'ended' ? '#9e9e9e' : '#2196f3'));
            item.innerHTML = `
                <div style="display:flex;align-items:center;flex-wrap:nowrap;gap:2px 5px;font-size:10.5px;opacity:0.85;margin-bottom:3px;font-weight:600;">
                    <span style="flex:0 0 auto;width:7px;height:7px;background:${statusColor};border-radius:50%;display:inline-block;box-shadow: 0 0 4px ${statusColor};"></span>
                    <span style="color:${statusColor};flex:0 0 auto;white-space:nowrap;">${esc(it.statusText)}</span>
                    <span title="${esc(it.src)}" style="margin-left:auto;min-width:0;text-align:right;opacity:0.7;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${it.src === 'Bola Rolando' ? '' : '▶ '}${esc(it.src)}</span>
                </div>
                <div style="font-weight:600;font-size:12px;line-height:1.3;">${esc(it.title)}</div>
                ${it.sub ? `<div style="font-size:10.5px;opacity:0.65;margin-top:2px;">${esc(it.sub)}</div>` : ''}
            `;
            container.appendChild(item);
        });

        if (!items.length) {
            container.insertAdjacentHTML('beforeend', '<div style="opacity:0.7;text-align:center;padding:16px;font-size:12px;">' + (query ? 'Nenhum jogo encontrado para essa busca.' : 'Nenhum jogo com transmissão encontrada agora.') + '</div>');        }
        if (footerElement) footerElement.style.display = 'block';
    }

    function renderRdcWidget() {
        if (!document.body) return;

        const existing = document.getElementById('vk-ar-rdc-widget');

        if (!isRdcAllowedPage()) {
            if (existing) existing.remove();
            return;
        }

        if (existing) return;

        const widget = mk('position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:99999;font:13px -apple-system,BlinkMacSystemFont,Roboto,sans-serif;display:flex;align-items:center;');
        widget.id = 'vk-ar-rdc-widget';

        const panel = mk('width:250px;max-height:460px;background:var(--vkui--color_background_content, #fff);color:var(--vkui--color_text_primary, #000);border:1px solid rgba(128,128,128,0.3);border-radius:8px 0 0 8px;box-shadow:-6px 0 20px rgba(0,0,0,0.2);display:flex;flex-direction:column;overflow:hidden;');

        const toggleBtn = mk('cursor:pointer;background:#2a5885;color:#fff;border-radius:8px 0 0 8px;font-weight:600;box-shadow:2px 0 10px rgba(0,0,0,0.2);user-select:none;flex-shrink:0;display:flex;align-items:center;justify-content:center;');

        const updateStateUI = () => {
            const state = LS.get(RDC_STORAGE_KEY) || 'fresh';

            if (state === 'expanded') {
                // Menu aberto
                panel.style.display = 'flex';
                toggleBtn.style.writingMode = 'vertical-rl';
                toggleBtn.style.textOrientation = 'mixed';
                toggleBtn.style.padding = '16px 6px';
                toggleBtn.style.fontSize = '12px';
                toggleBtn.innerHTML = '<span>Jogos ao Vivo</span>';
                searchInput.value = '';
                loadRdcLiveSports(panelContent, dnsFooter);
            } else if (state === 'compact') {
                // Fechou/minimizou: exibe apenas Bolinha + TV
                panel.style.display = 'none';
                toggleBtn.style.writingMode = 'horizontal-tb';
                toggleBtn.style.padding = '10px 10px';
                toggleBtn.style.fontSize = '16px';
                toggleBtn.innerHTML = '<span title="Jogos ao Vivo">⚽📺</span>';
            } else {
                // PRIMEIRO USO ('fresh'): Apenas o botão "Jogos ao Vivo" na vertical
                panel.style.display = 'none';
                toggleBtn.style.writingMode = 'vertical-rl';
                toggleBtn.style.textOrientation = 'mixed';
                toggleBtn.style.padding = '16px 6px';
                toggleBtn.style.fontSize = '12px';
                toggleBtn.innerHTML = '<span>Jogos ao Vivo</span>';
            }
        };

        toggleBtn.addEventListener('click', () => {
            const state = LS.get(RDC_STORAGE_KEY) || 'fresh';
            LS.set(RDC_STORAGE_KEY, state === 'expanded' ? 'compact' : 'expanded');
            updateStateUI();
        });

        const header = mk('padding:8px 12px;background:#2a5885;color:#fff;font-weight:bold;display:flex;justify-content:space-between;align-items:center;font-size:12px;');
        header.innerHTML = '<span>Clique em uma partida ↗</span>';

        const closeBtn = mk('cursor:pointer;padding:0 4px;font-size:14px;', '✕', 'span');
        closeBtn.title = 'Fechar menu';
        closeBtn.addEventListener('click', () => {
            LS.set(RDC_STORAGE_KEY, 'compact');
            updateStateUI();
        });
        header.appendChild(closeBtn);

        const panelContent = mk('overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:6px;max-height:240px;');

        // Rodapé com o tutorial de DNS (tooltip no tutorial) e links alternativos
        const dnsFooter = mk('padding:10px;background:rgba(128,128,128,0.06);border-top:1px solid rgba(128,128,128,0.15);font-size:11px;line-height:1.4;color:inherit;');
        dnsFooter.innerHTML = `
            <div title="O erro ocorre porque o DNS padrão do seu provedor de internet bloqueia o acesso a alguns links 'não-oficiais'." style="cursor:help;">
                <div style="opacity:0.9;margin-bottom:6px;">⚠️ <b>Dica:</b> se o site não abrir, tente trocar o fornecedor DNS do seu navegador.</div>
                <div style="background:rgba(0,0,0,0.05);padding:6px 8px;border-radius:4px;font-size:10.5px;opacity:0.85;line-height:1.35;margin-bottom:8px;">
                    Abra as configurações do navegador, pesquise por <b>DNS</b> e escolha manualmente o DNS do Google (<code style="user-select:all;">8.8.8.8</code>).
                </div>
            </div>
            <div style="padding-top:6px;border-top:1px dashed rgba(128,128,128,0.25);font-size:11px;line-height:1.3;cursor:default;">
                <span style="font-weight:bold;opacity:0.9;">Alternativas:</span>
                <a href="${HOSTS.ppvSite[0]}/" data-host="ppvSite" data-path="/" target="_blank" rel="noopener noreferrer" style="color:#2a5885;text-decoration:none;font-weight:600;">Site 1 (INT) ↗</a>
                <span style="opacity:0.5;margin:0 2px;">|</span>
                <a href="${HOSTS.rdcAgenda[0]}" data-host="rdcAgenda" target="_blank" rel="noopener noreferrer" style="color:#2a5885;text-decoration:none;font-weight:600;">Site 2 (BR) ↗</a>
            </div>
        `;

        // Busca por time (inclui jogos já encerrados de hoje)
        const searchBox = mk('padding:6px 8px;border-bottom:1px solid rgba(128,128,128,0.15);flex-shrink:0;');
        const searchInput = mk('width:100%;box-sizing:border-box;padding:5px 8px;font-size:12px;border:1px solid rgba(128,128,128,0.35);border-radius:5px;background:transparent;color:inherit;outline:none;', null, 'input');
        searchInput.type = 'search';
        searchInput.placeholder = '🔍 Buscar time (inclui encerrados)';
        let searchTimer = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                const q = searchInput.value.trim();
                loadRdcLiveSports(panelContent, dnsFooter, q.length >= 2 ? q : '');
            }, 300);
        });
        ['keydown', 'keyup', 'keypress'].forEach(ev => searchInput.addEventListener(ev, e => e.stopPropagation()));   // o VK não captura atalhos enquanto digita
        searchBox.appendChild(searchInput);

        panel.append(header, searchBox, panelContent, dnsFooter);
        widget.append(panel, toggleBtn);
        document.body.appendChild(widget);

        updateStateUI();
    }

        // Ciclo de vida do módulo: substitui os timers que antes ficavam no núcleo.
        void refreshHosts();
        renderTimer = setInterval(() => {
            try { renderRdcWidget(); } catch (e) { /* ignora */ }
        }, 800);
        hostsTimer = setInterval(() => {
            try { refreshHosts(); } catch (e) { /* ignora */ }
        }, CFG_REFRESH_MS);
    },
    stop() {
        if (renderTimer != null) clearInterval(renderTimer);
        if (hostsTimer != null) clearInterval(hostsTimer);
        renderTimer = null;
        hostsTimer = null;
        const widget = document.getElementById('vk-ar-rdc-widget');
        if (widget) widget.remove();
    }
});
