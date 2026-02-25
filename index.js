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
// WEBHOOK DO TELEGRAM - VERSÃO CORRIGIDA
// ===========================================
app.post('/telegram-webhook', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text;

    // ===== FLUXO DE LOGIN =====
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

    // ===== JÁ LOGADO: PROCESSA MENSAGEM =====
    console.log(`📩 ${session.telefone}: ${text}`);

    // Envia mensagem de "processando"
    await bot.sendMessage(chatId, "⏳ Processando sua mensagem...");

    try {
        // 🔥 CHAMA O CHAT WEB EM MODO DIRETO (SEM ABRIR NAVEGADOR)
        const chatWebUrl = `${CHAT_WEB_URL}?modo=direto&telefone=${session.telefone}&senha=${session.senha}&mensagem=${encodeURIComponent(text)}&chatId=${chatId}`;
        
        // Faz a requisição para o chat.html (ele vai processar e responder via webhook)
        await axios.get(chatWebUrl);
        
        console.log(`✅ Chat processando: ${chatId}`);
        
    } catch (error) {
        console.error('❌ Erro ao chamar chat web:', error);
        await bot.sendMessage(chatId, "❌ Erro ao processar. Tente novamente.");
    }

    res.sendStatus(200);
});

// ===========================================
// ROTA PARA RECEBER RESPOSTA DO CHAT WEB
// ===========================================
app.post('/resposta-telegram', async (req, res) => {
    const { chatId, resposta } = req.body;
    
    if (!chatId || !resposta) {
        return res.status(400).json({ error: 'chatId e resposta obrigatórios' });
    }
    
    try {
        // Envia a resposta para o usuário no Telegram
        await bot.sendMessage(chatId, resposta, { parse_mode: 'Markdown' });
        console.log(`✅ Resposta enviada para ${chatId}`);
        res.json({ ok: true });
    } catch (error) {
        console.error('❌ Erro ao enviar resposta:', error);
        res.status(500).json({ error: error.message });
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
    try {
        await bot.setWebHook(`https://atlas-whatsapp-bot-1.onrender.com/telegram-webhook`);
        console.log('✅ Webhook registrado');
    } catch (error) {
        console.error('❌ Erro ao registrar webhook:', error);
    }
});
