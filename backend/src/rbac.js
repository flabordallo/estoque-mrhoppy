// Autorização por papel. Verificada SEMPRE no backend.
const RANK = { OPERATOR: 1, MANAGER: 2, ADMIN: 3 };
function atLeast(role, required) {
  return (RANK[role] || 0) >= (RANK[required] || 99);
}
module.exports = { atLeast, RANK };
