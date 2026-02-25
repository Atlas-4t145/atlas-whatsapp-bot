const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

const CHAT_WEB_URL = 'https://atlas-4t145.github.io/portal-atlas/chat.html';
const API_URL = 'https://atlas-database.onrender.com/api';

// Cache simples
const userSessions = new Map(); // chatId -> { telefone, senha }

// ===========================================
// WEBHOOK DO TELEGRAM - VERSÃO SIMPLIFICADA
// ===========================================
app.post('/telegram-webhook', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text;

    console.log(`📩 Mensagem de ${chatId}: ${text}`);

    // ===== COMANDOS =====
    if (text === '/start') {
        await bot.sendMessage(chatId, 
            "🤖 *Bem-vindo ao Atlas Bot!*\n\n" +
            "Para começar, envie seu telefone com DDI:\n" +
            "Exemplo: `5549984094010`", 
            { parse_mode: 'Markdown' }
        );
        return res.sendStatus(200);
    }

    // ===== FLUXO DE LOGIN =====
    if (!userSessions.has(chatId)) {
        // Primeira mensagem: espera o telefone
        const telefone = text.replace(/\D/g, '');
        if (telefone.length >= 10 && telefone.length <= 13) {
            userSessions.set(chatId, { telefone, aguardandoSenha: true });
            await bot.sendMessage(chatId, "📱 Telefone recebido! Agora digite sua senha:");
        } else {
            await bot.sendMessage(chatId, "❌ Telefone inválido! Envie apenas números com DDI (ex: 5549984094010)");
        }
        return res.sendStatus(200);
    }

    const session = userSessions.get(chatId);
    
    // Aguardando senha
    if (session.aguardandoSenha) {
        session.senha = text;
        session.aguardandoSenha = false;
        
        // Testa o login
        try {
            const loginResponse = await axios.post(`${API_URL}/login`, {
                phone: session.telefone,
                password: session.senha
            });
            
            if (loginResponse.data.token) {
                session.token = loginResponse.data.token;
                session.user = loginResponse.data.user;
                await bot.sendMessage(chatId, 
                    `✅ *Login realizado!*\n\nOlá ${session.user.name}, agora você pode enviar mensagens.`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                throw new Error('Login falhou');
            }
        } catch (error) {
            userSessions.delete(chatId);
            await bot.sendMessage(chatId, "❌ Login falhou! Telefone ou senha incorretos.\n\nEnvie /start para tentar novamente.");
        }
        return res.sendStatus(200);
    }

    // ===== JÁ LOGADO: PROCESSA MENSAGEM DIRETO =====
    try {
        await bot.sendMessage(chatId, "⏳ Processando...");
        
        // 1. Busca as transações do usuário
        const transactionsResponse = await axios.get(`${API_URL}/transactions`, {
            headers: { 'Authorization': `Bearer ${session.token}` }
        });
        const transacoes = transactionsResponse.data;
        
        // 2. Processa a mensagem (lógica básica - podemos expandir depois)
        const msg = text.toLowerCase();
        let resposta = '';
        
        if (msg.includes('saldo') || msg.includes('status')) {
            const receitas = transacoes.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
            const despesas = transacoes.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
            const saldo = receitas - despesas;
            
            resposta = `📊 *SEU STATUS*\n\n` +
                      `💰 Receitas: R$ ${receitas.toFixed(2)}\n` +
                      `💸 Despesas: R$ ${despesas.toFixed(2)}\n` +
                      `💵 Saldo: R$ ${saldo.toFixed(2)}`;
        }
        else if (msg.includes('contas') || msg.includes('pagar')) {
            const hoje = new Date();
            const contasHoje = transacoes.filter(t => {
                if (t.type !== 'expense') return false;
                const data = new Date(t.date);
                return data.toDateString() === hoje.toDateString();
            });
            
            if (contasHoje.length > 0) {
                resposta = "📅 *CONTAS QUE VENCEM HOJE*\n\n";
                contasHoje.forEach(c => {
                    resposta += `• ${c.name}: R$ ${Number(c.amount).toFixed(2)}\n`;
                });
            } else {
                resposta = "✅ Nenhuma conta vence hoje!";
            }
        }
        else if (msg === 'ajuda' || msg === 'help') {
            resposta = "🤖 *COMANDOS*\n\n" +
                      "• status - ver saldo\n" +
                      "• contas - ver contas de hoje\n" +
                      "• ajuda - esta mensagem";
        }
        else {
            resposta = "❓ Comando não reconhecido. Digite *ajuda* para ver os comandos.";
        }
        
        await bot.sendMessage(chatId, resposta, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('❌ Erro:', error);
        await bot.sendMessage(chatId, "❌ Erro ao processar. Tente novamente.");
    }

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
    try {
        await bot.setWebHook(`https://atlas-whatsapp-bot-1.onrender.com/telegram-webhook`);
        console.log('✅ Webhook registrado');
    } catch (error) {
        console.error('❌ Erro ao registrar webhook:', error);
    }
});
