const { requireUser, json, messages, presence, touchPresence, users } = require("./_lib");

// GET /api/poll            -> recent history (last 200) + presence
// GET /api/poll?after=ID&since=ISO -> only newer messages + presence
module.exports = async (req, res) => {
  const me = requireUser(req, res);
  if (!me) return;
  try {
    const q = req.query || {};
    const after = Number(q.after) || 0;
    const since = after && q.since ? String(q.since) : undefined;
    await touchPresence(me, "web").catch(() => {});
    const [msgs, pres] = await Promise.all([messages(since), presence()]);
    const out = after ? msgs.filter((m) => m.id > after) : msgs.slice(-200);
    json(res, 200, { me, people: Object.keys(users()), messages: out, presence: pres, now: Date.now() });
  } catch (e) {
    json(res, 502, { error: "github", detail: e.message });
  }
};
