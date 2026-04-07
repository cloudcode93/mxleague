// ============================================
// MX League — Dashboard Stats Route (Optimized)
// ============================================
const os = require('os'); // Hoisted
const supabase = require('../lib/supabase');
const cache = require('../lib/cache');
const { requireAdmin } = require('../lib/auth');

async function dashboardRoutes(fastify) {
  // GET /api/dashboard/stats — Admin only (cached 15s)
  fastify.get('/stats', { preHandler: [requireAdmin] }, async (request, reply) => {
    const cached = cache.get('dash:stats');
    if (cached) return cached;

    try {
      const [tournamentsRes, completedRes, regsRes, approvedRes, imagesRes] = await Promise.all([
        supabase.from('tournaments').select('*', { count: 'exact', head: true }),
        supabase.from('tournaments').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
        supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
        supabase.from('registrations').select('*', { count: 'exact', head: true }).not('screenshot_url', 'is', null)
      ]);

      const result = {
        tournaments: tournamentsRes.count || 0,
        completed: completedRes.count || 0,
        pending: regsRes.count || 0,
        teams: approvedRes.count || 0,
        images: imagesRes.count || 0
      };

      cache.set('dash:stats', result, 15);
      return result;
    } catch (err) {
      console.error('Dashboard stats error:', err);
      return reply.status(500).send({ error: 'Failed to load stats' });
    }
  });

  // CPU load tracking (continuous, zero-cost)
  let lastCpuInfo = { idle: 0, total: 0 };

  function updateCpuLoad() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        total += cpu.times[type];
      }
      idle += cpu.times.idle;
    });

    if (lastCpuInfo.total === 0) {
      lastCpuInfo = { idle, total };
      return 0;
    }

    const idleDiff = idle - lastCpuInfo.idle;
    const totalDiff = total - lastCpuInfo.total;
    lastCpuInfo = { idle, total };

    if (totalDiff === 0) return 0;
    return 100 - ((idleDiff / totalDiff) * 100);
  }

  // GET /api/dashboard/system — Admin only (cached 10s + stale fallback)
  fastify.get('/system', { preHandler: [requireAdmin] }, async (request, reply) => {
    const cached = cache.get('dash:system');
    if (cached) return cached;

    try {
      // Fire all DB queries in parallel
      const [allRes, allApprovedRes, allRejectedRes, dbPingRes, tournsRes, approvedRegsList] = await Promise.all([
        supabase.from('registrations').select('*', { count: 'exact', head: true }),
        supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
        supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('status', 'rejected'),
        (async () => {
          return new Promise((resolve) => {
            const net = require('net');
            const start = Date.now();
            const host = process.env.SUPABASE_URL.replace('https://', '').replace('/', '');
            const socket = new net.Socket();
            socket.setTimeout(2500);
            
            socket.on('connect', () => {
              const latency = Date.now() - start;
              socket.destroy();
              resolve({ status: 'connected', latency });
            });
            
            socket.on('timeout', () => {
              socket.destroy();
              resolve({ status: 'timeout', latency: 0 });
            });
            
            socket.on('error', () => {
              resolve({ status: 'disconnected', latency: 0 });
            });
            
            socket.connect(443, host);
          });
        })(),
        supabase.from('tournaments').select('id, entry_fee, prize_pool, status'),
        supabase.from('registrations').select('tournament_id').eq('status', 'approved')
      ]);

      const tournamentsArray = tournsRes.data || [];
      const approvedArray = approvedRegsList.data || [];

      let totalRevenue = 0;
      let totalPrize = 0;
      let liveCount = 0;
      let completedCount = 0;
      
      const feeMap = {};
      tournamentsArray.forEach(t => { 
        feeMap[t.id] = t.entry_fee || 0; 
        totalPrize += (t.prize_pool || 0);
        if (t.status === 'live') liveCount++;
        if (t.status === 'completed') completedCount++;
      });

      approvedArray.forEach(r => {
        totalRevenue += (feeMap[r.tournament_id] || 0);
      });

      const totalRegistrations = allRes.count || 0;
      const approvedCount = allApprovedRes.count || 0;
      const rejectedCount = allRejectedRes.count || 0;
      const approvalRatio = totalRegistrations > 0 ? ((approvedCount / totalRegistrations) * 100).toFixed(1) : 0;
      const rejectionRatio = totalRegistrations > 0 ? ((rejectedCount / totalRegistrations) * 100).toFixed(1) : 0;

      const memTotal = os.totalmem();
      const memFree = os.freemem();
      const memUsed = memTotal - memFree;
      const cpus = os.cpus();
      const procMem = process.memoryUsage();

      const responseData = {
        server: {
          uptime: process.uptime(),
          os_uptime: os.uptime(),
          node_version: process.version,
          platform: os.platform(),
          cpu_cores: cpus.length,
          cpu_model: cpus[0].model,
          cpu_usage_percent: updateCpuLoad().toFixed(1),
          memory_total_gb: (memTotal / (1024 ** 3)).toFixed(2),
          memory_used_gb: (memUsed / (1024 ** 3)).toFixed(2),
          memory_usage_percent: ((memUsed / memTotal) * 100).toFixed(1),
          process_ram_mb: (procMem.rss / (1024 ** 2)).toFixed(1)
        },
        database: {
          status: dbPingRes.status,
          latency_ms: dbPingRes.latency,
          total_tournaments: tournamentsArray.length,
          active_tournaments: liveCount,
          completed_tournaments: completedCount
        },
        analytics: {
          total_registrations: totalRegistrations,
          approved: approvedCount,
          rejected: rejectedCount,
          approval_ratio_percent: approvalRatio,
          rejection_ratio_percent: rejectionRatio,
          conversion_rate: approvalRatio,
          total_revenue: totalRevenue,
          total_prize_pool: totalPrize,
          net_profit: (totalRevenue - totalPrize)
        }
      };

      cache.set('dash:system', responseData, 10);
      return responseData;
    } catch (err) {
      console.error('System dashboard error:', err);
      // Return stale cache on error
      const stale = cache.get('dash:system');
      if (stale) return stale;
      return reply.status(500).send({ error: 'Failed to load system metrics' });
    }
  });
}

module.exports = dashboardRoutes;
