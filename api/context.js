const { requireUser, json, body, getContext, putContext } = require("./_lib");

// GET -> { text, sha }.  PUT { text, sha } replaces (409 if stale).  POST { text } appends a dated entry.
module.exports = async (req, res) => {
  const me = requireUser(req, res);
  if (!me) return;
  try {
    if (req.method === "GET") return json(res, 200, await getContext());
    const b = body(req);
    const text = String(b.text || "");
    if (text.length > 200000) return json(res, 400, { error: "too long" });
    if (req.method === "PUT") {
      try {
        const sha = await putContext(text.endsWith("\n") ? text : text + "\n", b.sha || null, `Tandem Relay: ${me} edited context`);
        return json(res, 200, { sha, text });
      } catch (e) {
        if (e.status === 409 || e.status === 422) return json(res, 409, { error: "stale" });
        throw e;
      }
    }
    if (req.method === "POST") {
      if (!text.trim()) return json(res, 400, { error: "empty" });
      for (let i = 0; i < 3; i++) {
        const cur = await getContext();
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        const next = (cur.text || "# Shared context\n") + `\n## ${stamp} UTC, ${me}\n\n${text.trim()}\n`;
        try {
          const sha = await putContext(next, cur.sha, `Tandem Relay: ${me} added context`);
          return json(res, 200, { sha, text: next });
        } catch (e) {
          if (!(e.status === 409 || e.status === 422) || i === 2) throw e;
        }
      }
    }
    json(res, 405, { error: "method" });
  } catch (e) {
    json(res, 502, { error: "github", detail: e.message });
  }
};
