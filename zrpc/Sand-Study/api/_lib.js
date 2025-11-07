const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:example@example.com';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || '';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch (err) {
    console.error('web-push setVapidDetails failed:', err && err.message);
  }
} else {
  console.warn('VAPID keys not set in env; push sending will fail until configured.');
}

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err && err.message);
  }
} else {
  console.warn('Supabase not configured (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing); subscription persistence disabled.');
}

function idFromEndpoint(endpoint) {
  return crypto.createHash('sha256').update(String(endpoint)).digest('hex');
}

function _extractTokenFromReq(req){
  if(!req || !req.headers) return '';
  const auth = req.headers.authorization || req.headers['x-api-key'] || req.headers['X-API-KEY'] || '';
  if(!auth) return '';
  if(typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')){
    return auth.slice(7).trim();
  }
  return String(auth).trim();
}

function requireAdminAuth(req, res){
  if(!ADMIN_API_TOKEN){
    console.warn('ADMIN_API_TOKEN not configured; rejecting admin request');
    if(res && typeof res.status === 'function') return res.status(403).json({ error: 'admin token not configured' });
    return false;
  }
  const tok = _extractTokenFromReq(req);
  if(!tok || tok !== ADMIN_API_TOKEN){
    if(res && typeof res.status === 'function') return res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

module.exports = {
  webpush,
  supabase,
  idFromEndpoint,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  ADMIN_API_TOKEN,
  requireAdminAuth,
};

