/**
 * Schema completo do sistema (v1.11).
 * Portável entre SQLite (dev) e PostgreSQL (prod) via Knex.
 * Colunas JSON usam table.json() → TEXT no SQLite, JSON no Postgres.
 */
exports.up = async function (knex) {
  // -------- Usuários e sessões --------
  await knex.schema.createTable("users", (t) => {
    t.increments("id").primary();
    t.string("username").notNullable().unique();
    t.string("name").notNullable();
    t.string("password_hash").notNullable();
    t.string("role").notNullable().defaultTo("OPERATOR"); // ADMIN | MANAGER | OPERATOR
    t.boolean("active").notNullable().defaultTo(true);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.timestamp("updated_at").defaultTo(knex.fn.now());
    t.timestamp("last_login_at").nullable();
  });

  await knex.schema.createTable("sessions", (t) => {
    t.string("id").primary(); // token de sessão (aleatório)
    t.integer("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.timestamp("expires_at").notNullable();
    t.string("ip").nullable();
    t.string("user_agent").nullable();
    t.index(["user_id"]);
  });

  // -------- Catálogo de estoque --------
  await knex.schema.createTable("inventory_items", (t) => {
    t.increments("id").primary();
    t.string("category").notNullable();
    t.string("name").notNullable();
    t.string("unit").notNullable().defaultTo("unidade");
    t.decimal("minimum").nullable(); // null = sem mínimo definido
    t.boolean("active").notNullable().defaultTo(true);
    t.integer("sort_order").notNullable().defaultTo(0);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.timestamp("updated_at").defaultTo(knex.fn.now());
    t.unique(["category", "name"]);
    t.index(["category"]);
  });

  // -------- Inventários (snapshots) e contagens --------
  await knex.schema.createTable("inventory_snapshots", (t) => {
    t.increments("id").primary();
    t.string("code").notNullable(); // ex.: "Inventário 001"
    t.timestamp("closed_at").defaultTo(knex.fn.now());
    t.integer("user_id").nullable().references("id").inTable("users").onDelete("SET NULL");
    t.string("note").nullable();
  });

  await knex.schema.createTable("inventory_snapshot_items", (t) => {
    t.increments("id").primary();
    t.integer("snapshot_id").notNullable().references("id").inTable("inventory_snapshots").onDelete("CASCADE");
    t.integer("item_id").notNullable().references("id").inTable("inventory_items").onDelete("CASCADE");
    t.decimal("quantity").notNullable();
    t.index(["snapshot_id"]);
  });

  await knex.schema.createTable("inventory_counts", (t) => {
    t.increments("id").primary();
    t.integer("item_id").notNullable().references("id").inTable("inventory_items").onDelete("CASCADE");
    t.decimal("quantity").notNullable();
    t.timestamp("counted_at").defaultTo(knex.fn.now());
    t.integer("user_id").nullable().references("id").inTable("users").onDelete("SET NULL");
    t.integer("snapshot_id").nullable().references("id").inTable("inventory_snapshots").onDelete("SET NULL");
    t.index(["item_id"]);
  });

  // -------- Chopp --------
  await knex.schema.createTable("chopp_products", (t) => {
    t.increments("id").primary();
    t.string("brand").notNullable();
    t.string("name").notNullable();
    t.string("obs").nullable();
    t.boolean("active").notNullable().defaultTo(true);
    t.integer("sort_order").notNullable().defaultTo(0);
    t.unique(["brand", "name"]);
  });

  await knex.schema.createTable("chopp_taps", (t) => {
    t.increments("id").primary();
    t.integer("product_id").notNullable().references("id").inTable("chopp_products").onDelete("CASCADE");
    t.integer("position").notNullable().defaultTo(1);
    t.string("level_label").notNullable();
    t.decimal("level_pct").notNullable();
    t.index(["product_id"]);
  });

  await knex.schema.createTable("chopp_reserves", (t) => {
    t.increments("id").primary();
    t.integer("product_id").notNullable().references("id").inTable("chopp_products").onDelete("CASCADE");
    t.integer("barrels").notNullable().defaultTo(0);
    t.index(["product_id"]);
  });

  // -------- Auditoria --------
  await knex.schema.createTable("audit_log", (t) => {
    t.increments("id").primary();
    t.integer("user_id").nullable().references("id").inTable("users").onDelete("SET NULL");
    t.string("action").notNullable();
    t.string("entity_type").nullable();
    t.string("entity_id").nullable();
    t.json("old_value").nullable();
    t.json("new_value").nullable();
    t.timestamp("timestamp").defaultTo(knex.fn.now());
    t.json("metadata").nullable();
    t.index(["entity_type", "entity_id"]);
    t.index(["user_id"]);
  });

  // -------- Configurações --------
  await knex.schema.createTable("settings", (t) => {
    t.string("key").primary();
    t.json("value").nullable();
    t.timestamp("updated_at").defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  // ordem inversa por causa das foreign keys
  for (const table of [
    "settings",
    "audit_log",
    "chopp_reserves",
    "chopp_taps",
    "chopp_products",
    "inventory_counts",
    "inventory_snapshot_items",
    "inventory_snapshots",
    "inventory_items",
    "sessions",
    "users",
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
};
