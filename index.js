const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

const CHAT_WEB_URL = 'https://atlas-4t145.github.io/portal-atlas/chat.html';

// Cache simples
const userSessions = new Map(); // chatId -> { telefone, senha }

// ===========================================
// WEBHOOK DO TELEGRAM – VERSÃO QUE CAPTURA RESPOSTA
// ===========================================
app.post('/telegram-webhook', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || !message.text) return res.sendStatus(200);

        const chatId = message.chat.id;
        const texto = message.text;

        // ========== FLUXO DE LOGIN (igual ao seu) ==========
        const pendingData = userPhoneCache.get(chatId);
        if (pendingData?.aguardandoSenha) {
            userLoginCache.set(chatId, {
                telefone: pendingData.telefone,
                senha: texto
            });
            userPhoneCache.delete(chatId);
            await bot.sendMessage(chatId, "✅ *Login salvo!*\n\nAgora você pode usar o Atlas.", { parse_mode: 'Markdown' });
            return res.sendStatus(200);
        }

        const userData = userLoginCache.get(chatId);
        if (!userData) {
            await pedirCompartilharNumero(chatId);
            return res.sendStatus(200);
        }

        console.log(`📩 Telegram [${userData.telefone}]: ${texto}`);

        // ========== USA O CHAT WEB E CAPTURA A RESPOSTA ==========
        const resposta = await usarChatWeb(
            userData.telefone,
            userData.senha,
            texto
        );

        // ========== ENVIA A RESPOSTA DE VOLTA ==========
        await bot.sendMessage(chatId, resposta, { parse_mode: 'HTML' });

        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Erro no webhook do Telegram:', error);
        res.sendStatus(500);
    }
});
// ===========================================
// HEALTH CHECK
// ===========================================
app.get('/health', (req, res) => {
    res.json({ status: 'online' });
});

// ===========================================
// INICIAR
// ===========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🤖 BOT RODANDO NA PORTA ${PORT}`);
    await bot.setWebHook(`https://atlas-whatsapp-bot-1.onrender.com/telegram-webhook`);
    console.log('✅ Webhook registrado');
});
