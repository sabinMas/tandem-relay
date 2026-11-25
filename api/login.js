const { users, safeEq, makeCookie, json, body } = require("./_lib");

module.exports = (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "method" });
  if (!process.env.SESSION_SECRET) return json(res, 503, { error: "setup", detail: "SESSION_SECRET is not configured." });
  const key = String(body(req).key || "");
  if (key.length < 16) return json(res, 401, { error: "invalid" });
  let found = null;
  for (const [name, k] of Object.entries(users())) if (k && safeEq(key, k)) found = name;
  if (!found) return json(res, 401, { error: "invalid" });
  res.setHeader("Set-Cookie", makeCookie(found));
  json(res, 200, { name: found });
};
