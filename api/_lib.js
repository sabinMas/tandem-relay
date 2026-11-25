// Shared helpers for Tandem Relay API routes. Files starting with "_" are not routed.
const crypto = require("crypto");

const API = process.env.GITHUB_API || "https://api.github.com";
const REPO = process.env.GITHUB_REPO || "sabinMas/tandem-relay";
const CHANNEL_TITLE = "claude-pair channel";
const PRESENCE_TITLE = "tandem-relay presence";
const CONTEXT_PATH = "CONTEXT.md";
const COOKIE = "tr_session";
const WEB_ONLINE_MS = 45 * 1000;
const AGENT_ACTIVE_MS = 10 * 60 * 1000;

// ---------- users & session ----------
// TR_KEYS="Mason=<secret>,Onjamm=<secret>" -- each person has their own private link key.
function users() {
  const out = {};
  for (const part of (process.env.TR_KEYS || "").split(",")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function hmac(s) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET || "").update(s).digest("base64url");
}
function makeCookie(name) {
  const payload = Buffer.from(JSON.stringify({ n: name, e: Date.now() + 30 * 864e5 })).toString("base64url");
  const v = `${payload}.${hmac(payload)}`;
  return `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 86400}`;
}
function sessionUser(req) {
  if (!process.env.SESSION_SECRET) return null;
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig || !safeEq(sig, hmac(payload))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (d.e < Date.now() || !(d.n in users())) return null;
    return d.n;
  } catch { return null; }
}
function requireUser(req, res) {
  const u = sessionUser(req);
  if (!u) { json(res, 401, { error: "unauthorized" }); return null; }
  if (!process.env.GITHUB_TOKEN) { json(res, 503, { error: "setup", detail: "GITHUB_TOKEN is not configured on the server." }); return null; }
  return u;
}
function json(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

// ---------- GitHub ----------
async function gh(path, { method = "GET", data } = {}) {
  const r = await fetch(`${API}/repos/${REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tandem-relay",
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const text = await r.text();
  if (!r.ok) {
    const e = new Error(`GitHub ${r.status}: ${text.slice(0, 200)}`);
    e.status = r.status;
    throw e;
  }
  return text ? JSON.parse(text) : null;
}

const issueCache = {};
async function issueNumber(title, body) {
  if (issueCache[title]) return issueCache[title];
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/issues?state=open&per_page=100&page=${page}`);
    const f = list.find((i) => !i.pull_request && i.title === title);
    if (f) return (issueCache[title] = f.number);
    if (list.length < 100) break;
  }
  const c = await gh("/issues", { method: "POST", data: { title, body } });
  return (issueCache[title] = c.number);
}
const channel = () => issueNumber(CHANNEL_TITLE, "Shared chat between our Claude Code agents and the two of us. Each comment is one message. Managed by Tandem Relay / claude-pair.");
const presenceIssue = () => issueNumber(PRESENCE_TITLE, "Presence heartbeats for Tandem Relay. Safe to ignore.");

// ---------- messages ----------
const MARK = /^<!--tr:(\{.*?\})-->\r?\n?/s;
function toMessage(c) {
  let text = c.body || "", meta = null;
  const m = text.match(MARK);
  if (m) { try { meta = JSON.parse(m[1]); } catch {} text = text.slice(m[0].length); }
  let who, kind, steer = false;
  if (meta) {
    who = meta.from; kind = meta.kind === "agent" ? "agent" : "human"; steer = !!meta.steer;
    text = text.replace(/^\*\*[^*\n]{1,60}:\*\*\s*/, "");
  } else {
    const p = text.match(/^\*\*(.{1,60}?)'s Claude:\*\*\s*/);
    if (p) { who = p[1]; kind = "agent"; text = text.slice(p[0].length); }
    else { who = c.user?.login || "unknown"; kind = "human"; }
  }
  return { id: c.id, at: c.created_at, who, kind, steer, text };
}
const msgCache = {};
async function messages(sinceIso) {
  const key = sinceIso || "";
  const hit = msgCache[key];
  if (hit && Date.now() - hit.t < 2000) return hit.v;
  const n = await channel();
  let all = [];
  for (let page = 1; page <= 20; page++) {
    const q = `?per_page=100&page=${page}` + (sinceIso ? `&since=${encodeURIComponent(sinceIso)}` : "");
    const batch = await gh(`/issues/${n}/comments${q}`);
    all = all.concat(batch);
    if (batch.length < 100) break;
  }
  const v = all.map(toMessage);
  msgCache[key] = { t: Date.now(), v };
  return v;
}
async function postMessage(name, text, steer) {
  const n = await channel();
  const meta = JSON.stringify({ from: name, kind: "human", steer: !!steer });
  const label = steer ? `**${name} (steering):** ` : `**${name}:** `;
  const c = await gh(`/issues/${n}/comments`, { method: "POST", data: { body: `<!--tr:${meta}-->\n${label}${text}` } });
  for (const k in msgCache) delete msgCache[k];
  return toMessage(c);
}

// ---------- presence ----------
const PMARK = /^<!--tr-presence:(\{.*?\})-->/s;
let pCache = null; // { t, list: [{id,name,kind,at}] }
const lastWrite = {};
async function presenceList(force) {
  if (!force && pCache && Date.now() - pCache.t < 8000) return pCache.list;
  const n = await presenceIssue();
  const raw = await gh(`/issues/${n}/comments?per_page=100`);
  const list = [];
  for (const c of raw) {
    const m = (c.body || "").match(PMARK);
    if (!m) continue;
    try { const d = JSON.parse(m[1]); list.push({ id: c.id, name: d.name, kind: d.kind, at: d.at }); } catch {}
  }
  pCache = { t: Date.now(), list };
  return list;
}
async function touchPresence(name, kind = "web") {
  const key = `${name}|${kind}`;
  if (Date.now() - (lastWrite[key] || 0) < 20000) return;
  lastWrite[key] = Date.now();
  const at = new Date().toISOString();
  const body = `<!--tr-presence:${JSON.stringify({ name, kind, at })}-->\nlast seen ${at}`;
  const list = await presenceList();
  const mine = list.find((p) => p.name === name && p.kind === kind);
  if (mine) {
    await gh(`/issues/comments/${mine.id}`, { method: "PATCH", data: { body } });
    mine.at = at;
  } else {
    const n = await presenceIssue();
    await gh(`/issues/${n}/comments`, { method: "POST", data: { body } });
    pCache = null;
  }
}
async function presence() {
  const list = await presenceList();
  const now = Date.now();
  return list.map((p) => {
    const age = now - Date.parse(p.at);
    return { name: p.name, kind: p.kind, at: p.at, online: p.kind === "web" ? age < WEB_ONLINE_MS : age < AGENT_ACTIVE_MS };
  });
}

// ---------- context file ----------
async function getContext() {
  try {
    const f = await gh(`/contents/${CONTEXT_PATH}`);
    return { text: Buffer.from(f.content, "base64").toString("utf8"), sha: f.sha };
  } catch (e) {
    if (e.status === 404) return { text: "", sha: null };
    throw e;
  }
}
async function putContext(text, sha, message) {
  const data = { message, content: Buffer.from(text, "utf8").toString("base64") };
  if (sha) data.sha = sha;
  const r = await gh(`/contents/${CONTEXT_PATH}`, { method: "PUT", data });
  return r.content.sha;
}

module.exports = {
  users, safeEq, makeCookie, sessionUser, requireUser, json, body,
  messages, postMessage, touchPresence, presence, getContext, putContext, gh, REPO,
};
