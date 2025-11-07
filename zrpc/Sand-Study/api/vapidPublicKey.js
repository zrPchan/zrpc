const { VAPID_PUBLIC_KEY } = require('./_lib');

// Return the raw VAPID public key as text so the client can use it directly
module.exports = (req, res) => {
  if (VAPID_PUBLIC_KEY) {
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(String(VAPID_PUBLIC_KEY));
  }
  // If not configured, return 204 No Content to indicate empty
  res.setHeader('Content-Type', 'text/plain');
  return res.status(204).send('');
};
