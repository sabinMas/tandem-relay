#!/usr/bin/env node
// Tandem Relay / claude-pair: a tiny MCP server that lets two people's Claude Code sessions
// talk to each other and share notes, using a private GitHub repo as the
// shared space. No hosting, no dependencies. Auth comes from `gh auth login`.
//
// Env:
//   PAIR_REPO  owner/name of the shared private repo (required)
//   PAIR_NAME  how your messages are labeled, e.g. "Mason" (optional)
//
// Shared state in the repo:
//   - An issue titled "claude-pair channel" holds the chat (each comment = one message)
//   - CONTEXT.md holds shared notes / project context

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Settings can also be passed as flags (handy on Windows): --repo owner/name --name Mason
function flag(n) { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; }
const REPO = flag("--repo") || process.env.PAIR_REPO;
const NAME = flag("--name") || process.env.PAIR_NAME || "";
const CHANNEL_TITLE = "claude-pair channel";
const CONTEXT_PATH = "CONTEXT.md";
const STATE_DIR = path.join(os.homedir(), ".claude-pair");
const STATE_FILE = path.join(STATE_DIR, `${(REPO || "none").replace("/", "__")}.json`);

// ---------- GitHub helpers (via gh CLI, args array = no shell injection) ----------
function gh(args, input) {
  const r = spawnSync("gh", ["api", ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 50 * 1024 * 1024,
    shell: false, // gh is a real .exe on Windows; a shell would split URLs at "&"
  });
  if (r.error) throw new Error(`could not run gh: ${r.error.message}. Is the GitHub CLI installed?`);
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || "").trim();
    const e = new Error(msg || `gh api failed (${r.status})`);
    e.notFound = /404|Not Found/i.test(msg);
    throw e;
  }
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function saveState(s) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function me(state) {
  if (!state.login) state.login = gh(["user"]).login;
  return state.login;
}

function channelIssue(state) {
  if (state.issue) return state.issue;
  const q = encodeURIComponent(`repo:${REPO} is:issue in:title "${CHANNEL_TITLE}"`);
  const found = gh([`search/issues?q=${q}`]).items.find((i) => i.title === CHANNEL_TITLE);
  if (found) state.issue = found.number;
  else {
    const body = JSON.stringify({
      title: CHANNEL_TITLE,
      body: "Shared chat between our Claude Code sessions. Each comment is one message. Managed by claude-pair.",
    });
    state.issue = gh([`repos/${REPO}/issues`, "-X", "POST", "--input", "-"], body).number;
  }
  saveState(state);
  return state.issue;
}

function fetchComments(state, sinceIso) {
  const n = channelIssue(state);
  let all = [];
  for (let page = 1; page < 50; page++) {
    let url = `repos/${REPO}/issues/${n}/comments?per_page=100&page=${page}`;
    if (sinceIso) url += `&since=${encodeURIComponent(sinceIso)}`;
    const batch = gh([url]);
    all = all.concat(batch);
    if (batch.length < 100) break;
  }
  return all;
}

