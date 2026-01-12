const encoder = new TextEncoder();

async function hmacHex(message, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const bytes = new Uint8Array(signature);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function coupangAuthHeader(method, path, accessKey, secretKey) {
  const timestamp = Date.now().toString();
  const signature = await hmacHex(`${timestamp}${method}${path}`, secretKey);
  return {
    Authorization: `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${timestamp}, signature=${signature}`,
    'x-date': timestamp,
  };
}

export function validateKeys(env) {
  return env.COUPANG_ACCESS_KEY && env.COUPANG_SECRET_KEY && env.COUPANG_PARTNER_ID;
}
