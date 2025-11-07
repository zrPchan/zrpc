const express = require('express');
const bodyParser = require('body-parser');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

// Simple in-memory subscription store (for demo). Replace with DB for production.
const subscriptionsFile = path.join(__dirname, 'subscriptions.json');
let subscriptions = [];
try{ if(fs.existsSync(subscriptionsFile)){ subscriptions = JSON.parse(fs.readFileSync(subscriptionsFile)); } }catch(e){ subscriptions = []; }
function persist(){ try{ fs.writeFileSync(subscriptionsFile, JSON.stringify(subscriptions, null, 2)); }catch(e){ console.warn('persist failed', e); } }

// Load VAPID keys if present or instruct user to generate
let VAPID_PUBLIC = process.env.VAPID_PUBLIC || null;
let VAPID_PRIVATE = process.env.VAPID_PRIVATE || null;
if(!VAPID_PUBLIC || !VAPID_PRIVATE){
  // Try to load from file
  const keyFile = path.join(__dirname, 'vapid.json');
  console.log('Looking for VAPID key file at', keyFile);
  try{
    const exists = fs.existsSync(keyFile);
    console.log('vapid.json exists?', exists);
    if(exists){
      try{
        const raw = fs.readFileSync(keyFile, { encoding: 'utf8' });
        try{
          // Clean BOM or stray control characters before parsing
          const cleaned = (raw || '').replace(/^\uFEFF|^[\x00-\x1F]+/u, '').trim();
          try{
            const k = JSON.parse(cleaned);
            VAPID_PUBLIC = k.publicKey; VAPID_PRIVATE = k.privateKey;
            console.log('Loaded vapid.json: publicKey length=', (VAPID_PUBLIC||'').length);
          }catch(parseErr){
            console.error('Failed to parse vapid.json after cleaning:', parseErr);
            console.error('vapid.json cleaned raw (first 200 chars):', cleaned && cleaned.slice ? cleaned.slice(0,200) : cleaned);
          }
        }catch(innerErr){
          console.error('Unexpected error cleaning/parsing vapid.json:', innerErr);
        }
      }catch(readErr){
        console.error('Failed to read vapid.json:', readErr);
      }
    }
  }catch(e){ console.error('Error while checking vapid.json:', e); }
}
if(!VAPID_PUBLIC || !VAPID_PRIVATE){
  console.warn('VAPID keys not configured. Generate them with web-push generate-vapid-keys and place in server/vapid.json or set env VAPID_PUBLIC/VAPID_PRIVATE');
}

if(VAPID_PUBLIC && VAPID_PRIVATE){
  webpush.setVapidDetails('mailto:you@example.com', VAPID_PUBLIC, VAPID_PRIVATE);
  console.log('VAPID loaded (public key length:', (VAPID_PUBLIC||'').length, ')');
} else {
  console.log('VAPID not loaded at startup');
}

const app = express();
app.use(bodyParser.json());

// Serve static files from parent directory (Sand-Study root)
app.use(express.static(path.join(__dirname, '..'), { 
  index: 'index.html',  // explicitly serve index.html for directory requests
  extensions: ['html']   // auto-append .html to extensionless paths
}));

// Simple Basic Auth middleware for admin routes
function basicAuth(req, res, next){
  // allow disabling auth in local/dev by setting ADMIN_OFF=1
  if(process.env.ADMIN_OFF === '1') return next();
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASS || 'password';
  const auth = req.headers['authorization'];
  if(!auth){ res.setHeader('WWW-Authenticate','Basic realm="Admin"'); return res.status(401).send('Authentication required'); }
  const parts = auth.split(' ');
  if(parts.length !== 2 || parts[0] !== 'Basic') return res.status(400).send('Bad auth');
  const creds = Buffer.from(parts[1], 'base64').toString('utf8');
  const [u,p] = creds.split(':');
  if(u === user && p === pass) return next();
  res.setHeader('WWW-Authenticate','Basic realm="Admin"'); return res.status(401).send('Unauthorized');
}

