// ============================================
// MX League — Registration Routes (Optimized)
// ============================================
const supabase = require('../lib/supabase');
const cache = require('../lib/cache');
const { requireAdmin } = require('../lib/auth');

// Pre-compiled regex — never re-create on each request
const WHATSAPP_RE = /^\d{10,15}$/;
const CLOUDINARY_RE = /^https:\/\/res\.cloudinary\.com\//;
const STRIP_TAGS_RE = /<[^>]*>/g;
const sanitize = (str) => String(str).replace(STRIP_TAGS_RE, '').trim();

async function registrationRoutes(fastify) {
  // GET /api/registrations — Admin only (optional ?tournamentId= filter)
  fastify.get('/', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      let query = supabase.from('registrations')
        .select('id, tournament_id, team_name, whatsapp, players, screenshot_url, status, created_at');

      const { tournamentId } = request.query;
      if (tournamentId) {
        query = query.eq('tournament_id', tournamentId);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) {
        console.error('Load registrations error:', error);
        return reply.status(500).send({ error: 'Failed to load registrations' });
      }
      return data || [];
    } catch (err) {
      console.error('Registrations GET exception:', err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/registrations/count/:tournamentId — Public (cached 20s)
  fastify.get('/count/:tournamentId', async (request, reply) => {
    const tid = request.params.tournamentId;
    const cacheKey = `regcount:${tid}`;

    const cached = cache.get(cacheKey);
    if (cached !== null) return cached;

    try {
      const { count, error } = await supabase
        .from('registrations')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tid)
        .eq('status', 'approved');

      if (error) {
        console.error('Count error:', error);
        return reply.status(500).send({ error: 'Failed to get count' });
      }

      const result = { count: count || 0 };
      cache.set(cacheKey, result, 20);
      return result;
    } catch (err) {
      console.error('Count exception:', err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/registrations — Public (submit registration)
  fastify.post('/', async (request, reply) => {
    try {
      const { tournament_id, team_name, whatsapp, players, screenshot_url, screenshot_public_id } = request.body || {};

      // Input Validation
      if (!tournament_id || !team_name || !whatsapp || !players || !Array.isArray(players) || players.length < 4) {
        return reply.status(400).send({ error: 'All fields are required (tournament_id, team_name, whatsapp, 4 players)' });
      }

      const cleanTeamName = sanitize(team_name);
      const cleanWhatsapp = sanitize(whatsapp);
      const cleanPlayers = players.map(p => sanitize(p));

      if (cleanTeamName.length < 2 || cleanTeamName.length > 50) {
        return reply.status(400).send({ error: 'Team name must be 2-50 characters' });
      }

      if (!WHATSAPP_RE.test(cleanWhatsapp)) {
        return reply.status(400).send({ error: 'Invalid WhatsApp number (10-15 digits only)' });
      }

      if (cleanPlayers.some(p => p.length < 1 || p.length > 30)) {
        return reply.status(400).send({ error: 'Player names must be 1-30 characters each' });
      }

      // Fire both DB lookups in parallel instead of sequentially
      const [tournamentResult, countResult] = await Promise.all([
        supabase.from('tournaments')
          .select('id, status, max_teams')
          .eq('id', tournament_id)
          .single(),
        supabase.from('registrations')
          .select('*', { count: 'exact', head: true })
          .eq('tournament_id', tournament_id)
          .eq('status', 'approved')
      ]);

      const { data: tournament, error: tErr } = tournamentResult;
      if (tErr || !tournament) {
        return reply.status(404).send({ error: 'Tournament not found' });
      }

      if (tournament.status !== 'upcoming') {
        return reply.status(400).send({ error: 'This tournament is not accepting registrations' });
      }

      if ((countResult.count || 0) >= (tournament.max_teams || 13)) {
        return reply.status(400).send({ error: 'Tournament is full' });
      }

      // Validate screenshot_url
      let safeScreenshotUrl = null;
      let safePublicId = null;
      if (screenshot_url) {
        if (!CLOUDINARY_RE.test(screenshot_url)) {
          return reply.status(400).send({ error: 'Invalid screenshot URL' });
        }
        safeScreenshotUrl = screenshot_url;
        safePublicId = screenshot_public_id || null;
      }

      const { data, error } = await supabase
        .from('registrations')
        .insert({
          tournament_id,
          team_name: cleanTeamName,
          whatsapp: cleanWhatsapp,
          players: cleanPlayers,
          screenshot_url: safeScreenshotUrl,
          screenshot_public_id: safePublicId,
          status: 'pending'
        })
        .select()
        .single();

      if (error) {
        console.error('Registration insert error:', error);
        return reply.status(500).send({ error: 'Failed to submit registration' });
      }

      // Bust count cache for this tournament
      cache.invalidate(`regcount:${tournament_id}`);
      cache.invalidate('dash');
      return data;
    } catch (err) {
      console.error('Registration POST exception:', err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/registrations/:id/approve — Admin only
  fastify.put('/:id/approve', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const regId = request.params.id;

      // Fire both lookups in parallel
      const { data: reg, error: regErr } = await supabase
        .from('registrations')
        .select('tournament_id')
        .eq('id', regId)
        .single();

      if (regErr || !reg) {
        return reply.status(404).send({ error: 'Registration not found' });
      }

      // Fire tournament + count in parallel
      const [tournamentResult, countResult] = await Promise.all([
        supabase.from('tournaments').select('max_teams').eq('id', reg.tournament_id).single(),
        supabase.from('registrations').select('*', { count: 'exact', head: true })
          .eq('tournament_id', reg.tournament_id).eq('status', 'approved')
      ]);

      const maxTeams = tournamentResult.data?.max_teams || 13;
      if ((countResult.count || 0) >= maxTeams) {
        return reply.status(400).send({ error: 'Tournament is full! Cannot approve.' });
      }

      const { data, error } = await supabase
        .from('registrations')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString()
        })
        .eq('id', regId)
        .select()
        .single();

      if (error) {
        return reply.status(500).send({ error: 'Failed to approve registration' });
      }

      cache.invalidate(`regcount:${reg.tournament_id}`);
      cache.invalidate('dash');
      return data;
    } catch (err) {
      console.error('Approve exception:', err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/registrations/:id/reject — Admin only
  fastify.put('/:id/reject', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const { data, error } = await supabase
        .from('registrations')
        .update({
          status: 'rejected',
          rejected_at: new Date().toISOString()
        })
        .eq('id', request.params.id)
        .select()
        .single();

      if (error) {
        return reply.status(500).send({ error: 'Failed to reject registration' });
      }

      cache.invalidate('dash');
      return data;
    } catch (err) {
      console.error('Reject exception:', err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/registrations/:id/screenshot — Admin only
  fastify.delete('/:id/screenshot', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const { error } = await supabase
        .from('registrations')
        .update({ screenshot_url: null, screenshot_public_id: null })
        .eq('id', request.params.id);

      if (error) {
        return reply.status(500).send({ error: 'Failed to remove screenshot reference' });
      }
      return { success: true };
    } catch (err) {
      console.error('Delete screenshot exception:', err);
      return reply.status(500).send({ error: err.message });
    }
  });
}

module.exports = registrationRoutes;
