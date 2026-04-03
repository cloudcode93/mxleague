// ============================================
// MX League — Dashboard Stats Route
// ============================================
const supabase = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

async function dashboardRoutes(fastify) {
  // GET /api/dashboard/stats — Admin only
  fastify.get('/stats', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const [tournamentsRes, completedRes, regsRes, approvedRes, imagesRes] = await Promise.all([
        supabase.from('tournaments').select('*', { count: 'exact', head: true }),
        supabase.from('tournaments').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
        supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
        supabase.from('registrations').select('*', { count: 'exact', head: true }).not('screenshot_url', 'is', null)
      ]);

      return {
        tournaments: tournamentsRes.count || 0,
        completed: completedRes.count || 0,
        pending: regsRes.count || 0,
        teams: approvedRes.count || 0,
        images: imagesRes.count || 0
      };
    } catch (err) {
      console.error('Dashboard stats error:', err);
      return reply.status(500).send({ error: 'Failed to load stats' });
    }
  });
  // Helper to calculate exact CPU percentage for cross-platform (especially Windows)
  const os = require('os');
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

    // on very first call, we might not have a reliable diff, so we just seed it.
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

  // GET /api/dashboard/system — Admin only (System & Analytics)
  fastify.get('/system', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      // Calculate advanced metrics globally with exact counts
      const [allRes, allApprovedRes, allRejectedRes] = await Promise.all([
        supabase.from('registrations').select('*', { count: 'exact', head: true }),
        supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
        supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('status', 'rejected')
      ]);

      const totalRegistrations = allRes.count || 0;
      const approvedCount = allApprovedRes.count || 0;
      const rejectedCount = allRejectedRes.count || 0;
      const approvalRatio = totalRegistrations > 0 ? ((approvedCount / totalRegistrations) * 100).toFixed(1) : 0;
      const rejectionRatio = totalRegistrations > 0 ? ((rejectedCount / totalRegistrations) * 100).toFixed(1) : 0;

      // Check DB Ping for admin panel indicator
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

      // Memory Usage
      const memTotal = os.totalmem();
      const memFree = os.freemem();
      const memUsed = memTotal - memFree;
      const memUsagePercent = ((memUsed / memTotal) * 100).toFixed(1);

      // CPU Usage (Cross-Platform) calculation
      const cpus = os.cpus();
      const currentCpuPercent = updateCpuLoad();

      return {
        server: {
          uptime: process.uptime(),
          os_uptime: os.uptime(),
          cpu_cores: cpus.length,
          cpu_model: cpus[0].model,
          cpu_usage_percent: currentCpuPercent.toFixed(1),
          memory_total_gb: (memTotal / (1024 ** 3)).toFixed(2),
          memory_used_gb: (memUsed / (1024 ** 3)).toFixed(2),
          memory_usage_percent: memUsagePercent
        },
        database: {
          status: dbStatus,
          latency_ms: dbLatency
        },
        analytics: {
          total_registrations: totalRegistrations,
          approved: approvedCount,
          rejected: rejectedCount,
          approval_ratio_percent: approvalRatio,
          rejection_ratio_percent: rejectionRatio,
          conversion_rate: approvalRatio // commonly used terminology
        }
      };
    } catch (err) {
      console.error('System dashboard error:', err);
      return reply.status(500).send({ error: 'Failed to load system metrics' });
    }
  });
}

module.exports = dashboardRoutes;