// Admin UI
app.get('/admin', basicAuth, (req, res)=>{
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Return subscription list (protected)
app.get('/api/subscriptions', basicAuth, (req, res)=>{
  // Read subscriptions from file each time so admin UI reflects latest file without restart
  try{
    if(fs.existsSync(subscriptionsFile)){
      const data = JSON.parse(fs.readFileSync(subscriptionsFile));
      return res.json(data || []);
    }
  }catch(e){ console.warn('failed to read subscriptions file', e); }
  return res.json([]);
});

// Send to a single subscription (protected)
app.post('/api/send-to', basicAuth, async (req, res)=>{
  const { subscription, payload } = req.body || {};
  if(!subscription || !subscription.endpoint) return res.status(400).json({ok:false, msg:'invalid'});
  if(!VAPID_PUBLIC || !VAPID_PRIVATE) return res.status(500).json({ok:false, msg:'no vapid'});
  try{
    await webpush.sendNotification(subscription, JSON.stringify(payload || { title:'Sand Study', body:'時間です' }));
    res.json({ok:true});
  }catch(e){
    // Log additional details from web-push errors when available
    try{ console.error('send-to error statusCode=', e.statusCode, 'body=', e.body); }catch(_){ }
    try{
      const util = require('util');
      console.error('send-to full error object:', util.inspect(e, { depth: 5 }));
    }catch(_){ }
    console.error('send-to error:', e && e.stack ? e.stack : e);
    // If body is JSON, try to include parsed form
    let parsedBody = undefined;
    try{ if(e && e.body){ parsedBody = (typeof e.body === 'string') ? JSON.parse(e.body) : e.body; } }catch(_){ parsedBody = e && e.body; }
    return res.status(500).json({ok:false, err: String(e), statusCode: e && e.statusCode, body: parsedBody, stack: (e && e.stack) ? e.stack.split('\n').slice(0,10) : undefined});
  }
});

// Delete a subscription (protected)
app.delete('/api/subscription', basicAuth, (req, res)=>{
  const sub = req.body;
  if(!sub || !sub.endpoint) return res.status(400).json({ok:false});
  subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
  persist();
  res.json({ok:true});
});

app.get('/vapidPublicKey', (req, res)=>{
  if(!VAPID_PUBLIC) return res.status(404).send('');
  res.type('text/plain').send(VAPID_PUBLIC);
});

app.post('/api/register-subscription', (req, res)=>{
  const sub = req.body;
  if(!sub || !sub.endpoint){ return res.status(400).json({ok:false, msg:'invalid subscription'}); }
  // avoid duplicates
  if(!subscriptions.find(s=>s.endpoint === sub.endpoint)){
    subscriptions.push(sub);
    persist();
  }
  res.json({ok:true});
});

app.post('/api/unregister-subscription', (req, res)=>{
  const sub = req.body;
  subscriptions = subscriptions.filter(s => s.endpoint !== (sub && sub.endpoint));
  persist();
  res.json({ok:true});
});

app.post('/api/send', async (req, res)=>{
  // send payload to all saved subscriptions (for demo)
  const payload = req.body || { title: 'Sand Study', body: '時間です' };
  if(!VAPID_PUBLIC || !VAPID_PRIVATE){ return res.status(500).json({ok:false, msg:'VAPID keys not configured'}); }
  const results = [];
  for(const sub of subscriptions.slice()){
    try{
      await webpush.sendNotification(sub, JSON.stringify(payload));
      results.push({ endpoint: sub.endpoint, ok: true });
    }catch(e){
      console.error('push failed for', sub.endpoint, e && e.stack ? e.stack : e);
      results.push({ endpoint: sub.endpoint, ok:false, err: String(e), stack: (e && e.stack) ? e.stack.split('\n').slice(0,10) : undefined });
    }
  }
  res.json({ok:true, results});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>{ console.log('Push demo server listening on', PORT); if(!VAPID_PUBLIC) console.log('No VAPID keys loaded. See server/README.md'); });
