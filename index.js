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
// WEBHOOK DO TELEGRAM
// ===========================================
app.post('/telegram-webhook', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text;

    // Fluxo de login (simplificado)
    if (!userSessions.has(chatId)) {
        // Primeira mensagem: espera o telefone
        const telefone = text.replace(/\D/g, '');
        if (telefone.length >= 10) {
            userSessions.set(chatId, { telefone, aguardandoSenha: true });
            await bot.sendMessage(chatId, "📱 Telefone recebido! Agora digite sua senha:");
        } else {
            await bot.sendMessage(chatId, "❌ Envie seu número com DDI (ex: 5549984094010)");
        }
        return res.sendStatus(200);
    }

    const session = userSessions.get(chatId);
    
    // Aguardando senha
    if (session.aguardandoSenha) {
        session.senha = text;
        session.aguardandoSenha = false;
        await bot.sendMessage(chatId, "✅ Login realizado! Agora você pode enviar mensagens.");
        return res.sendStatus(200);
    }

    // Já logado: processa mensagem
    console.log(`📩 ${session.telefone}: ${text}`);

    // 🔥 CHAMA O CHAT WEB VIA LINK (ABRE NO NAVEGADOR DO USUÁRIO)
    const chatWebUrl = `${CHAT_WEB_URL}?telefone=${session.telefone}&senha=${session.senha}&mensagem=${encodeURIComponent(text)}&chatId=${chatId}`;

    // Envia o link para o usuário (ele clica e vê a resposta)
    await bot.sendMessage(chatId, `🔗 Clique aqui para ver a resposta no Chat Web:\n${chatWebUrl}`);

    res.sendStatus(200);

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
