const { sessionUser, users, json } = require("./_lib");

module.exports = (req, res) => {
  const name = sessionUser(req);
  if (!name) return json(res, 401, { error: "unauthorized" });
  json(res, 200, { name, people: Object.keys(users()), ready: !!process.env.GITHUB_TOKEN });
};
