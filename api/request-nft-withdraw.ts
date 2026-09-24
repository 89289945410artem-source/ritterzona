import type { VercelRequest, VercelResponse } from '@vercel/node';

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const BOT_TOKEN = process.env.BOT_TOKEN!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, amount } = req.body;

    if (!amount || amount < 500) {
      return res.status(400).json({ ok: false, error: 'Минимум 500 Stars для вывода' });
    }

    // Отправляем уведомление администратору в Telegram
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text: `🎁 Заявка на NFT-вывод\nUser ID: ${userId}\nСумма: ${amount}⭐`,
      }),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('withdraw error', err);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
}