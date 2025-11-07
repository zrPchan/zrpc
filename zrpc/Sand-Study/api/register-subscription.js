const { supabase, idFromEndpoint } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  try {
    const sub = req.body;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: 'subscription missing' });
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured (SUPABASE_URL / SERVICE_ROLE_KEY missing)' });
    const id = idFromEndpoint(sub.endpoint);
    const { data, error } = await supabase.from('subscriptions').upsert([{ id, subscription: sub }]);
    if (error) {
      console.error('supabase upsert error:', error);
      return res.status(500).json({ error: String(error) });
    }
    return res.status(200).json({ ok: true, id });
  } catch (err) {
    console.error('register-subscription error:', err && err.stack || err);
    return res.status(500).json({ error: String(err) });
  }
};
