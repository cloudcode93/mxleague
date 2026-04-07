// ============================================
// MX League — Auth Helpers (JWT + bcrypt)
// ============================================
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
}
const JWT_EXPIRES_IN = '7d';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Fastify preHandler hook — protects admin routes
async function requireAdmin(request, reply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
  request.admin = decoded;
}

// Fastify preHandler hook — strict protection for Super Admin routes
async function requireSuperAdmin(request, reply) {
  await requireAdmin(request, reply);
  // Ensure the request wasn't already rejected locally by requireAdmin
  if (reply.sent) return;

  if (request.admin.role !== 'super_admin') {
    return reply.status(403).send({ error: 'Forbidden: Super Admin access required' });
  }
}

module.exports = { signToken, verifyToken, comparePassword, requireAdmin, requireSuperAdmin };
