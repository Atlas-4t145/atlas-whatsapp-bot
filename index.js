const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

const API_URL = 'https://atlas-database.onrender.com/api';

// Cache de sessões
const userSessions = new Map();

// ===========================================
// FUNÇÕES AUXILIARES
// ===========================================
function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(valor);
}

function formatarData(dataISO) {
    const d = new Date(dataISO);
    return d.toLocaleDateString('pt-BR');
}

function formatarMes(mes) {
    const meses = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    return meses[mes - 1];
}

// ===========================================
// FUNÇÕES DE API
// ===========================================
async function fazerLogin(telefone, senha) {
    try {
        const response = await axios.post(`${API_URL}/login`, {
            phone: telefone,
            password: senha
        });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.error || 'Erro no login');
    }
}

async function carregarTransacoes(token) {
    try {
        const response = await axios.get(`${API_URL}/transactions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        // Garantir que é array e converter valores
        const dados = response.data || [];
        return dados.map(t => ({
            ...t,
            amount: parseFloat(String(t.amount).replace(',', '.')) || 0
        }));
        
    } catch (error) {
        return [];
    }
}

async function criarTransacao(token, transacao) {
    try {
        const response = await axios.post(`${API_URL}/transactions`, transacao, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.error || 'Erro ao criar transação');
    }
}

// ===========================================
// PROCESSADOR DE MENSAGENS (IGUAL AO CHAT)
// ===========================================
async function processarMensagem(texto, transacoes, token) {
    
    // LOG PARA VER O QUE ESTÁ CHEGANDO
    console.log('========== TRANSAÇÕES RECEBIDAS ==========');
    console.log('Tipo:', typeof transacoes);
    console.log('É array?', Array.isArray(transacoes));
    console.log('Quantidade:', transacoes?.length);
    console.log('Primeira transação:', JSON.stringify(transacoes?.[0], null, 2));
    console.log('==========================================');
    
    // Garantir que transacoes é array
    if (!Array.isArray(transacoes)) {
        transacoes = [];
    }
    
    const msg = texto.toLowerCase().trim();
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();

    // -----------------------------------------
    // REGISTROS
    // -----------------------------------------
    const matchSimples = msg.match(/(pagar|gastei|comprei)\s+(.+?)\s+(\d+[.,]?\d*)/);
    if (matchSimples) {
        const valor = parseFloat(matchSimples[3].replace(',', '.'));
        const desc = matchSimples[2].charAt(0).toUpperCase() + matchSimples[2].slice(1);
        
        await criarTransacao(token, {
            type: 'expense',
            amount: valor,
            name: desc,
            category: 'outros',
            date: hoje.toISOString().split('T')[0]
        });
        return `✅ Despesa registrada: ${desc} ${formatarMoeda(valor)}`;
    }

    const matchData = msg.match(/(.+?)\s+(\d+[.,]?\d*)\s+(hoje|ontem|amanhã)/);
    if (matchData) {
        const valor = parseFloat(matchData[2].replace(',', '.'));
        const desc = matchData[1].charAt(0).toUpperCase() + matchData[1].slice(1);
        let data = new Date();
        if (matchData[3] === 'ontem') data.setDate(data.getDate() - 1);
        if (matchData[3] === 'amanhã') data.setDate(data.getDate() + 1);
        
        await criarTransacao(token, {
            type: 'expense',
            amount: valor,
            name: desc,
            category: 'outros',
            date: data.toISOString().split('T')[0]
        });
        return `✅ Despesa registrada: ${desc} ${formatarMoeda(valor)} (${matchData[3]})`;
    }

    const matchVenc = msg.match(/(.+?)\s+(\d+[.,]?\d*)\s+dia\s+(\d+)/);
    if (matchVenc) {
        const valor = parseFloat(matchVenc[2].replace(',', '.'));
        const desc = matchVenc[1].charAt(0).toUpperCase() + matchVenc[1].slice(1);
        const dia = parseInt(matchVenc[3]);
        
        let data = new Date();
        data.setDate(dia);
        if (data < hoje) data.setMonth(data.getMonth() + 1);

        await criarTransacao(token, {
            type: 'expense',
            amount: valor,
            name: desc,
            category: 'outros',
            date: data.toISOString().split('T')[0],
            due_day: dia,
            recurrence_type: 'fixed'
        });
        return `✅ Despesa registrada: ${desc} ${formatarMoeda(valor)} (vence dia ${dia})`;
    }

    const matchParc = msg.match(/(.+?)\s+(\d+[.,]?\d*)\s+(\d+)x/);
    if (matchParc) {
        const total = parseFloat(matchParc[2].replace(',', '.'));
        const desc = matchParc[1].charAt(0).toUpperCase() + matchParc[1].slice(1);
        const parcelas = parseInt(matchParc[3]);
        const valorParcela = total / parcelas;

        for (let i = 0; i < parcelas; i++) {
            const dataParcela = new Date();
            dataParcela.setMonth(dataParcela.getMonth() + i);
            
            await criarTransacao(token, {
                type: 'expense',
                amount: valorParcela,
                name: `${desc} (${i+1}/${parcelas})`,
                category: 'outros',
                date: dataParcela.toISOString().split('T')[0],
                recurrence_type: 'parceled',
                current_installment: i+1,
                total_installments: parcelas
            });
        }
        return `✅ Compra parcelada: ${desc} ${formatarMoeda(total)} em ${parcelas}x de ${formatarMoeda(valorParcela)}`;
    }

    const matchRecorrente = texto.match(/(.+?)\s+(\d+[.,]?\d*)\s+todo dia\s+(\d+)/);
    if (matchRecorrente) {
        try {
            const valor = parseFloat(matchRecorrente[2].replace(',', '.'));
            const desc = matchRecorrente[1].charAt(0).toUpperCase() + matchRecorrente[1].slice(1);
            const dia = parseInt(matchRecorrente[3]);

            let primeiraData = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
            if (primeiraData <= hoje) {
                primeiraData = new Date(hoje.getFullYear(), hoje.getMonth() + 1, dia);
            }

            const quantidadeMeses = 12;
            for (let i = 0; i < quantidadeMeses; i++) {
                const dataTransacao = new Date(primeiraData);
                dataTransacao.setMonth(primeiraData.getMonth() + i);
                const dataFormatada = dataTransacao.toISOString().split('T')[0];

                await criarTransacao(token, {
                    type: 'expense',
                    amount: valor,
                    name: `${desc} (${i+1}/${quantidadeMeses})`,
                    category: 'outros',
                    date: dataFormatada,
                    due_day: dia,
                    recurrence_type: 'fixed'
                });
            }
            return `✅ Despesa recorrente registrada: ${desc} ${formatarMoeda(valor)} todo dia ${dia}`;
        } catch (error) {
            return `❌ Erro: ${error.message}`;
        }
    }

    const matchRecb = msg.match(/(recebi|deposito)\s+(.+?)\s+(\d+[.,]?\d*)/);
    if (matchRecb) {
        const valor = parseFloat(matchRecb[3].replace(',', '.'));
        const desc = matchRecb[2].charAt(0).toUpperCase() + matchRecb[2].slice(1);
        
        await criarTransacao(token, {
            type: 'income',
            amount: valor,
            name: desc,
            category: 'salario',
            date: hoje.toISOString().split('T')[0]
        });
        return `💰 Receita registrada: ${desc} ${formatarMoeda(valor)}`;
    }

    // -----------------------------------------
    // SALDO
    // -----------------------------------------
    if (msg.includes('saldo') || msg.includes('status')) {
        const transacoesMes = transacoes.filter(t => {
            const d = new Date(t.date);
            return d.getMonth() + 1 === mesAtual && d.getFullYear() === anoAtual;
        });

        const receitas = transacoesMes.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const despesas = transacoesMes.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        const saldo = receitas - despesas;

        const totalReceitas = transacoes.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const totalDespesas = transacoes.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        const saldoTotal = totalReceitas - totalDespesas;

        return `📊 *STATUS FINANCEIRO*\n\n` +
               `📅 Mês atual: ${formatarMes(mesAtual)}\n` +
               `💰 Receitas: ${formatarMoeda(receitas)}\n` +
               `💸 Despesas: ${formatarMoeda(despesas)}\n` +
               `💵 Saldo: ${formatarMoeda(saldo)}\n\n` +
               `📈 Acumulado total:\n` +
               `💰 Total receitas: ${formatarMoeda(totalReceitas)}\n` +
               `💸 Total despesas: ${formatarMoeda(totalDespesas)}\n` +
               `💎 Saldo total: ${formatarMoeda(saldoTotal)}`;
    }

    // -----------------------------------------
    // CONTAS A PAGAR
    // -----------------------------------------
    if (msg.includes('contas a pagar') || msg.includes('o que tenho pra pagar') || msg.includes('minhas contas')) {
        const hojeData = new Date();
        const despesas = transacoes
            .filter(t => t.type === 'expense')
            .map(t => ({ ...t, dataObj: new Date(t.date) }))
            .sort((a, b) => a.dataObj - b.dataObj);

        if (despesas.length === 0) return "✅ Nenhuma conta a pagar.";

        let resposta = "📋 *CONTAS A PAGAR*\n━━━━━━━━━━━━━━\n\n";
        let total = 0;

        const hojeList = despesas.filter(t => t.dataObj.toDateString() === hojeData.toDateString());
        const amanhaList = despesas.filter(t => {
            const amanha = new Date(hojeData);
            amanha.setDate(amanha.getDate() + 1);
            return t.dataObj.toDateString() === amanha.toDateString();
        });
        const proximosList = despesas.filter(t => {
            const diff = Math.ceil((t.dataObj - hojeData) / (1000 * 60 * 60 * 24));
            return diff > 1 && diff <= 7;
        });

        if (hojeList.length) {
            resposta += `📅 *HOJE* (${hojeData.toLocaleDateString('pt-BR')})\n`;
            hojeList.forEach(t => {
                resposta += `• ${t.name}: ${formatarMoeda(t.amount)}\n`;
                total += t.amount;
            });
            resposta += '\n';
        }

        if (amanhaList.length) {
            const amanha = new Date(hojeData);
            amanha.setDate(amanha.getDate() + 1);
            resposta += `📅 *AMANHÃ* (${amanha.toLocaleDateString('pt-BR')})\n`;
            amanhaList.forEach(t => {
                resposta += `• ${t.name}: ${formatarMoeda(t.amount)}\n`;
                total += t.amount;
            });
            resposta += '\n';
        }

        if (proximosList.length) {
            resposta += `📅 *PRÓXIMOS DIAS*\n`;
            proximosList.slice(0, 10).forEach(t => {
                resposta += `• ${t.name}: ${formatarMoeda(t.amount)} (${t.dataObj.toLocaleDateString('pt-BR')})\n`;
                total += t.amount;
            });
            resposta += '\n';
        }

        resposta += `━━━━━━━━━━━━━━\n💰 *Total: ${formatarMoeda(total)}*`;
        return resposta;
    }

    // -----------------------------------------
    // MAIORES CONTAS
    // -----------------------------------------
    if (msg.includes('maiores contas') || msg.includes('gastos maiores') || msg.includes('top gastos')) {
        const despesas = transacoes
            .filter(t => t.type === 'expense')
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 10);

        if (!despesas.length) return "Nenhuma despesa encontrada.";

        let resposta = "💰 *MAIORES CONTAS*\n━━━━━━━━━━━━━━\n\n";
        despesas.forEach((t, i) => {
            resposta += `${i+1}. ${t.name}: ${formatarMoeda(t.amount)} (${formatarData(t.date)})\n`;
        });
        return resposta;
    }

    // -----------------------------------------
    // PRÓXIMO MÊS
    // -----------------------------------------
    if (msg.includes('mês que vem') || msg.includes('próximo mês')) {
        let mes = mesAtual + 1;
        let ano = anoAtual;
        if (mes > 12) { mes = 1; ano++; }

        const despesas = transacoes.filter(t => {
            const d = new Date(t.date);
            return t.type === 'expense' && d.getMonth() + 1 === mes && d.getFullYear() === ano;
        }).sort((a, b) => new Date(a.date) - new Date(b.date));

        if (!despesas.length) return `📅 *${mes}/${ano}*\n\nNenhuma despesa.`;

        let resposta = `📅 *PRÓXIMO MÊS (${mes}/${ano})*\n━━━━━━━━━━━━━━\n\n`;
        let total = 0;
        despesas.forEach(t => {
            resposta += `• ${t.name}: ${formatarMoeda(t.amount)} (${formatarData(t.date)})\n`;
            total += t.amount;
        });
        resposta += `\n━━━━━━━━━━━━━━\n💰 *Total: ${formatarMoeda(total)}*`;
        return resposta;
    }

    // -----------------------------------------
    // ONDE GASTO MAIS
    // -----------------------------------------
    if (msg.includes('onde gasto mais') || msg.includes('categorias') || msg.includes('meus gastos')) {
        const despesas = transacoes.filter(t => t.type === 'expense');
        if (!despesas.length) return "Nenhuma despesa.";

        const cats = {};
        despesas.forEach(t => {
            const cat = t.category || 'outros';
            cats[cat] = (cats[cat] || 0) + t.amount;
        });

        const topCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const totalDespesas = despesas.reduce((s, t) => s + t.amount, 0);

        let resposta = "📊 *ONDE GASTA MAIS*\n━━━━━━━━━━━━━━\n\n";
        resposta += "📌 *TOP CATEGORIAS*\n";
        topCats.forEach(([cat, valor]) => {
            const perc = (valor / totalDespesas * 100).toFixed(1);
            resposta += `• ${cat}: ${formatarMoeda(valor)} (${perc}%)\n`;
        });

        const topContas = [...despesas].sort((a, b) => b.amount - a.amount).slice(0, 5);
        resposta += `\n📌 *MAIORES CONTAS*\n`;
        topContas.forEach(t => resposta += `• ${t.name}: ${formatarMoeda(t.amount)}\n`);

        return resposta;
    }
    

    // -----------------------------------------
// CATEGORIAS (CORRIGIDO COM "OUTROS")
// -----------------------------------------
const catsLista = ['alimentação', 'moradia', 'transporte', 'saúde', 'educação', 'lazer', 'cartão', 'supermercado', 'ifood', 'academia', 'aluguel', 'internet', 'água', 'luz'];
for (let cat of catsLista) {
    if (msg.includes(cat)) {
        const filtradas = transacoes.filter(t => {
            const d = new Date(t.date);
            return t.type === 'expense' && 
                   d.getMonth() + 1 === mesAtual && 
                   d.getFullYear() === anoAtual &&
                   (t.category?.toLowerCase().includes(cat) || t.name?.toLowerCase().includes(cat));
        }).sort((a, b) => new Date(a.date) - new Date(b.date));

        if (!filtradas.length) return `Nenhum gasto com *${cat}* neste mês.`;

        let resposta = `🍔 *GASTOS COM ${cat.toUpperCase()}*\n━━━━━━━━━━━━━━\n\n`;
        let total = 0;
        filtradas.forEach(t => {
            resposta += `• ${t.name}: ${formatarMoeda(t.amount)} (${formatarData(t.date)})\n`;
            total += t.amount;
        });
        resposta += `\n━━━━━━━━━━━━━━\n💰 *Total: ${formatarMoeda(total)}*`;
        return resposta;
    }
}

// -----------------------------------------
// CATEGORIA "OUTROS" (NOVA)
// -----------------------------------------
if (msg.includes('outros')) {
    const filtradas = transacoes.filter(t => {
        const d = new Date(t.date);
        return t.type === 'expense' && 
               d.getMonth() + 1 === mesAtual && 
               d.getFullYear() === anoAtual &&
               (!t.category || t.category === 'outros' || t.category === '');
    }).sort((a, b) => new Date(a.date) - new Date(b.date));

    if (!filtradas.length) return "Nenhum gasto na categoria *outros* neste mês.";

    let resposta = `📦 *GASTOS COM OUTROS*\n━━━━━━━━━━━━━━\n\n`;
    let total = 0;
    filtradas.forEach(t => {
        resposta += `• ${t.name}: ${formatarMoeda(t.amount)} (${formatarData(t.date)})\n`;
        total += t.amount;
    });
    resposta += `\n━━━━━━━━━━━━━━\n💰 *Total: ${formatarMoeda(total)}*`;
    return resposta;
}
    // -----------------------------------------
    // RESUMO SEMANAL
    // -----------------------------------------
    if (msg.includes('resumo semanal') || msg.includes('essa semana') || msg.includes('gastos da semana')) {
        const inicioSemana = new Date(hoje);
        inicioSemana.setDate(hoje.getDate() - hoje.getDay());
        const fimSemana = new Date(inicioSemana);
        fimSemana.setDate(inicioSemana.getDate() + 6);

        const semana = transacoes.filter(t => {
            const d = new Date(t.date);
            return d >= inicioSemana && d <= fimSemana;
        });

        const receitas = semana.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const despesas = semana.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

        let resposta = `📅 *RESUMO SEMANAL*\n`;
        resposta += `${inicioSemana.toLocaleDateString('pt-BR')} a ${fimSemana.toLocaleDateString('pt-BR')}\n`;
        resposta += `━━━━━━━━━━━━━━\n\n`;
        resposta += `💰 Receitas: ${formatarMoeda(receitas)}\n`;
        resposta += `💸 Despesas: ${formatarMoeda(despesas)}\n`;
        resposta += `💵 Saldo: ${formatarMoeda(receitas - despesas)}`;
        return resposta;
    }

    // -----------------------------------------
    // COMPARAR
    // -----------------------------------------
    if (msg.includes('comparar') || msg.includes('mês passado')) {
        let mesPassado = mesAtual - 1;
        let anoPassado = anoAtual;
        if (mesPassado === 0) { mesPassado = 12; anoPassado--; }

        const atual = transacoes.filter(t => {
            const d = new Date(t.date);
            return d.getMonth() + 1 === mesAtual && d.getFullYear() === anoAtual;
        });
        const passado = transacoes.filter(t => {
            const d = new Date(t.date);
            return d.getMonth() + 1 === mesPassado && d.getFullYear() === anoPassado;
        });

        const recAtual = atual.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const despAtual = atual.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        const recPass = passado.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const despPass = passado.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

        return `📊 *COMPARATIVO*\n` +
               `${mesPassado}/${anoPassado} → ${mesAtual}/${anoAtual}\n━━━━━━━━━━━━━━\n\n` +
               `💰 Receitas:\n  Antes: ${formatarMoeda(recPass)}\n  Agora: ${formatarMoeda(recAtual)}\n\n` +
               `💸 Despesas:\n  Antes: ${formatarMoeda(despPass)}\n  Agora: ${formatarMoeda(despAtual)}\n\n` +
               `💵 Saldo:\n  Antes: ${formatarMoeda(recPass - despPass)}\n  Agora: ${formatarMoeda(recAtual - despAtual)}`;
    }

    // -----------------------------------------
    // EXTRATO MÊS
    // -----------------------------------------
    const matchExtMes = msg.match(/extrato\s+([a-z]+)/i);
    if (matchExtMes) {
        const meses = {
            'janeiro': 1, 'fevereiro': 2, 'março': 3, 'abril': 4,
            'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8,
            'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12
        };
        const mesNome = matchExtMes[1].toLowerCase();
        const mesNum = meses[mesNome];
        if (!mesNum) return "Mês inválido.";

        const ano = msg.match(/\b(20\d{2})\b/)?.[1] || anoAtual;
        const filtradas = transacoes.filter(t => {
            const d = new Date(t.date);
            return d.getMonth() + 1 === mesNum && d.getFullYear() == ano;
        }).sort((a, b) => new Date(a.date) - new Date(b.date));

        if (!filtradas.length) return `Nenhuma transação em ${mesNome}/${ano}.`;

        const receitas = filtradas.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const despesas = filtradas.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

        let resposta = `📋 *EXTRATO ${mesNome.toUpperCase()}/${ano}*\n━━━━━━━━━━━━━━\n\n`;
        resposta += `💰 Receitas: ${formatarMoeda(receitas)}\n`;
        resposta += `💸 Despesas: ${formatarMoeda(despesas)}\n`;
        resposta += `💵 Saldo: ${formatarMoeda(receitas - despesas)}`;
        return resposta;
    }

    // -----------------------------------------
    // EXTRATO ANO
    // -----------------------------------------
    const matchAno = msg.match(/\b(20\d{2})\b/);
    if (matchAno && (msg.includes('extrato') || msg.includes('ano'))) {
        const ano = parseInt(matchAno[1]);
        const filtradas = transacoes.filter(t => new Date(t.date).getFullYear() === ano);

        if (!filtradas.length) return `Nenhuma transação em ${ano}.`;

        const meses = Array(12).fill().map(() => ({ receitas: 0, despesas: 0 }));
        filtradas.forEach(t => {
            const mes = new Date(t.date).getMonth();
            if (t.type === 'income') meses[mes].receitas += t.amount;
            else meses[mes].despesas += t.amount;
        });

        const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        let resposta = `📅 *EXTRATO ${ano}*\n━━━━━━━━━━━━━━\n\n`;
    
        for (let i = 0; i < 12; i++) {
            if (meses[i].receitas > 0 || meses[i].despesas > 0) {
                resposta += `${nomes[i]}:\n`;
                resposta += `  💰 ${formatarMoeda(meses[i].receitas)}\n`;
                resposta += `  💸 ${formatarMoeda(meses[i].despesas)}\n`;
                resposta += `  💵 ${formatarMoeda(meses[i].receitas - meses[i].despesas)}\n\n`;
            }
        }
    
        const totalR = filtradas.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const totalD = filtradas.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    
        resposta += `━━━━━━━━━━━━━━\n`;
        resposta += `💰 Total receitas: ${formatarMoeda(totalR)}\n`;
        resposta += `💸 Total despesas: ${formatarMoeda(totalD)}\n`;
        resposta += `💎 *Saldo anual: ${formatarMoeda(totalR - totalD)}*`;
    
        return resposta;
    }

    // -----------------------------------------
    // AJUDA (IGUAL AO CHAT)
    // -----------------------------------------
    if (msg === 'ajuda' || msg === 'help' || msg === 'comandos') {
        return `🤖 *COMANDOS DO ATLAS*\n\n` +
               `📝 *Registrar:*\n` +
               `• pagar luz 150\n` +
               `• ifood 89 ontem\n` +
               `• aluguel 2500 dia 10\n` +
               `• celular 3000 10x\n` +
               `• academia 120 todo dia 10\n` +
               `• recebi salario 5000\n\n` +
               `📊 *Consultar:*\n` +
               `• contas a pagar\n` +
               `• status / saldo\n` +
               `• maiores contas\n` +
               `• mês que vem\n` +
               `• onde gasto mais\n` +
               `• alimentação (ou outra categoria)\n` +
               `• resumo semanal\n` +
               `• comparar com mês passado\n` +
               `• extrato janeiro\n` +
               `• extrato 2025`;
    }

    return "❓ *Não entendi*\n\nDigite *ajuda* para ver os comandos.";
}

// ===========================================
// WEBHOOK DO TELEGRAM
// ===========================================
app.post('/telegram-webhook', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text;

    try {
        if (!userSessions.has(chatId)) {
            if (!message.text.startsWith('/start') && !message.text.match(/^\d/)) {
                await bot.sendMessage(chatId, "👋 *Bem-vindo ao Atlas Financeiro!*\n\nPara começar, digite seu *telefone com DDI*.\n\nExemplo: `554984094010`", { parse_mode: 'Markdown' });
                return res.sendStatus(200);
            }

            const telefone = text.replace(/\D/g, '');
            
            if (telefone.length >= 10) {
                userSessions.set(chatId, { telefone, aguardandoSenha: true });
                await bot.sendMessage(chatId, "📱 Telefone recebido! Agora digite sua *senha*:", { parse_mode: 'Markdown' });
            } else {
                await bot.sendMessage(chatId, "❌ Telefone inválido. Digite com DDI (ex: 554984094010)");
            }
            return res.sendStatus(200);
        }

        const session = userSessions.get(chatId);
        
        if (session.aguardandoSenha) {
            try {
                const loginData = await fazerLogin(session.telefone, text);
                
                session.token = loginData.token;
                session.user = loginData.user;
                session.aguardandoSenha = false;
                
                await bot.sendMessage(chatId, 
                    `✅ *Login realizado com sucesso!*\n\n` +
                    `👤 Usuário: ${loginData.user.name}\n` +
                    `Digite *ajuda* para ver os comandos.`, 
                    { parse_mode: 'Markdown' }
                );
                
            } catch (error) {
                await bot.sendMessage(chatId, `❌ Erro no login: ${error.message}`);
                userSessions.delete(chatId);
            }
            
            return res.sendStatus(200);
        }

        // CARREGA TRANSAÇÕES FRESCAS
        const transacoes = await carregarTransacoes(session.token);
        
        // GARANTE QUE É ARRAY
        const transacoesArray = Array.isArray(transacoes) ? transacoes : [];
        
        // PROCESSA A MENSAGEM
        const resposta = await processarMensagem(text, transacoesArray, session.token);
        
        await bot.sendMessage(chatId, resposta, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('❌ Erro:', error);
        await bot.sendMessage(chatId, `❌ Erro interno: ${error.message}`);
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
        console.log('❌ Erro ao registrar webhook:', error.message);
    }
});
