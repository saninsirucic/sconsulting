const { v4: uuidv4 } = require('uuid');

async function logActivity(db, user, action, entityType, entityId, metadata = {}) {
  await db('email_activity_logs').insert({
    id: uuidv4(),
    actor_id: user.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata_json: JSON.stringify(metadata),
    created_at: new Date()
  });
}

module.exports = { logActivity };
