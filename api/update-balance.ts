import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface TelegramUser {
  id: number;
}

function validateInitData(initData: string): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');

  if (!hash) return null;

  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest();

  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (computedHash !== hash) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;

  try {
    return JSON.parse(userRaw) as TelegramUser;
  } catch {
    return null;
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { initData, delta } = req.body as {
    initData?: string;
    delta?: number;
  };

  if (!initData || typeof delta !== 'number') {
    return res.status(400).json({ error: 'Bad request' });
  }

  const user = validateInitData(initData);
  if (!user) {
    return res.status(401).json({ error: 'Invalid initData' });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('balance')
    .eq('telegram_id', user.id)
    .single();

  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  const newBalance = Math.max(0, profile.balance + delta);

  await supabase
    .from('profiles')
    .update({
      balance: newBalance,
      updated_at: new Date().toISOString(),
    })
    .eq('telegram_id', user.id);

  return res.json({ balance: newBalance });
}