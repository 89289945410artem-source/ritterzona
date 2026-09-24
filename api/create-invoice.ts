import type { VercelRequest, VercelResponse } from '@vercel/node';

const BOT_TOKEN = process.env.BOT_TOKEN!;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, userId } = req.body;

    if (!amount || amount < 10) {
      return res.status(400).json({ error: 'Минимум 10 звёзд' });
    }

    // Создаём ссылку на оплату через Telegram Bot API
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Пополнение ${amount} Stars`,
          description: `Зачисление ${amount} звёзд на игровой баланс`,
          payload: `topup:${userId}:${Date.now()}`,
          currency: 'XTR', // Это код Telegram Stars [citation:2][citation:15]
          prices: [{ label: 'Пополнение', amount }],
          provider_token: '', // Для Stars это поле пустое [citation:18]
        }),
      },
    );

    const data = await response.json();

    if (!data.ok) {
      return res.status(500).json({ error: data.description });
    }

    return res.json({ invoiceLink: data.result });
  } catch (err) {
    console.error('create-invoice error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}