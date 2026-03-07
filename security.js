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
  PROMOTE: 'promote',
  KICK: 'kick',
  EDIT_INFO: 'edit_info',
  DELETE_CHAT: 'delete_chat',
  CHANGE_PERMISSIONS: 'change_permissions',
  VIEW_HISTORY: 'view_history'
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
    PERMISSIONS.EDIT_INFO
  ],
  [ROLES.MODERATOR]: [
    PERMISSIONS.SEND_MESSAGE,
    PERMISSIONS.EDIT_MESSAGE,
    PERMISSIONS.DELETE_MESSAGE,
    PERMISSIONS.PIN_MESSAGE,
    PERMISSIONS.REACT,
    PERMISSIONS.REPLY,
    PERMISSIONS.REMOVE_MEMBER,
    PERMISSIONS.KICK
  ],
  [ROLES.MEMBER]: [
    PERMISSIONS.SEND_MESSAGE,
    PERMISSIONS.EDIT_MESSAGE,
    PERMISSIONS.REACT,
    PERMISSIONS.REPLY
  ]
};

/**
 * Проверяет, имеет ли роль указанное право
 * @param {string} role
 * @param {string} permission
 * @returns {boolean}
 */
function hasPermission(role, permission) {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) || false;
}

/**
 * Получает роль пользователя в чате
 * @param {string} userId
 * @param {string} chatId
 * @returns {Promise<string|null>}
 */
async function getUserRoleInChat(userId, chatId) {
  const res = await query(
    'SELECT role FROM chat_members WHERE user_id = $1 AND chat_id = $2',
    [userId, chatId]
  );
  return res.rows[0]?.role || null;
}

/**
 * Проверяет, является ли пользователь участником чата
 * @param {string} chatId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isChatMember(chatId, userId) {
  const res = await query(
    'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, userId]
  );
  return res.rows.length > 0;
}

/**
 * Проверяет, имеет ли пользователь право на действие в чате
 * @param {string} userId
 * @param {string} chatId
 * @param {string} permission
 * @returns {Promise<boolean>}
 */
async function checkPermission(userId, chatId, permission) {
  const role = await getUserRoleInChat(userId, chatId);
  return hasPermission(role, permission);
}

module.exports = {
  ROLES,
  PERMISSIONS,
  hasPermission,
  getUserRoleInChat,
  isChatMember,
  checkPermission
};
