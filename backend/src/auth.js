// Autenticação: hash de senha (bcrypt), sessões e rate-limit no login.
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const { record } = require("./audit");

const SESSION_HOURS = 12;
const MAX_FAILED = 5;        // tentativas antes de bloquear
const WINDOW_MIN = 15;       // janela do rate-limit

const hashPassword = (plain) => bcrypt.hash(plain, 10);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

async function failedRecent(knex, username, ip) {
  const since = new Date(Date.now() - WINDOW_MIN * 60000).toISOString();
  const rows = await knex("audit_log")
    .where("action", "login_failed")
    .andWhere("timestamp", ">=", since);
  return rows.filter((r) => {
    try { const m = JSON.parse(r.metadata || "{}"); return m.username === username || m.ip === ip; }
    catch { return false; }
  }).length;
}

async function login(knex, { username, password, ip = null, userAgent = null }) {
  if (await failedRecent(knex, username, ip) >= MAX_FAILED) {
    return { ok: false, status: 429, error: "Muitas tentativas. Aguarde alguns minutos." };
  }
  const user = await knex("users").where({ username, active: true }).first();
  const okPass = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !okPass) {
    await record(knex, { userId: user ? user.id : null, action: "login_failed", metadata: { username, ip } });
    return { ok: false, status: 401, error: "Usuário ou senha inválidos." };
  }
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
  await knex("sessions").insert({ id: token, user_id: user.id, expires_at: expires, ip, user_agent: userAgent });
  await knex("users").where({ id: user.id }).update({ last_login_at: new Date().toISOString() });
  await record(knex, { userId: user.id, action: "login", metadata: { ip } });
  return { ok: true, token, user: publicUser(user), expires };
}

async function getSessionUser(knex, token) {
  if (!token) return null;
  const session = await knex("sessions").where({ id: token }).first();
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await knex("sessions").where({ id: token }).del();
    return null;
  }
  const user = await knex("users").where({ id: session.user_id, active: true }).first();
  return user ? { user: publicUser(user), session } : null;
}

async function logout(knex, token, userId) {
  if (token) await knex("sessions").where({ id: token }).del();
  if (userId) await record(knex, { userId, action: "logout" });
}

function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role };
}

module.exports = { hashPassword, verifyPassword, login, logout, getSessionUser, publicUser, SESSION_HOURS };
