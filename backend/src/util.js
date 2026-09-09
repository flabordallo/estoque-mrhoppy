// Utilitários sem dependências: cookies, sanitização e datas.
function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function serializeCookie(name, value, opts = {}) {
  let str = `${name}=${encodeURIComponent(value)}`;
  if (opts.maxAge != null) str += `; Max-Age=${opts.maxAge}`;
  str += `; Path=${opts.path || "/"}`;
  if (opts.httpOnly) str += "; HttpOnly";
  if (opts.sameSite) str += `; SameSite=${opts.sameSite}`;
  if (opts.secure) str += "; Secure";
  return str;
}

function str(v, max = 200) {
  if (v == null) return "";
  return String(v).slice(0, max);
}

function num(v) {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

module.exports = { parseCookies, serializeCookie, str, num };
