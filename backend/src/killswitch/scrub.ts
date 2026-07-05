/**
 * Secret scrub (roadmap C3). Redacts OANDA/Telegram tokens so they never reach a
 * log line or a stored raw_response. Redacts both known env-var values and common
 * token shapes (Bearer, Telegram bot URLs).
 */
const REDACTED = '***REDACTED***';

function envSecrets(): string[] {
  return [
    process.env.OANDA_API_TOKEN_DEMO,
    process.env.OANDA_API_TOKEN_LIVE,
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.ADMIN_API_TOKEN,
  ].filter((v): v is string => !!v && v.length >= 8);
}

export function scrubString(input: string): string {
  let out = input;
  for (const secret of envSecrets()) {
    out = out.split(secret).join(REDACTED);
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer ' + REDACTED);
  out = out.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot' + REDACTED); // Telegram bot token in URLs
  return out;
}

export function scrubSecrets<T>(value: T): T {
  if (value == null) return value;
  try {
    return JSON.parse(scrubString(JSON.stringify(value))) as T;
  } catch {
    return (typeof value === 'string' ? (scrubString(value) as unknown as T) : value);
  }
}
