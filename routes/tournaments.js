// ============================================
// MX League — Tournament Routes
// ============================================
const supabase = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

async function tournamentRoutes(fastify) {
  // GET /api/tournaments — Public (optional ?status= filter)
  fastify.get('/', async (request, reply) => {
    let query = supabase.from('tournaments').select('*');
    
    const { status } = request.query;
    if (status) {
      query = query.eq('status', status);
    }

    query = query.order('date', { ascending: false, nullsFirst: false });

    const { data, error } = await query;
    if (error) {
      return reply.status(500).send({ error: 'Failed to load tournaments' });
    }
    return data;
  });

  // GET /api/tournaments/:id — Public
  fastify.get('/:id', async (request, reply) => {
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', request.params.id)
      .single();

    if (error || !data) {
      return reply.status(404).send({ error: 'Tournament not found' });
    }
    return data;
  });

  // POST /api/tournaments — Admin only
  fastify.post('/', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { name, mode, date, time, entry_fee, prize_pool, max_teams, status } = request.body || {};

    if (!name) {
      return reply.status(400).send({ error: 'Tournament name is required' });
    }

    const { data, error } = await supabase
      .from('tournaments')
      .insert({
        name,
        mode: mode || 'Squad',
        date: date || null,
        time: time || null,
        entry_fee: parseInt(entry_fee) || 0,
        prize_pool: parseInt(prize_pool) || 0,
        max_teams: parseInt(max_teams) || 13,
        status: status || 'upcoming',
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      return reply.status(500).send({ error: 'Failed to create tournament' });
    }
    return data;
  });

  // PUT /api/tournaments/:id — Admin only
  fastify.put('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { name, mode, date, time, entry_fee, prize_pool, max_teams, status } = request.body || {};

    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (mode !== undefined) updates.mode = mode;
    if (date !== undefined) updates.date = date;
    if (time !== undefined) updates.time = time;
    if (entry_fee !== undefined) updates.entry_fee = parseInt(entry_fee) || 0;
    if (prize_pool !== undefined) updates.prize_pool = parseInt(prize_pool) || 0;
    if (max_teams !== undefined) updates.max_teams = parseInt(max_teams) || 13;
    if (status !== undefined) updates.status = status;

    const { data, error } = await supabase
      .from('tournaments')
      .update(updates)
      .eq('id', request.params.id)
      .select()
      .single();

    if (error) {
      return reply.status(500).send({ error: 'Failed to update tournament' });
    }
    return data;
  });

  // DELETE /api/tournaments/:id — Admin only
  fastify.delete('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { error } = await supabase
      .from('tournaments')
      .delete()
      .eq('id', request.params.id);

    if (error) {
      return reply.status(500).send({ error: 'Failed to delete tournament' });
    }
    return { success: true };
  });
}

module.exports = tournamentRoutes;
