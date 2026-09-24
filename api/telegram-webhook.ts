import type { VercelRequest, VercelResponse } from '@vercel/node';

const BOT_TOKEN = process.env.BOT_TOKEN!;
const MINI_APP_URL = 'https://client2-blush.vercel.app';

async function sendMessage(chatId: number, text: string, keyboard?: any) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: keyboard,
    }),
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(200).send('ok');
  }

  const update = req.body;

  try {
    /* ---- pre_checkout_query (обязательно для оплаты) ---- */
    if (update.pre_checkout_query) {
      await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pre_checkout_query_id: update.pre_checkout_query.id,
            ok: true,
          }),
        },
      );
      return res.status(200).send('ok');
    }

    /* ---- successful_payment ---- */
    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment;
      const payload = payment.invoice_payload;
      const [_, userId] = payload.split(':');

      console.log('Payment success', {
        userId,
        stars: payment.total_amount,
      });

      if (update.message.chat?.id) {
        await sendMessage(
          update.message.chat.id,
          `✅ <b>Платёж получен</b>\n\nЗачислено: <b>${payment.total_amount} ⭐</b>\n\nОткройте игру и проверьте баланс.`,
          {
            inline_keyboard: [
              [
                {
                  text: '🎮 Открыть игру',
                  web_app: { url: MINI_APP_URL },
                },
              ],
            ],
          },
        );
      }

      return res.status(200).send('ok');
    }

    /* ---- Текстовые команды ---- */
    const message = update.message;
    if (message?.text && message.chat?.id) {
      const text = String(message.text).trim();
      const chatId = message.chat.id;

      if (text.startsWith('/start')) {
        const firstName = message.from?.first_name || 'друг';

        await sendMessage(
          chatId,
          `👋 Привет, <b>${firstName}</b>!\n\n` +
            `Добро пожаловать в <b>RITTER ZONA</b> — игровое пространство с рулеткой, ракетой и кейсами.\n\n` +
            `💰 Стартовый бонус: <b>+30 ⭐</b>\n` +
            `🎁 Вывод NFT от <b>500 ⭐</b>\n` +
            `⚡ Пополнение через Telegram Stars\n\n` +
            `Нажми кнопку ниже, чтобы начать!`,
          {
            inline_keyboard: [
              [
                {
                  text: '🎮 Играть',
                  web_app: { url: MINI_APP_URL },
                },
              ],
            ],
          },
        );
      } else if (text.startsWith('/help')) {
        await sendMessage(
          chatId,
          `📖 <b>Команды:</b>\n\n` +
            `/start — начать\n` +
            `/play — открыть игру\n` +
            `/help — эта справка\n\n` +
            `🎮 <b>Игры:</b>\n` +
            `• Рулетка — выбери цвет и множитель\n` +
            `• Ракета — забери выигрыш до падения\n` +
            `• Кейсы — 12 кейсов с разными шансами`,
        );
      } else if (text.startsWith('/play')) {
        await sendMessage(
          chatId,
          '🎮 Открыть игру:',
          {
            inline_keyboard: [
              [
                {
                  text: '🎮 Играть',
                  web_app: { url: MINI_APP_URL },
                },
              ],
            ],
          },
        );
      }
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error('webhook error', err);
    return res.status(200).send('ok');
  }
}