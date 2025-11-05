const { supabase, requireAdminAuth } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  // Require admin auth
  const ok = requireAdminAuth(req, res);
  if(!ok) return; // response handled by helper
    try {
      if (!supabase) return res.status(500).json({ error: 'Supabase not configured (SUPABASE_URL / SERVICE_ROLE_KEY missing)' });
      const { data, error } = await supabase.from('subscriptions').select('*');
      if (error) {
        console.error('supabase select error:', error);
        return res.status(500).json({ error: String(error) });
      }
      return res.status(200).json({ items: data || [] });
  } catch (err) {
    console.error('list-subscriptions error:', err && err.stack || err);
    return res.status(500).json({ error: String(err) });
  }
};
