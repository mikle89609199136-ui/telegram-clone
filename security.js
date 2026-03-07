const { query } = require('./data');

// Определение ролей
const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MODERATOR: 'moderator',
  MEMBER: 'member'
};

// Определение прав (permissions)
const PERMISSIONS = {
  SEND_MESSAGE: 'send_message',
  EDIT_MESSAGE: 'edit_message',
  DELETE_MESSAGE: 'delete_message',
  PIN_MESSAGE: 'pin_message',
  REACT: 'react',
  REPLY: 'reply',
  ADD_MEMBER: 'add_member',
  REMOVE_MEMBER: 'remove_member',
  BAN_MEMBER: 'ban_member',
  KICK: 'kick',
  PROMOTE: 'promote',
  DEMOTE: 'demote',
  EDIT_INFO: 'edit_info',
  DELETE_CHAT: 'delete_chat',
  CHANGE_PERMISSIONS: 'change_permissions',
  VIEW_HISTORY: 'view_history',
  VIEW_MEMBERS: 'view_members'
};

// Матрица прав по ролям
const ROLE_PERMISSIONS = {
  [ROLES.OWNER]: Object.values(PERMISSIONS),
  
  [ROLES.ADMIN]: [
    PERMISSIONS.SEND_MESSAGE,
    PERMISSIONS.EDIT_MESSAGE,
    PERMISSIONS.DELETE_MESSAGE,
    PERMISSIONS.PIN_MESSAGE,
    PERMISSIONS.REACT,
    PERMISSIONS.REPLY,
    PERMISSIONS.ADD_MEMBER,
    PERMISSIONS.REMOVE_MEMBER,
    PERMISSIONS.BAN_MEMBER,
    PERMISSIONS.KICK,
    PERMISSIONS.EDIT_INFO,
    PERMISSIONS.VIEW_HISTORY,
    PERMISSIONS.VIEW_MEMBERS
  ],
  
  [ROLES.MODERATOR]: [
    PERMISSIONS.SEND_MESSAGE,
    PERMISSIONS.EDIT_MESSAGE,
    PERMISSIONS.DELETE_MESSAGE,
    PERMISSIONS.PIN_MESSAGE,
    PERMISSIONS.REACT,
    PERMISSIONS.REPLY,
    PERMISSIONS.REMOVE_MEMBER,
    PERMISSIONS.KICK,
    PERMISSIONS.VIEW_HISTORY,
    PERMISSIONS.VIEW_MEMBERS
  ],
  
  [ROLES.MEMBER]: [
    PERMISSIONS.SEND_MESSAGE,
    PERMISSIONS.EDIT_MESSAGE,
    PERMISSIONS.REACT,
    PERMISSIONS.REPLY,
    PERMISSIONS.VIEW_HISTORY,
    PERMISSIONS.VIEW_MEMBERS
  ]
};

function hasPermission(role, permission) {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) || false;
}

async function getUserRoleInChat(userId, chatId) {
  const res = await query(
    'SELECT role FROM chat_members WHERE user_id = $1 AND chat_id = $2',
    [userId, chatId]
  );
  return res.rows[0]?.role || null;
}

async function isChatMember(chatId, userId) {
  const res = await query(
    'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, userId]
  );
  return res.rows.length > 0;
}

async function checkPermission(userId, chatId, permission) {
  const role = await getUserRoleInChat(userId, chatId);
  return hasPermission(role, permission);
}

async function promoteToAdmin(chatId, userId, actorId) {
  const actorRole = await getUserRoleInChat(actorId, chatId);
  if (actorRole !== ROLES.OWNER) {
    throw new Error('Only owner can promote to admin');
  }
  
  await query(
    'UPDATE chat_members SET role = $1 WHERE chat_id = $2 AND user_id = $3',
    [ROLES.ADMIN, chatId, userId]
  );
}

async function demoteFromAdmin(chatId, userId, actorId) {
  const actorRole = await getUserRoleInChat(actorId, chatId);
  if (actorRole !== ROLES.OWNER) {
    throw new Error('Only owner can demote admin');
  }
  
  await query(
    'UPDATE chat_members SET role = $1 WHERE chat_id = $2 AND user_id = $3',
    [ROLES.MEMBER, chatId, userId]
  );
}

async function kickUser(chatId, userId, actorId) {
  const actorRole = await getUserRoleInChat(actorId, chatId);
  if (!hasPermission(actorRole, PERMISSIONS.KICK)) {
    throw new Error('Insufficient permissions to kick');
  }
  
  const targetRole = await getUserRoleInChat(userId, chatId);
  if (targetRole === ROLES.OWNER) {
    throw new Error('Cannot kick the owner');
  }
  if (targetRole === ROLES.ADMIN && actorRole !== ROLES.OWNER) {
    throw new Error('Only owner can kick admins');
  }
  
  await query(
    'DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, userId]
  );
}

async function banUser(chatId, userId, actorId) {
  const actorRole = await getUserRoleInChat(actorId, chatId);
  if (!hasPermission(actorRole, PERMISSIONS.BAN_MEMBER)) {
    throw new Error('Insufficient permissions to ban');
  }
  
  await kickUser(chatId, userId, actorId);
}

module.exports = {
  ROLES,
  PERMISSIONS,
  hasPermission,
  getUserRoleInChat,
  isChatMember,
  checkPermission,
  promoteToAdmin,
  demoteFromAdmin,
  kickUser,
  banUser
};
