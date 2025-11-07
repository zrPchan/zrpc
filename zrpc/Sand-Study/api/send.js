const { supabase, webpush, requireAdminAuth } = require('./_lib');
const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  // Require admin auth for send endpoint
  const ok = requireAdminAuth(req, res);
  if(!ok) return; // response already sent
  try {
    const { id, endpoint, payload } = req.body || {};
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured (SUPABASE_URL / SERVICE_ROLE_KEY missing)' });
    const sendPayload = typeof payload === 'string' ? payload : JSON.stringify(payload || { title: 'Timer', body: '⏰ Timer ended' });

    const sendToSub = async (sub, id) => {
      try {
        await webpush.sendNotification(sub, sendPayload);
        return { ok: true };
      } catch (err) {
        // web-push errors often include statusCode and body
        const statusCode = err && err.statusCode;
        const body = err && (err.body || err.message || String(err));
        console.error('web-push send error:', { statusCode, body });
        // If the subscription is gone (410) or invalid (404), remove it from DB
        if ((statusCode === 410 || statusCode === 404) && id && supabase) {
          try {
            const { error: delErr } = await supabase.from('subscriptions').delete().eq('id', id);
            if (delErr) {
              console.error('auto-delete subscription failed for id', id, delErr);
            } else {
              console.info('auto-deleted subscription id', id);
            }
          } catch (e) {
            console.error('auto-delete subscription exception for id', id, e && e.stack || e);
          }
        }
        return { ok: false, error: String(err), statusCode, body };
      }
    };

    if (id || endpoint) {
      const key = id || (endpoint && crypto.createHash('sha256').update(String(endpoint)).digest('hex'));
      const { data, error } = await supabase.from('subscriptions').select('subscription').eq('id', key).single();
      if (error || !data) return res.status(404).json({ error: 'subscription not found' });
      const result = await sendToSub(data.subscription, key);
      return res.status(200).json({ results: [result] });
    }

    // send to all
    const results = [];
    const { data, error } = await supabase.from('subscriptions').select('*');
    if (error) {
      console.error('supabase select error:', error);
      return res.status(500).json({ error: String(error) });
    }
    for (const it of data || []) {
      if (it.subscription) {
        const r = await sendToSub(it.subscription, it.id);
        results.push({ id: it.id, ...r });
      }
    }
    return res.status(200).json({ results });
  } catch (err) {
    console.error('send error:', err && err.stack || err);
    return res.status(500).json({ error: String(err) });
  }
};
