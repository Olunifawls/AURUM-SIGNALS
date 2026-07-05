/**
 * INC-7 — one-time chat-id capture.
 *
 * Calls Telegram getUpdates with TELEGRAM_BOT_TOKEN and prints the chat id of
 * whoever last messaged the bot, so it can be pasted into .env as
 * TELEGRAM_CHAT_ID. Never prints the token. Run: `npm run telegram:chatid`.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

function getBotToken(): string {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  for (const p of [path.resolve(REPO_ROOT, '.env'), path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../.env')]) {
    if (!fs.existsSync(p)) continue;
    const line = fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('TELEGRAM_BOT_TOKEN='));
    if (line) {
      const v = line.slice('TELEGRAM_BOT_TOKEN='.length).trim();
      if (v) return v;
    }
  }
  throw new Error('TELEGRAM_BOT_TOKEN not set (env var or repo-root .env)');
}

async function main(): Promise<void> {
  const token = getBotToken();
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const json = (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: Array<Record<string, any>>;
  };
  if (!json.ok) {
    throw new Error(`Telegram getUpdates error: ${json.description ?? 'unknown'}`);
  }
  const updates = json.result ?? [];
  if (updates.length === 0) {
    console.log('No updates found. Send a message to your bot in Telegram, then re-run this.');
    return;
  }
  const last = updates[updates.length - 1];
  const chat = last.message?.chat ?? last.edited_message?.chat ?? last.channel_post?.chat;
  if (!chat) {
    console.log('Latest update has no chat. Send a direct text message to the bot and re-run.');
    return;
  }
  const who = chat.username ?? chat.first_name ?? chat.title ?? '';
  console.log(`Chat ID: ${chat.id}  (type: ${chat.type}${who ? `, ${who}` : ''})`);
  console.log(`Paste into .env:  TELEGRAM_CHAT_ID=${chat.id}`);
}

main().catch((err) => {
  console.error('telegram:chatid failed:', err.message ?? err);
  process.exit(1);
});