// Messages carry a marker so Tandem Relay (web) and the CLI tools share one format:
//   <!--tr:{"from":"Mason","kind":"agent"|"human","steer":bool}-->
const MARK = /^<!--tr:(\{.*?\})-->\r?\n?/s;
function parse(c) {
  let text = c.body || "", meta = null;
  const m = text.match(MARK);
  if (m) { try { meta = JSON.parse(m[1]); } catch {} text = text.slice(m[0].length); }
  if (meta) return { from: meta.from, kind: meta.kind === "agent" ? "agent" : "human", steer: !!meta.steer, text };
  const p = text.match(/^\*\*(.{1,60}?)'s Claude:\*\*\s*/);
  if (p) return { from: p[1], kind: "agent", steer: false, text: text.slice(p[0].length) };
  return { from: c.user.login, kind: "human", steer: false, text };
}
function fmt(c) {
  const m = parse(c);
  const who = m.kind === "agent" ? `${m.from}'s Claude` : `${m.from} (human${m.steer ? ", steering you" : ""})`;
  return `[${c.created_at}] ${who} (#${c.id}):\n${m.text}`;
}

// Returns unread messages from your partner and advances the read marker.
function readNew(state, { includeMine = false } = {}) {
  const login = me(state);
  const comments = fetchComments(state, state.lastSeenAt);
  const fresh = comments.filter((c) => c.id > (state.lastSeenId || 0));
  if (fresh.length) {
    const last = fresh[fresh.length - 1];
    state.lastSeenId = last.id;
    state.lastSeenAt = last.created_at;
    saveState(state);
  }
  // Hide only what *your own agent* wrote. Humans' messages (including your own steering from the web app) always reach you.
  const mine = (c) => {
    const m = parse(c);
    return m.kind === "agent" ? m.from === (NAME || login) : !MARK.test(c.body || "") && c.user.login === login;
  };
  return includeMine ? fresh : fresh.filter((c) => !mine(c));
}

function getContext() {
  try {
    const f = gh([`repos/${REPO}/contents/${CONTEXT_PATH}`]);
    return { text: Buffer.from(f.content, "base64").toString("utf8"), sha: f.sha };
  } catch (e) {
    if (e.notFound) return { text: "", sha: null };
    throw e;
  }
}

function putContext(text, sha, message) {
  const body = { message, content: Buffer.from(text, "utf8").toString("base64") };
  if (sha) body.sha = sha;
  gh([`repos/${REPO}/contents/${CONTEXT_PATH}`, "-X", "PUT", "--input", "-"], JSON.stringify(body));
}

// Presence: lets the Tandem Relay web app show when your agent is active. Best effort, throttled.
function touchPresence(state) {
  try {
    if (Date.now() - (state.presenceAt || 0) < 60000) return;
    state.presenceAt = Date.now();
    const who = NAME || me(state);
    if (!state.presenceIssue) {
      const q = encodeURIComponent(`repo:${REPO} is:issue in:title "tandem-relay presence"`);
      const f = gh([`search/issues?q=${q}`]).items.find((i) => i.title === "tandem-relay presence");
      state.presenceIssue = f ? f.number : gh([`repos/${REPO}/issues`, "-X", "POST", "--input", "-"], JSON.stringify({ title: "tandem-relay presence", body: "Presence heartbeats for Tandem Relay. Safe to ignore." })).number;
    }
    const at = new Date().toISOString();
    const body = `<!--tr-presence:${JSON.stringify({ name: who, kind: "agent", at })}-->\nlast seen ${at}`;
    if (!state.presenceComment) {
      const list = gh([`repos/${REPO}/issues/${state.presenceIssue}/comments?per_page=100`]);
      const mine = list.find((c) => (c.body || "").startsWith(`<!--tr-presence:{"name":${JSON.stringify(who)},"kind":"agent"`));
      if (mine) state.presenceComment = mine.id;
    }
    if (state.presenceComment) gh([`repos/${REPO}/issues/comments/${state.presenceComment}`, "-X", "PATCH", "--input", "-"], JSON.stringify({ body }));
    else state.presenceComment = gh([`repos/${REPO}/issues/${state.presenceIssue}/comments`, "-X", "POST", "--input", "-"], JSON.stringify({ body })).id;
    saveState(state);
  } catch { /* presence is optional */ }
}

// ---------- Tools ----------
const tools = [
  {
    name: "pair_send",
    description:
      "Send a message to your partner's Claude Code session (and your partner). Use it to share what you're working on, hand off a task, ask a question, or reply.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "The message, in Markdown." } },
      required: ["text"],
    },
    run({ text }, state) {
      const n = channelIssue(state);
      const from = NAME || me(state);
      const meta = JSON.stringify({ from, kind: "agent", steer: false });
      const c = gh([`repos/${REPO}/issues/${n}/comments`, "-X", "POST", "--input", "-"], JSON.stringify({ body: `<!--tr:${meta}-->\n**${from}'s Claude:** ${text}` }));
      return `Sent (#${c.id}).`;
    },
  },
  {
    name: "pair_inbox",
    description:
      "Read new messages from your partner's side since you last checked. Call this at the start of work, before handing off, and whenever the user asks what their partner said.",
    inputSchema: { type: "object", properties: {} },
    run(_args, state) {
      const fresh = readNew(state);
      return fresh.length ? fresh.map(fmt).join("\n\n---\n\n") : "No new messages from your partner.";
    },
  },
  {
    name: "pair_history",
    description: "Read the most recent messages in the shared channel from both sides, read or not.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "How many recent messages (default 20)." } },
    },
    run({ limit = 20 }, state) {
      const all = fetchComments(state);
      const last = all.slice(-Math.max(1, Math.min(200, limit)));
      return last.length ? last.map(fmt).join("\n\n---\n\n") : "The channel is empty.";
    },
  },
  {
    name: "pair_context_read",
    description:
      "Read the shared CONTEXT.md: the notes both of you keep about the project (goals, decisions, who is doing what, gotchas).",
    inputSchema: { type: "object", properties: {} },
    run() {
      const { text } = getContext();
      return text || "CONTEXT.md is empty. Use pair_context_write to start it.";
    },
  },
  {
    name: "pair_context_write",
    description:
      "Update the shared CONTEXT.md. mode 'append' adds a dated entry (safe default); mode 'replace' rewrites the whole file (read it first).",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        mode: { type: "string", enum: ["append", "replace"], default: "append" },
      },
      required: ["text"],
    },
    run({ text, mode = "append" }, state) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const cur = getContext();
        let next;
        if (mode === "replace") next = text.endsWith("\n") ? text : text + "\n";
        else {
          const who = NAME || me(state);
          const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
          next = (cur.text || "# Shared context\n") + `\n## ${stamp} UTC, ${who}\n\n${text.trim()}\n`;
        }
        try {
          putContext(next, cur.sha, `claude-pair: ${mode} context (${NAME || me(state)})`);
          return `CONTEXT.md updated (${mode}).`;
        } catch (e) {
          if (!/409|sha/i.test(e.message) || attempt === 2) throw e; // retry on concurrent edit
        }
      }
    },
  },
];

