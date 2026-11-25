const { requireUser, json, body, postMessage } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "method" });
  const me = requireUser(req, res);
  if (!me) return;
  const { text, steer } = body(req);
  const t = String(text || "").trim();
  if (!t) return json(res, 400, { error: "empty" });
  if (t.length > 20000) return json(res, 400, { error: "too long" });
  try {
    json(res, 200, { message: await postMessage(me, t, steer !== false) });
  } catch (e) {
    json(res, 502, { error: "github", detail: e.message });
  }
};
