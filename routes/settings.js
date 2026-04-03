// ============================================
// MX League — Settings Routes
// ============================================
const supabase = require('../lib/supabase');
const { requireAdmin, requireSuperAdmin } = require('../lib/auth');

async function settingsRoutes(fastify) {
  // GET /api/settings — Public
  fastify.get('/', async (request, reply) => {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .eq('id', 1)
        .single();

      if (error) {
        console.error('Settings GET error:', error);
        return reply.status(500).send({ error: 'Failed to load settings' });
      }
      return data || {};
    } catch (err) {
      console.error('Settings GET exception:', err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/settings — Super Admin only
  fastify.put('/', { preHandler: [requireSuperAdmin] }, async (request, reply) => {
    try {
      const body = request.body || {};
      console.log('Settings PUT body:', JSON.stringify(body));

      const updates = { updated_at: new Date().toISOString() };
      if (body.upi_id !== undefined) updates.upi_id = body.upi_id;
      if (body.apk_download_link !== undefined) updates.apk_download_link = body.apk_download_link;
      if (body.qr_image_url !== undefined) updates.qr_image_url = body.qr_image_url;
      if (body.about_text !== undefined) updates.about_text = body.about_text;
      if (body.social_youtube !== undefined) updates.social_youtube = body.social_youtube;
      if (body.social_whatsapp !== undefined) updates.social_whatsapp = body.social_whatsapp;
      if (body.social_discord !== undefined) updates.social_discord = body.social_discord;
      if (body.social_instagram !== undefined) updates.social_instagram = body.social_instagram;

      console.log('Settings updates:', JSON.stringify(updates));

      const { data, error } = await supabase
        .from('settings')
        .update(updates)
        .eq('id', 1)
        .select()
        .single();

      if (error) {
        console.error('Supabase settings update error:', JSON.stringify(error));
        return reply.status(500).send({ error: 'Failed to update settings: ' + error.message });
      }
      console.log('Settings updated OK:', JSON.stringify(data));
      return data;
    } catch (err) {
      console.error('Settings PUT exception:', err);
      return reply.status(500).send({ error: err.message });
    }
  });
}

module.exports = settingsRoutes;
