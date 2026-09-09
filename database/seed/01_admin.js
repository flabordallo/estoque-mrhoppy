// Cria um ADMIN inicial de forma segura: senha vem de ADMIN_PASSWORD (env).
// Nunca há senha no código. Se a env não existir, gera uma aleatória e imprime uma vez.
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");

exports.seed = async function (knex) {
  const username = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
  const existing = await knex("users").where({ username }).first();
  if (existing) return;

  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(9).toString("base64url");
    generated = true;
  }
  await knex("users").insert({
    username,
    name: "Administrador",
    password_hash: await bcrypt.hash(password, 10),
    role: "ADMIN",
    active: true,
  });
  if (generated) {
    console.log("\n==================================================");
    console.log(` ADMIN criado — usuário: ${username}  senha: ${password}`);
    console.log(" Anote agora. Defina ADMIN_PASSWORD no .env para controlar.");
    console.log("==================================================\n");
  }
};
