const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { findUserByUsername, createUser, findUserById, setTwoFactorSecret, getTwoFactorSecret, enableTwoFactor, disableTwoFactor } = require('./data');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

async function register(username, password, email) {
  if (!username || !password) throw new Error('Username and password required');
  const existing = findUserByUsername(username);
  if (existing) throw new Error('Username already exists');
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    username,
    email: email || '',
    passwordHash: hashedPassword,
    avatar: `https://ui-avatars.com/api/?name=${username}&background=7a5cff&color=fff`,
    bio: '',
    twoFactorEnabled: false,
    devices: [],
    createdAt: new Date().toISOString()
  };
  createUser(user);
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  return { user: { id: user.id, username: user.username, avatar: user.avatar, email: user.email, bio: user.bio }, token };
}

async function login(username, password) {
  if (!username || !password) throw new Error('Username and password required');
  const user = findUserByUsername(username);
  if (!user) throw new Error('Invalid credentials');
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) throw new Error('Invalid credentials');
  if (user.twoFactorEnabled) {
    return { twoFactorRequired: true, userId: user.id };
  }
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  return { user: { id: user.id, username: user.username, avatar: user.avatar, email: user.email, bio: user.bio }, token };
}

async function verifyTwoFactor(userId, token) {
  const secret = getTwoFactorSecret(userId);
  if (!secret) return null;
  const verified = speakeasy.totp.verify({ secret, encoding: 'base32', token });
  if (verified) {
    const user = findUserById(userId);
    const jwtToken = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    return { user: { id: user.id, username: user.username, avatar: user.avatar, email: user.email, bio: user.bio }, token: jwtToken };
  }
  return null;
}

async function generateTwoFactorSecret(userId) {
  const secret = speakeasy.generateSecret({ length: 20 });
  setTwoFactorSecret(userId, secret.base32);
  const otpauthUrl = secret.otpauth_url;
  const qrCode = await QRCode.toDataURL(otpauthUrl);
  return { secret: secret.base32, qrCode };
}

async function enableTwoFactorForUser(userId, token) {
  const secret = getTwoFactorSecret(userId);
  if (!secret) throw new Error('No secret generated');
  const verified = speakeasy.totp.verify({ secret, encoding: 'base32', token });
  if (verified) {
    enableTwoFactor(userId);
    return true;
  }
  return false;
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = { register, login, verifyTwoFactor, generateTwoFactorSecret, enableTwoFactorForUser, verifyToken };

