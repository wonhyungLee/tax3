const encoder = new TextEncoder();

function utcStamp() {
  // ISO8601 UTC without milliseconds; Coupang accepts this format for signed-date.
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

async function hmacHex(message, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const bytes = new Uint8Array(signature);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function coupangAuthHeader(method, path, accessKey, secretKey) {
  const timestamp = utcStamp();
  const signature = await hmacHex(`${timestamp}${method.toUpperCase()}${path}`, secretKey);
  return {
    Authorization: `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${timestamp}, signature=${signature}`,
    'x-date': timestamp,
  };
}

export function validateKeys(env) {
  // Allow multiple env names to reduce misconfiguration risk.
  const accessKey = env.COUPANG_ACCESS_KEY || env.COUPANG_ACCESSKEY || env.COUPANG_KEY;
  const secretKey = env.COUPANG_SECRET_KEY || env.COUPANG_SECRET || env.COUPANG_SECRETKEY;
  const partnerId = env.COUPANG_PARTNER_ID || env.COUPANG_SUB_ID || env.PARTNER_ID || env.COUPANG_PARTNERID;
  return { accessKey, secretKey, partnerId };
}