// ---------- Hook mode: `node pair-server.js --hook` ----------
// Used as a UserPromptSubmit hook so partner messages show up automatically.
if (process.argv.includes("--hook")) {
  try {
    if (!REPO) process.exit(0);
    const state = loadState();
    touchPresence(state);
    const fresh = readNew(state);
    if (fresh.length) {
      const out = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext:
            "New messages in your shared Tandem Relay chat (from your partner, their Claude, or a human steering both agents). Tell the user about anything relevant and follow steering instructions:\n\n" +
            fresh.map(fmt).join("\n\n---\n\n"),
        },
      };
      process.stdout.write(JSON.stringify(out));
    }
  } catch (e) {
    process.stderr.write(`claude-pair hook: ${e.message}\n`);
  }
  process.exit(0);
}

// ---------- Minimal MCP stdio server (JSON-RPC, newline-delimited) ----------
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

function handle(req) {
  const { id, method, params } = req;
  if (method === "initialize") {
    return send({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "claude-pair", version: "1.0.0" },
        instructions:
          "claude-pair connects this session with the user's coding partner's Claude Code session through a shared GitHub repo. " +
          "Check pair_inbox when starting work, send short updates with pair_send when you finish something, hand off, or need input, " +
          "and keep durable decisions in pair_context_write.",
      },
    });
  }
  if (method === "tools/list") {
    return send({ jsonrpc: "2.0", id, result: { tools: tools.map(({ run, ...t }) => t) } });
  }
  if (method === "tools/call") {
    const tool = tools.find((t) => t.name === params.name);
    if (!tool) return send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool ${params.name}` } });
    try {
      if (!REPO) throw new Error("PAIR_REPO is not set. Add it to the MCP server's env (owner/repo).");
      const state = loadState();
      touchPresence(state);
      const text = tool.run(params.arguments || {}, state);
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e) {
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true } });
    }
  }
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); } catch (e) { process.stderr.write(`claude-pair: bad message: ${e.message}\n`); }
  }
});
