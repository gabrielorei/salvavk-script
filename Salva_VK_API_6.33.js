const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, Prefer, Accept",
  "Access-Control-Max-Age": "86400"
};

const EMOJIS = new Set(["0", "2", "3", "26", "19", "39", "22", "17", "7", "31"]);
const TOPIC_RE = /^[\w-]{1,80}$/;
const ID_RE = /^[1-9]\d*$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const NEXT_TIMESTAMP_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', max(julianday('now'), COALESCE(julianday((SELECT MAX(updated_at) FROM reactions)), 0) + 0.00000002))";

function response(body, status = 200, type = "application/json") {
  return new Response(body, { status, headers: { ...cors, "Content-Type": type, "Cache-Control": "no-store" } });
}
function json(data, status = 200) { return response(JSON.stringify(data), status); }
function csvValue(value) {
  const s = String(value ?? "");
  return '"' + s.replace(/"/g, '""') + '"';
}
function validId(value) {
  if (typeof value !== "number" && !(typeof value === "string" && ID_RE.test(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function validCommentOwnerId(value) {
  if (typeof value !== "number" && !(typeof value === "string" && /^-?[1-9]\d*$/.test(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n !== 0 ? n : null;
}
function validTopic(value) { return typeof value === "string" && TOPIC_RE.test(value); }
function parseIds(raw) {
  const m = String(raw || "").match(/^in\.\(([\d,]+)\)$/);
  if (!m) return null;
  const ids = m[1].split(",").map(validId);
  return ids.length && ids.length <= 95 && ids.every(x => x !== null) ? ids : null;
}
function parseAfter(raw) {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw);
    if (!Array.isArray(a) || a.length !== 4) return false;
    const [ts, topic, cid, uid] = a;
    if (typeof ts !== "string" || !TS_RE.test(ts) || !Number.isFinite(Date.parse(ts)) || !validTopic(topic)) return false;
    const c = validId(cid), u = validId(uid);
    return c === null || u === null ? false : [ts, topic, c, u];
  } catch (_) { return false; }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!env.DB) return json({ error: "Banco DB não configurado" }, 500);
    const url = new URL(request.url);
    const method = request.method;

    try {
      if (method === "GET") {
        const topicParam = url.searchParams.get("topic");
        let topic = null;
        if (topicParam !== null) {
          if (!topicParam.startsWith("eq.")) return json({ error: "Tópico inválido" }, 400);
          topic = topicParam.slice(3);
          if (!validTopic(topic)) return json({ error: "Tópico inválido" }, 400);
        }

        const where = [], values = [];
        if (topic !== null) { where.push("topic = ?"); values.push(topic); }

        const or = url.searchParams.get("or") || "";
        const filters = [];
        const range = or.match(/and\(comment_id\.gte\.(\d+),comment_id\.lte\.(\d+)\)/);
        if (range) {
          const lo = validId(range[1]), hi = validId(range[2]);
          if (lo === null || hi === null || hi < lo) return json({ error: "Faixa inválida" }, 400);
          filters.push({ sql: "comment_id BETWEEN ? AND ?", args: [lo, hi] });
        }
        const inside = or.match(/comment_id\.in\.\(([\d,]+)\)/);
        if (inside) {
          const ids = parseIds("in.(" + inside[1] + ")");
          if (!ids) return json({ error: "IDs inválidos" }, 400);
          filters.push({ sql: "comment_id IN (" + ids.map(() => "?").join(",") + ")", args: ids });
        }
        if (filters.length) {
          where.push("(" + filters.map(f => f.sql).join(" OR ") + ")");
          filters.forEach(f => values.push(...f.args));
        } else if (!or) {
          const cid = url.searchParams.get("comment_id") || "";
          if (cid.startsWith("eq.")) {
            const id = validId(cid.slice(3));
            if (id === null) return json({ error: "ID inválido" }, 400);
            where.push("comment_id = ?"); values.push(id);
          } else if (cid.startsWith("in.")) {
            const ids = parseIds(cid);
            if (!ids) return json({ error: "IDs inválidos" }, 400);
            where.push("comment_id IN (" + ids.map(() => "?").join(",") + ")");
            values.push(...ids);
          } else if (topic !== null) {
            return json({ error: "Filtro de comentários ausente" }, 400);
          }
        } else {
          return json({ error: "Filtro OR inválido" }, 400);
        }

        const emoji = url.searchParams.get("emoji");
        if (emoji === "neq.0") where.push("emoji <> '0'");
        else if (emoji !== null) return json({ error: "Filtro de emoji inválido" }, 400);

        const afterRaw = url.searchParams.get("after");
        const after = parseAfter(afterRaw);
        if (after === false) return json({ error: "Cursor inválido" }, 400);
        const updated = url.searchParams.get("updated_at");
        if (after) {
          where.push("(updated_at, topic, comment_id, user_id) > (?, ?, ?, ?)");
          values.push(...after);
        } else if (updated && updated.startsWith("gt.")) {
          const ts = updated.slice(3);
          if (!Number.isFinite(Date.parse(ts))) return json({ error: "Data inválida" }, 400);
          where.push("updated_at > ?");
          values.push(ts);
        } else if (updated !== null) return json({ error: "Filtro de atualização inválido" }, 400);
        else if (topic === null) return json({ error: "Consulta global exige cursor de atualização" }, 400);

        const requestedLimit = Number(url.searchParams.get("limit") || 1000);
        const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 1000)) : 1000;
        const requestedOffset = Number(url.searchParams.get("offset") || 0);
        const offset = Number.isInteger(requestedOffset) ? Math.max(0, Math.min(requestedOffset, 1000000)) : 0;
        const order = url.searchParams.get("order") || "comment_id.asc";
        const orderSql = order.startsWith("updated_at.asc")
          ? "updated_at ASC, topic ASC, comment_id ASC, user_id ASC"
          : "comment_id ASC, user_id ASC";

        const result = await env.DB.prepare(`
          SELECT topic, comment_id, user_id, comment_owner_id, emoji, updated_at
          FROM reactions
          ${where.length ? "WHERE " + where.join(" AND ") : ""}
          ORDER BY ${orderSql}
          LIMIT ? OFFSET ?
        `).bind(...values, limit, offset).all();

        const rows = result.results || [];
        const lines = rows.map(r => [r.topic, r.comment_id, r.user_id, r.comment_owner_id, r.emoji, r.updated_at].map(csvValue).join(","));
        return response(["topic,comment_id,user_id,comment_owner_id,emoji,updated_at", ...lines].join("\n"), 200, "text/csv; charset=utf-8");
      }

      if (method === "POST") {
        const data = await request.json();
        const { topic, comment_id, user_id, comment_owner_id, emoji } = data || {};
        const cid = validId(comment_id), uid = validId(user_id), ownerId = comment_owner_id == null ? null : validCommentOwnerId(comment_owner_id), em = String(emoji);
        if (!validTopic(topic) || cid === null || uid === null || (comment_owner_id != null && ownerId === null) || !EMOJIS.has(em) || em === "0") {
          return json({ error: "Dados de reação inválidos" }, 400);
        }
        await env.DB.prepare(`
          INSERT INTO reactions (topic, comment_id, user_id, comment_owner_id, emoji, updated_at)
          VALUES (?, ?, ?, ?, ?, (${NEXT_TIMESTAMP_SQL}))
          ON CONFLICT(topic, comment_id, user_id)
          DO UPDATE SET
            comment_owner_id = COALESCE(excluded.comment_owner_id, reactions.comment_owner_id),
            emoji = excluded.emoji,
            updated_at = (${NEXT_TIMESTAMP_SQL})
        `).bind(topic, cid, uid, ownerId, em).run();
        return new Response(null, { status: 204, headers: cors });
      }

      if (method === "PATCH") {
        const topicParam = url.searchParams.get("topic") || "";
        const cidParam = url.searchParams.get("comment_id") || "";
        const uidParam = url.searchParams.get("user_id") || "";
        if (!topicParam.startsWith("eq.")) return json({ error: "Tópico inválido" }, 400);
        const topic = topicParam.slice(3);
        const cid = cidParam.startsWith("eq.") ? validId(cidParam.slice(3)) : null;
        const uid = uidParam.startsWith("eq.") ? validId(uidParam.slice(3)) : null;
        if (!validTopic(topic) || cid === null || uid === null) return json({ error: "Identificadores inválidos" }, 400);
        const data = await request.json();
        if (String(data?.emoji) !== "0") return json({ error: "Operação inválida" }, 400);
        await env.DB.prepare(`
          UPDATE reactions SET emoji = '0', updated_at = (${NEXT_TIMESTAMP_SQL})
          WHERE topic = ? AND comment_id = ? AND user_id = ?
        `).bind(topic, cid, uid).run();
        return new Response(null, { status: 204, headers: cors });
      }
      return json({ error: "Método não permitido" }, 405);
    } catch (error) {
      console.error("Salva VK API:", error);
      return json({ error: "Erro interno da API" }, 500);
    }
  }
};