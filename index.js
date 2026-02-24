const express = require('express');
const axios = require('axios');
const moment = require('moment');
const puppeteer = require('puppeteer');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
if (!TELEGRAM_TOKEN) {
    console.warn('⚠️ TELEGRAM_TOKEN não configurado');
    process.exit(1);
}

const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
console.log('✅ Telegram bot configurado');

const WHAPI_TOKEN = 'TEtVSimBqAMZAC0gqEtadRKjroevRdkj';
const WHAPI_URL = 'https://gate.whapi.cloud';
const API_URL = 'https://atlas-database.onrender.com/api';
const userCache = new Map();

// Caches para Telegram
const userPhoneCache = new Map();   // aguardando senha
const userLoginCache = new Map();   // { telefone, senha }

// ===========================================
// FUNÇÃO PARA USAR O CHAT WEB
// ===========================================
async function usarChatWeb(telefone, senha, mensagem) {
    console.log(`🌐 Abrindo Chat Web para ${telefone}...`);
    
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        await page.goto('https://atlas-4t145.github.io/portal-atlas/chat.html', { waitUntil: 'networkidle2' });
        
        await page.type('#telefone', telefone);
        await page.type('#senha', senha);
        await page.click('#btnLogin');
        await page.waitForSelector('#inputMensagem', { timeout: 10000 });
        
        await page.type('#inputMensagem', mensagem);
        await page.click('#btnEnviar');
        await page.waitForSelector('.message.bot:last-child .message-content', { timeout: 15000 });
        
        const resposta = await page.$eval('.message.bot:last-child .message-content', el => el.textContent);
        return resposta;
        
    } catch (error) {
        console.error('❌ Erro no Chat Web:', error);
        return '❌ Erro ao processar no Chat Web.';
    } finally {
        await browser.close();
    }
}

// ===========================================
// FUNÇÕES DO WHATSAPP (já existentes)
// ===========================================
async function buscarUsuario(numero) { /* ... (igual ao seu código) */ }
async function buscarTransacoes(userId, mes, ano) { /* ... */ }
async function buscarTodasTransacoes(userId) { /* ... */ }
async function criarTransacao(userId, dados) { /* ... */ }
function formatarMoeda(valor) { /* ... */ }
function formatarData(data) { /* ... */ }
async function processar(numero, mensagem) { /* ... (22 funcionalidades) */ }

// ===========================================
// WEBHOOK DO WHATSAPP
// ===========================================
app.post('/webhook', async (req, res) => {
    // ... (seu código existente)
});

// ===========================================
// FLUXO DO TELEGRAM
// ===========================================
async function pedirCompartilharNumero(chatId) {
    const teclado = {
        reply_markup: {
            keyboard: [[{ text: "📱 Compartilhar Número", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true
        }
    };
    await telegramBot.sendMessage(chatId, "🔐 *Para usar o Atlas, preciso do seu número.*", { parse_mode: 'Markdown', ...teclado });
}

app.post('/telegram-webhook', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.sendStatus(200);
        const chatId = message.chat.id;

        // Compartilhou número
        if (message.contact) {
            let telefone = message.contact.phone_number.replace(/\D/g, '');
            if (!telefone.startsWith('55')) telefone = '55' + telefone;
            userPhoneCache.set(chatId, { telefone, aguardandoSenha: true });
            await telegramBot.sendMessage(chatId, `📱 Número recebido: ${telefone}\n\nAgora digite sua senha:`, { parse_mode: 'Markdown' });
            return res.sendStatus(200);
        }

        if (message.text) {
            const texto = message.text;
            const pendingData = userPhoneCache.get(chatId);
            
            // Aguardando senha
            if (pendingData?.aguardandoSenha) {
                userLoginCache.set(chatId, { telefone: pendingData.telefone, senha: texto });
                userPhoneCache.delete(chatId);
                await telegramBot.sendMessage(chatId, "✅ *Login salvo!*\n\nDigite *ajuda* para começar.", { parse_mode: 'Markdown' });
                return res.sendStatus(200);
            }

            // Já logado
            const userData = userLoginCache.get(chatId);
            if (!userData) {
                await pedirCompartilharNumero(chatId);
                return res.sendStatus(200);
            }

            console.log(`📩 Telegram [${userData.telefone}]: ${texto}`);
            
            // USA O CHAT WEB (com Puppeteer)
            const resposta = await usarChatWeb(userData.telefone, userData.senha, texto);
            await telegramBot.sendMessage(chatId, resposta, { parse_mode: 'HTML' });
            return res.sendStatus(200);
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Erro no Telegram:', error);
        res.sendStatus(500);
    }
});

// ===========================================
// ROTAS DE TESTE E HEALTH
// ===========================================
app.get('/teste/:numero/:msg', async (req, res) => {
    const resposta = await processar(req.params.numero, req.params.msg);
    res.json({ resposta });
});

app.get('/health', (req, res) => {
    res.json({ status: 'online', funcionalidades: 22 });
});

// ===========================================
// INICIAR
// ===========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🤖 BOT RODANDO NA PORTA ${PORT}`);
    await telegramBot.setWebHook(`https://atlas-whatsapp-bot.onrender.com/telegram-webhook`);
    console.log('✅ Webhook do Telegram registrado');
});
