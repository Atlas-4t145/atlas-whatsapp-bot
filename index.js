const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const API_URL = 'https://atlas-database.onrender.com/api';
let adminToken = null;

// Login no sistema
async function loginAdmin() {
    try {
        const res = await axios.post(`${API_URL}/login`, {
            phone: '11999999999',
            password: 'admin123'
        });
        adminToken = res.data.token;
        console.log('✅ Admin logado');
    } catch (error) {
        console.log('❌ Erro login');
    }
}

// Buscar usuário pelo telefone
async function buscarUsuario(telefone) {
    try {
        const res = await axios.get(`${API_URL}/admin/users`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        const numeroLimpo = telefone.replace(/\D/g, '');
        return res.data.find(u => u.phone === numeroLimpo);
    } catch {
        return null;
    }
}

// Buscar transações do mês
async function buscarTransacoes(userId) {
    try {
        const hoje = new Date();
        const res = await axios.get(`${API_URL}/transactions/${hoje.getFullYear()}/${hoje.getMonth() + 1}`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        return res.data.filter(t => t.user_id === userId);
    } catch {
        return [];
    }
}

// Criar transação
async function criarTransacao(userId, dados) {
    try {
        const res = await axios.post(`${API_URL}/transactions`, {
            user_id: userId,
            ...dados
        }, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        return res.data;
    } catch {
        return null;
    }
}

// Processar mensagem
async function processar(numero, msg) {
    const usuario = await buscarUsuario(numero);
    if (!usuario) return "❌ Número não autorizado";

    const texto = msg.toLowerCase();

    // Contas a pagar
    if (texto.includes('pagar') || texto.includes('contas')) {
        const transacoes = await buscarTransacoes(usuario.id);
        const despesas = transacoes.filter(t => t.type === 'expense');
        if (despesas.length === 0) return "✅ Nenhuma conta a pagar";
        
        let resp = "📋 CONTAS A PAGAR:\n";
        let total = 0;
        despesas.forEach(t => {
            resp += `• ${t.name}: R$ ${t.amount}\n`;
            total += Number(t.amount);
        });
        resp += `\n💰 Total: R$ ${total}`;
        return resp;
    }

    // Status
    if (texto.includes('status') || texto.includes('saldo')) {
        const transacoes = await buscarTransacoes(usuario.id);
        const receitas = transacoes.filter(t => t.type === 'income');
        const despesas = transacoes.filter(t => t.type === 'expense');
        const totalR = receitas.reduce((s, t) => s + Number(t.amount), 0);
        const totalD = despesas.reduce((s, t) => s + Number(t.amount), 0);
        return `📊 STATUS:\nReceitas: R$ ${totalR}\nDespesas: R$ ${totalD}\nSaldo: R$ ${totalR - totalD}`;
    }

    // Registrar despesa (ex: "pagar luz 150")
    const match = texto.match(/(pagar|gastei|comprei)\s+(.+?)\s+(\d+)/);
    if (match) {
        const transacao = await criarTransacao(usuario.id, {
            type: 'expense',
            amount: parseFloat(match[3]),
            name: match[2],
            category: 'outros',
            date: new Date().toISOString().split('T')[0]
        });
        if (transacao) return `✅ Despesa registrada: ${match[2]} R$ ${match[3]}`;
    }

    return "❓ Não entendi. Tente: pagar luz 150 / contas a pagar / status";
}

// Webhook
app.post('/webhook', async (req, res) => {
    const { number, message } = req.body;
    const resposta = await processar(number, message);
    res.json({ success: true, resposta });
});

// Teste
app.get('/teste/:numero/:msg', async (req, res) => {
    const resposta = await processar(req.params.numero, req.params.msg);
    res.json({ resposta });
});

// Iniciar
app.listen(3000, async () => {
    console.log('🤖 Bot rodando');
    await loginAdmin();
});
