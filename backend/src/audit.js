// Trilha de auditoria: nunca apaga; registra ação, entidade e valores.
async function record(knex, { userId = null, action, entityType = null, entityId = null, oldValue = null, newValue = null, metadata = null }) {
  await knex("audit_log").insert({
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId != null ? String(entityId) : null,
    old_value: oldValue != null ? JSON.stringify(oldValue) : null,
    new_value: newValue != null ? JSON.stringify(newValue) : null,
    metadata: metadata != null ? JSON.stringify(metadata) : null,
    timestamp: new Date().toISOString(), // ISO em ambos os bancos (comparação confiável)
  });
}

module.exports = { record };
