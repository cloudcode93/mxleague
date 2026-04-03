// ============================================
// MX League — Results Routes
// ============================================
const supabase = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

// Position points mapping (1st–13th)
const POSITION_POINTS = {
  1: 12, 2: 9, 3: 8, 4: 7, 5: 6,
  6: 5, 7: 4, 8: 3, 9: 2, 10: 1,
  11: 0, 12: 0, 13: 0
};

function calcPoints(kills, position) {
  const posPoints = POSITION_POINTS[position] || 0;
  return kills + posPoints;
}

async function resultsRoutes(fastify) {
  // GET /api/results/:tournamentId — Public
  fastify.get('/:tournamentId', async (request, reply) => {
    const { data, error } = await supabase
      .from('results')
      .select('*')
      .eq('tournament_id', request.params.tournamentId)
      .order('points', { ascending: false });

    if (error) {
      return reply.status(500).send({ error: 'Failed to load results' });
    }
    return data;
  });

  // POST /api/results/:tournamentId — Admin only (batch save/overwrite)
  fastify.post('/:tournamentId', { preHandler: [requireAdmin] }, async (request, reply) => {
    const tournamentId = request.params.tournamentId;
    const { results } = request.body || {};

    if (!results || !Array.isArray(results)) {
      return reply.status(400).send({ error: 'results array is required' });
    }

    // Delete existing results for this tournament
    const { error: delError } = await supabase
      .from('results')
      .delete()
      .eq('tournament_id', tournamentId);

    if (delError) {
      return reply.status(500).send({ error: 'Failed to clear old results' });
    }

    // Prepare new results with calculated points
    const rows = results.map(r => ({
      tournament_id: tournamentId,
      team_name: r.team_name,
      kills: parseInt(r.kills) || 0,
      position: parseInt(r.position) || 13,
      points: calcPoints(parseInt(r.kills) || 0, parseInt(r.position) || 13),
      updated_at: new Date().toISOString()
    }));

    const { data, error } = await supabase
      .from('results')
      .insert(rows)
      .select();

    if (error) {
      return reply.status(500).send({ error: 'Failed to save results' });
    }
    return data;
  });
}

module.exports = resultsRoutes;
