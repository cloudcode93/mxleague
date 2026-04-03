//============================================
// MX League — Fastify Server Entry Point
// ============================================
require('dotenv').config();

const path = require('path');
const isProduction = process.env.NODE_ENV === 'production';
const fastify = require('fastify')({ logger: isProduction ? { level: 'warn' } : true });

async function start() {
  // CORS — explicitly allow all methods and headers
  await fastify.register(require('@fastify/cors'), {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
  });

  // Security headers
  await fastify.register(require('@fastify/helmet'), {
    contentSecurityPolicy: false  // Disabled since we serve HTML with inline styles
  });

  // Multipart for file uploads
  await fastify.register(require('@fastify/multipart'), {
    limits: {
      fileSize: 5 * 1024 * 1024 // 5 MB
    }
  });

  // Serve frontend static files (parent directory)
  await fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, '..'),
    prefix: '/'
  });

  // Global error handler — log all errors
  fastify.setErrorHandler((error, request, reply) => {
    console.error('❌ Unhandled error:', error.message);
    console.error('   Route:', request.method, request.url);
    console.error('   Stack:', error.stack);
    reply.status(error.statusCode || 500).send({
      error: error.message || 'Internal Server Error'
    });
  });

  // Rate Limiting — protect against brute-force and spam
  await fastify.register(require('@fastify/rate-limit'), {
    global: false // only apply to specific routes
  });

  // Register API routes
  fastify.register(require('./routes/auth'), {
    prefix: '/api/auth',
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }  // 5 login attempts/min
  });
  fastify.register(require('./routes/settings'), { prefix: '/api/settings' });
  fastify.register(require('./routes/tournaments'), { prefix: '/api/tournaments' });
  fastify.register(require('./routes/registrations'), {
    prefix: '/api/registrations',
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } } // 10 reg requests/min
  });
  fastify.register(require('./routes/results'), { prefix: '/api/results' });
  fastify.register(require('./routes/upload'), { 
    prefix: '/api/upload',
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  });
  fastify.register(require('./routes/dashboard'), { prefix: '/api/dashboard' });
  fastify.register(require('./routes/staff'), { prefix: '/api/staff' });
  fastify.register(require('./routes/team'), { prefix: '/api/team' });

  // Health check
  fastify.get('/api/health', async (request, reply) => {
    const os = require('os');
    const supabase = require('./lib/supabase');
    
    // Check DB Ping
    const start = Date.now();
    let dbStatus = 'disconnected';
    let dbLatency = 0;
    try {
      const { error } = await supabase.from('settings').select('id').limit(1);
      if (!error) {
        dbStatus = 'connected';
        dbLatency = Date.now() - start;
      }
    } catch (e) {
      dbStatus = 'error';
    }

    return {
      status: 'ok',
      time: new Date().toISOString(),
      uptime: process.uptime(),
      db: { status: dbStatus, latency_ms: dbLatency },
      memory: {
        free: os.freemem(),
        total: os.totalmem(),
        usage_percent: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(2) + '%'
      }
    };
  });

  // Start server
  const port = process.env.PORT || 3000;
  try {
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`\n🎮 MX League API running on http://localhost:${port}\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
