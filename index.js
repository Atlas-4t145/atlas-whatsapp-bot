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
const userSessions = new Map(); // chatId -> { token, user, transactions }

// ===========================================
// ===========================================
// FUNÇÕES AUXILIARES (copiadas do chat.html)
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

// 👇 FUNÇÃO PARA MÊS
function formatarMes(mes) {
    const meses = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    return meses[mes - 1];
}

// 👇 FUNÇÃO PARA ANO (só retorna o ano mesmo, mas útil pra consistência)
function formatarAno(ano) {
    return ano.toString();
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
        return response.data;
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
// PROCESSADOR DE MENSAGENS (copiado do chat.html)
// ===========================================
async function processarMensagem(texto, session) {
    const msg = texto.toLowerCase().trim();
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();
    const transacoes = session.transactions;

    // -----------------------------------------
    // 1-6. REGISTROS
    // -----------------------------------------

    // Despesa simples
    const matchSimples = msg.match(/(pagar|gastei|comprei)\s+(.+?)\s+(\d+[.,]?\d*)/);
    if (matchSimples) {
        const valor = parseFloat(matchSimples[3].replace(',', '.'));
        const desc = matchSimples[2].charAt(0).toUpperCase() + matchSimples[2].slice(1);
        
        await criarTransacao(session.token, {
            type: 'expense',
            amount: valor,
            name: desc,
            category: 'outros',
            date: hoje.toISOString().split('T')[0]
        });
        
        // Atualizar transações na sessão
        session.transactions = await carregarTransacoes(session.token);
        
        return `✅ Despesa registrada: ${desc} ${formatarMoeda(valor)}`;
    }

    // Despesa com data
    const matchData = msg.match(/(.+?)\s+(\d+[.,]?\d*)\s+(hoje|ontem|amanhã)/);
    if (matchData) {
        const valor = parseFloat(matchData[2].replace(',', '.'));
        const desc = matchData[1].charAt(0).toUpperCase() + matchData[1].slice(1);
        let data = new Date();
        if (matchData[3] === 'ontem') data.setDate(data.getDate() - 1);
        if (matchData[3] === 'amanhã') data.setDate(data.getDate() + 1);
        
        await criarTransacao(session.token, {
            type: 'expense',
            amount: valor,
            name: desc,
            category: 'outros',
            date: data.toISOString().split('T')[0]
        });
        
        session.transactions = await carregarTransacoes(session.token);
        return `✅ Despesa registrada: ${desc} ${formatarMoeda(valor)} (${matchData[3]})`;
    }

    // Despesa com vencimento
    const matchVenc = msg.match(/(.+?)\s+(\d+[.,]?\d*)\s+dia\s+(\d+)/);
    if (matchVenc) {
        const valor = parseFloat(matchVenc[2].replace(',', '.'));
        const desc = matchVenc[1].charAt(0).toUpperCase() + matchVenc[1].slice(1);
        const dia = parseInt(matchVenc[3]);
        
        let data = new Date();
        data.setDate(dia);
        if (data < hoje) data.setMonth(data.getMonth() + 1);

        await criarTransacao(session.token, {
            type: 'expense',
            amount: valor,
            name: desc,
            category: 'outros',
            date: data.toISOString().split('T')[0],
            due_day: dia,
            recurrence_type: 'fixed'
        });
        
        session.transactions = await carregarTransacoes(session.token);
        return `✅ Despesa registrada: ${desc} ${formatarMoeda(valor)} (vence dia ${dia})`;
    }

    // Despesa parcelada
    const matchParc = msg.match(/(.+?)\s+(\d+[.,]?\d*)\s+(\d+)x/);
    if (matchParc) {
        const total = parseFloat(matchParc[2].replace(',', '.'));
        const desc = matchParc[1].charAt(0).toUpperCase() + matchParc[1].slice(1);
        const parcelas = parseInt(matchParc[3]);
        const valorParcela = total / parcelas;

        for (let i = 0; i < parcelas; i++) {
            const dataParcela = new Date();
            dataParcela.setMonth(dataParcela.getMonth() + i);
            
            await criarTransacao(session.token, {
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
        
        session.transactions = await carregarTransacoes(session.token);
        return `✅ Compra parcelada: ${desc} ${formatarMoeda(total)} em ${parcelas}x de ${formatarMoeda(valorParcela)}`;
    }

    // Despesa recorrente (academia 120 todo dia 10)
    const matchRecorrente = texto.match(/(.+?)\s+(\d+[.,]?\d*)\s+todo dia\s+(\d+)/);
    if (matchRecorrente) {
        try {
            const valor = parseFloat(matchRecorrente[2].replace(',', '.'));
            const desc = matchRecorrente[1].charAt(0).toUpperCase() + matchRecorrente[1].slice(1);
            const dia = parseInt(matchRecorrente[3]);

            const hoje = new Date();
            let primeiraData = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
            if (primeiraData <= hoje) {
                primeiraData = new Date(hoje.getFullYear(), hoje.getMonth() + 1, dia);
            }

            const quantidadeMeses = 12;
            const promessas = [];

            for (let i = 0; i < quantidadeMeses; i++) {
                const dataTransacao = new Date(primeiraData);
                dataTransacao.setMonth(primeiraData.getMonth() + i);

                const ano = dataTransacao.getFullYear();
                const mes = String(dataTransacao.getMonth() + 1).padStart(2, '0');
                const diaFormatado = String(dataTransacao.getDate()).padStart(2, '0');
                const dataFormatada = `${ano}-${mes}-${diaFormatado}`;

                promessas.push(
                    criarTransacao(session.token, {
                        type: 'expense',
                        amount: valor,
                        name: `${desc} (${i+1}/${quantidadeMeses})`,
                        category: 'outros',
                        date: dataFormatada,
                        due_day: dia,
                        recurrence_type: 'fixed'
                    })
                );
            }

            await Promise.all(promessas);
            session.transactions = await carregarTransacoes(session.token);

            const primeiraDataStr = primeiraData.toLocaleDateString('pt-BR');
            return `✅ Despesa recorrente registrada: ${desc} ${formatarMoeda(valor)} todo dia ${dia} – geradas ${quantidadeMeses} parcelas (primeira: ${primeiraDataStr}).`;

        } catch (error) {
            return `❌ Erro ao registrar despesa recorrente: ${error.message}`;
        }
    }

    // Receita
    const matchRecb = msg.match(/(recebi|deposito)\s+(.+?)\s+(\d+[.,]?\d*)/);
    if (matchRecb) {
        const valor = parseFloat(matchRecb[3].replace(',', '.'));
        const desc = matchRecb[2].charAt(0).toUpperCase() + matchRecb[2].slice(1);
        
        await criarTransacao(session.token, {
            type: 'income',
            amount: valor,
            name: desc,
            category: 'salario',
            date: hoje.toISOString().split('T')[0]
        });
        
        session.transactions = await carregarTransacoes(session.token);
        return `💰 Receita registrada: ${desc} ${formatarMoeda(valor)}`;
    }

    // -----------------------------------------
    // 7. SALDO / STATUS
    // -----------------------------------------
    if (msg.includes('saldo') || msg.includes('status')) {
        const transacoesMes = transacoes.filter(t => {
            const d = new Date(t.date);
            return d.getMonth() + 1 === mesAtual && d.getFullYear() === anoAtual;
        });

        const receitasMes = transacoesMes.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
        const despesasMes = transacoesMes.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
        const saldoMes = receitasMes - despesasMes;

        const totalReceitas = transacoes.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
        const totalDespesas = transacoes.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
        const saldoTotal = totalReceitas - totalDespesas;

        return `📊 *STATUS FINANCEIRO*\n\n` +
               `📅 Mês atual: ${formatarMes(mesAtual)}\n` +
               `💰 Receitas: ${formatarMoeda(receitasMes)}\n` +
               `💸 Despesas: ${formatarMoeda(despesasMes)}\n` +
               `💵 Saldo: ${formatarMoeda(saldoMes)}\n\n` +
               `📈 Acumulado total: ${formatarAno(anoAtual)}\n` +
               `💰 Total receitas: ${formatarMoeda(totalReceitas)}\n` +
               `💸 Total despesas: ${formatarMoeda(totalDespesas)}\n` +
               `💎 Saldo total: ${formatarMoeda(saldoTotal)}`;
    }

    // -----------------------------------------
    // 8. CONTAS A PAGAR
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
                total += Number(t.amount);
            });
            resposta += '\n';
        }

        if (amanhaList.length) {
            const amanha = new Date(hojeData);
            amanha.setDate(amanha.getDate() + 1);
            resposta += `📅 *AMANHÃ* (${amanha.toLocaleDateString('pt-BR')})\n`;
            amanhaList.forEach(t => {
                resposta += `• ${t.name}: ${formatarMoeda(t.amount)}\n`;
                total += Number(t.amount);
            });
            resposta += '\n';
        }

        if (proximosList.length) {
            resposta += `📅 *PRÓXIMOS DIAS*\n`;
            proximosList.forEach(t => {
                resposta += `• ${t.name}: ${formatarMoeda(t.amount)} (${t.dataObj.toLocaleDateString('pt-BR')})\n`;
                total += Number(t.amount);
            });
            resposta += '\n';
        }

        resposta += `━━━━━━━━━━━━━━\n💰 *Total: ${formatarMoeda(total)}*`;
        return resposta;
    }

    // -----------------------------------------
    // 9. MAIORES CONTAS
    // -----------------------------------------
    if (msg.includes('maiores contas') || msg.includes('gastos maiores') || msg.includes('top gastos')) {
        const despesas = transacoes
            .filter(t => t.type === 'expense')
            .sort((a, b) => Number(b.amount) - Number(a.amount))
            .slice(0, 10);

        if (!despesas.length) return "Nenhuma despesa encontrada.";

        let resposta = "💰 *MAIORES CONTAS*\n━━━━━━━━━━━━━━\n\n";
        despesas.forEach((t, i) => {
            resposta += `${i+1}. ${t.name}: ${formatarMoeda(t.amount)} (${formatarData(t.date)})\n`;
        });
        return resposta;
    }

    // -----------------------------------------
    // 10. PRÓXIMO MÊS
    // -----------------------------------------
    if (msg.includes('mês que vem') || msg.includes('próximo mês')) {
        let mes = mesAtual + 1;
        let ano = anoAtual;
        if (mes > 12) { mes = 1; ano++; }

        const despesas = transacoes.filter(t => {
            const d = new Date(t.date);
            return t.type === 'expense' && d.getMonth() + 1 === mes && d.getFullYear() === ano;
        }).sort((a, b) => new Date(a.date) - new Date(b.date));

        if (!despesas.length) return `📅 *${mes}/${ano}*\n\nNenhuma despesa cadastrada.`;

        let resposta = `📅 *PRÓXIMO MÊS (${mes}/${ano})*\n━━━━━━━━━━━━━━\n\n`;
        let total = 0;
        despesas.forEach(t => {
            resposta += `• ${t.name}: ${formatarMoeda(t.amount)} (${formatarData(t.date)})\n`;
            total += Number(t.amount);
        });
        resposta += `\n━━━━━━━━━━━━━━\n💰 *Total: ${formatarMoeda(total)}*`;
        return resposta;
    }

    // -----------------------------------------
    // 11. ONDE GASTO MAIS
    // -----------------------------------------
    if (msg.includes('onde gasto mais') || msg.includes('categorias') || msg.includes('meus gastos')) {
        const despesas = transacoes.filter(t => t.type === 'expense');
        if (!despesas.length) return "Nenhuma despesa encontrada.";

        // Top categorias
        const cats = {};
        despesas.forEach(t => {
            const cat = t.category || 'outros';
            cats[cat] = (cats[cat] || 0) + Number(t.amount);
        });

        const topCats = Object.entries(cats)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const totalDespesas = despesas.reduce((s, t) => s + Number(t.amount), 0);

        let resposta = "📊 *ONDE VOCÊ GASTA MAIS*\n━━━━━━━━━━━━━━\n\n";
        resposta += "📌 *TOP CATEGORIAS*\n";
        topCats.forEach(([cat, valor]) => {
            const perc = (valor / totalDespesas * 100).toFixed(1);
            resposta += `• ${cat}: ${formatarMoeda(valor)} (${perc}%)\n`;
        });

        // Top contas
        const topContas = [...despesas]
            .sort((a, b) => Number(b.amount) - Number(a.amount))
            .slice(0, 5);

        resposta += `\n📌 *MAIORES CONTAS*\n`;
        topContas.forEach(t => {
            resposta += `• ${t.name}: ${formatarMoeda(t.amount)}\n`;
        });

        return resposta;
    }

    // -----------------------------------------
    // 12-16. CONSULTA POR CATEGORIA
    // -----------------------------------------
    const catsLista = ['alimentação', 'moradia', 'transporte', 'saúde', 'educação', 'lazer', 'cartão', 'supermercado', 'ifood', 'academia', 'aluguel', 'internet', 'água', 'luz'];
    for (let cat of catsLista) {
        if (msg.includes(cat)) {
            const filtradas = transacoes.filter(t => 
                t.type === 'expense' && 
                (t.category?.toLowerCase().includes(cat) || t.name?.toLowerCase().includes(cat))
            ).sort((a, b) => new Date(a.date) - new Date(b.date));

            if (!filtradas.length) return `Nenhum gasto com *${cat}*.`;

            let resposta = `🍔 *GASTOS COM ${cat.toUpperCase()}*\n━━━━━━━━━━━━━━\n\n`;
            let total = 0;
            filtradas.forEach(t => {
                resposta += `• ${t.name}: ${formatarMoeda(t.amount)} (${formatarData(t.date)})\n`;
                total += Number(t.amount);
            });
            resposta += `\n━━━━━━━━━━━━━━\n💰 *Total: ${formatarMoeda(total)}*`;
            return resposta;
        }
    }

    // -----------------------------------------
    // 17. RESUMO SEMANAL
    // -----------------------------------------
    if (msg.includes('resumo semanal') || msg.includes('essa semana') || msg.includes('gastos da semana')) {
        const hoje = new Date();
        const inicioSemana = new Date(hoje);
        inicioSemana.setDate(hoje.getDate() - hoje.getDay());
        const fimSemana = new Date(inicioSemana);
        fimSemana.setDate(inicioSemana.getDate() + 6);

        const semana = transacoes.filter(t => {
            const d = new Date(t.date);
            return d >= inicioSemana && d <= fimSemana;
        });

        const receitas = semana.filter(t => t.type === 'income');
        const despesas = semana.filter(t => t.type === 'expense');
        const totalR = receitas.reduce((s, t) => s + Number(t.amount), 0);
        const totalD = despesas.reduce((s, t) => s + Number(t.amount), 0);

        let resposta = `📅 *RESUMO DA SEMANA*\n`;
        resposta += `${inicioSemana.toLocaleDateString('pt-BR')} a ${fimSemana.toLocaleDateString('pt-BR')}\n`;
        resposta += `━━━━━━━━━━━━━━\n\n`;
        resposta += `💰 Receitas: ${formatarMoeda(totalR)}\n`;
        resposta += `💸 Despesas: ${formatarMoeda(totalD)}\n`;
        resposta += `💵 Saldo: ${formatarMoeda(totalR - totalD)}\n\n`;

        if (despesas.length) {
            const top3 = [...despesas].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 3);
            resposta += `📌 *Principais gastos:*\n`;
            top3.forEach(t => resposta += `• ${t.name}: ${formatarMoeda(t.amount)}\n`);
        }
        return resposta;
    }

    // -----------------------------------------
    // 18. COMPARAR COM MÊS PASSADO
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

        const recAtual = atual.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
        const despAtual = atual.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
        const recPass = passado.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
        const despPass = passado.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

        const diffRec = recAtual - recPass;
        const diffDesp = despAtual - despPass;
        const diffSaldo = (recAtual - despAtual) - (recPass - despPass);

        const seta = v => v > 0 ? '📈' : v < 0 ? '📉' : '➡️';

        return `📊 *COMPARATIVO*\n` +
               `${mesPassado}/${anoPassado} → ${mesAtual}/${anoAtual}\n━━━━━━━━━━━━━━\n\n` +
               `💰 Receitas:\n  Antes: ${formatarMoeda(recPass)}\n  Agora: ${formatarMoeda(recAtual)}\n  ${seta(diffRec)} ${diffRec > 0 ? '+' : ''}${formatarMoeda(diffRec)}\n\n` +
               `💸 Despesas:\n  Antes: ${formatarMoeda(despPass)}\n  Agora: ${formatarMoeda(despAtual)}\n  ${seta(diffDesp)} ${diffDesp > 0 ? '+' : ''}${formatarMoeda(diffDesp)}\n\n` +
               `💵 Saldo:\n  Antes: ${formatarMoeda(recPass - despPass)}\n  Agora: ${formatarMoeda(recAtual - despAtual)}\n  ${seta(diffSaldo)} ${diffSaldo > 0 ? '+' : ''}${formatarMoeda(diffSaldo)}`;
    }

    // -----------------------------------------
    // 19. EXTRATO MÊS
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

        const receitas = filtradas.filter(t => t.type === 'income');
        const despesas = filtradas.filter(t => t.type === 'expense');
        const totalR = receitas.reduce((s, t) => s + Number(t.amount), 0);
        const totalD = despesas.reduce((s, t) => s + Number(t.amount), 0);

        let resposta = `📋 *EXTRATO ${mesNome.toUpperCase()}/${ano}*\n━━━━━━━━━━━━━━\n\n`;
        if (receitas.length) {
            resposta += `💰 *Receitas:*\n`;
            receitas.forEach(t => resposta += `  ${formatarData(t.date)} - ${t.name}: ${formatarMoeda(t.amount)}\n`);
            resposta += `  Total: ${formatarMoeda(totalR)}\n\n`;
        }
        if (despesas.length) {
            resposta += `💸 *Despesas:*\n`;
            despesas.forEach(t => resposta += `  ${formatarData(t.date)} - ${t.name}: ${formatarMoeda(t.amount)}\n`);
            resposta += `  Total: ${formatarMoeda(totalD)}\n\n`;
        }
        resposta += `━━━━━━━━━━━━━━\n💵 *Saldo: ${formatarMoeda(totalR - totalD)}*`;
        return resposta;
    }

    // -----------------------------------------
    // 20. EXTRATO ANO
    // -----------------------------------------
    const matchAno = msg.match(/\b(20\d{2})\b/);
    if (matchAno && (msg.includes('extrato') || msg.includes('ano'))) {
        const ano = parseInt(matchAno[1]);
        const filtradas = transacoes.filter(t => new Date(t.date).getFullYear() === ano);

        if (!filtradas.length) return `Nenhuma transação em ${ano}.`;

        const meses = Array(12).fill().map(() => ({ receitas: 0, despesas: 0 }));
        filtradas.forEach(t => {
            const mes = new Date(t.date).getMonth();
            if (t.type === 'income') meses[mes].receitas += Number(t.amount);
            else meses[mes].despesas += Number(t.amount);
        });

        const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        let resposta = `📅 *EXTRATO ${ano}*\n━━━━━━━━━━━━━━\n\n`;
        for (let i = 0; i < 12; i++) {
            if (meses[i].receitas || meses[i].despesas) {
                resposta += `${nomes[i]}:\n`;
                resposta += `  💰 ${formatarMoeda(meses[i].receitas)}\n`;
                resposta += `  💸 ${formatarMoeda(meses[i].despesas)}\n`;
                resposta += `  💵 ${formatarMoeda(meses[i].receitas - meses[i].despesas)}\n\n`;
            }
        }

        const totalR = filtradas.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
        const totalD = filtradas.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
        resposta += `━━━━━━━━━━━━━━\n💰 Total receitas: ${formatarMoeda(totalR)}\n`;
        resposta += `💸 Total despesas: ${formatarMoeda(totalD)}\n`;
        resposta += `💎 *Saldo anual: ${formatarMoeda(totalR - totalD)}*`;
        return resposta;
    }

    // -----------------------------------------
    // 21. AJUDA
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

    // -----------------------------------------
    // 22. NÃO ENTENDEU
    // -----------------------------------------
    return "❓ *Não entendi*\n\nDigite *ajuda* para ver os comandos disponíveis.";
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
        // Se não tem sessão, aguarda telefone
        if (!userSessions.has(chatId)) {
            // Se é a primeira mensagem, pede telefone
            if (!message.text.startsWith('/start') && !message.text.match(/^\d/)) {
                await bot.sendMessage(chatId, "👋 *Bem-vindo ao Atlas Financeiro!*\n\nPara começar, digite seu *telefone com DDI*.\n\nExemplo: `554984094010`", { parse_mode: 'Markdown' });
                return res.sendStatus(200);
            }

            const telefone = text.replace(/\D/g, '');
            
            if (telefone.length >= 10) {
                // Salva na sessão que está aguardando senha
                userSessions.set(chatId, { telefone, aguardandoSenha: true });
                await bot.sendMessage(chatId, "📱 Telefone recebido! Agora digite sua *senha*:", { parse_mode: 'Markdown' });
            } else {
                await bot.sendMessage(chatId, "❌ Telefone inválido. Digite com DDI (ex: 554984094010)");
            }
            return res.sendStatus(200);
        }

        const session = userSessions.get(chatId);
        
        // Aguardando senha
        if (session.aguardandoSenha) {
            try {
                // Tenta fazer login
                const loginData = await fazerLogin(session.telefone, text);
                
                // Login OK! Salva token e carrega transações
                session.token = loginData.token;
                session.user = loginData.user;
                session.aguardandoSenha = false;
                session.transactions = await carregarTransacoes(session.token);
                
                await bot.sendMessage(chatId, 
                    `✅ *Login realizado com sucesso!*\n\n` +
                    `👤 Usuário: ${loginData.user.name}\n` +
                    `📊 Transações carregadas: ${session.transactions.length}\n\n` +
                    `Digite *ajuda* para ver os comandos disponíveis.`, 
                    { parse_mode: 'Markdown' }
                );
                
            } catch (error) {
                await bot.sendMessage(chatId, `❌ Erro no login: ${error.message}`);
                // Remove sessão para recomeçar
                userSessions.delete(chatId);
            }
            
            return res.sendStatus(200);
        }

        // JÁ LOGADO: processa a mensagem com TODAS as funções do chat.html
        console.log(`📩 ${session.user.name}: ${text}`);
        
        // Mostra "digitando..." enquanto processa
        await bot.sendChatAction(chatId, 'typing');
        
        // Processa a mensagem (usa a função completa do chat.html)
        const resposta = await processarMensagem(text, session);
        
        // Envia a resposta direto no Telegram
        await bot.sendMessage(chatId, resposta, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('❌ Erro no webhook:', error);
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

// ===========================================
// NOTIFICAÇÕES DIÁRIAS - 08:00 TODO DIA
// ===========================================

async function enviarNotificacoesDiarias() {
    console.log('🔔 Enviando notificações diárias...', new Date().toLocaleString());
    
    for (const [chatId, session] of userSessions.entries()) {
        try {
            const transacoes = session.transactions || [];
            const hoje = new Date();
            const hojeData = new Date(hoje.setHours(0, 0, 0, 0));
            
            const contasAPagar = transacoes.filter(t => {
                if (t.type !== 'expense') return false;
                if (t.auto_debit === true) return false;
                
                const dataVenc = new Date(t.date);
                dataVenc.setHours(0, 0, 0, 0);
                return dataVenc >= hojeData;
            }).sort((a, b) => new Date(a.date) - new Date(b.date));
            
            if (contasAPagar.length === 0) continue;
            
            let mensagem = `🔔 *RESUMO DE CONTAS - ${hoje.toLocaleDateString('pt-BR')}*\n\n`;
            
            const hojeList = contasAPagar.filter(t => {
                const d = new Date(t.date);
                d.setHours(0, 0, 0, 0);
                return d.getTime() === hojeData.getTime();
            });
            
            const proximosList = contasAPagar.filter(t => {
                const d = new Date(t.date);
                d.setHours(0, 0, 0, 0);
                return d > hojeData;
            });
            
            let totalHoje = 0;
            let totalProximos = 0;
            
            if (hojeList.length > 0) {
                mensagem += `📅 *VENCEM HOJE:*\n`;
                hojeList.forEach(t => {
                    mensagem += `• ${t.name}: ${formatarMoeda(t.amount)}\n`;
                    totalHoje += Number(t.amount);
                });
                mensagem += `\n`;
            }
            
            if (proximosList.length > 0) {
                mensagem += `📅 *PRÓXIMOS DIAS:*\n`;
                proximosList.slice(0, 10).forEach(t => {
                    const data = new Date(t.date).toLocaleDateString('pt-BR');
                    mensagem += `• ${t.name}: ${formatarMoeda(t.amount)} (${data})\n`;
                    totalProximos += Number(t.amount);
                });
                mensagem += `\n`;
            }
            
            mensagem += `━━━━━━━━━━━━━━━━━━\n`;
            mensagem += `💰 *Total hoje:* ${formatarMoeda(totalHoje)}\n`;
            mensagem += `💰 *Total próximos:* ${formatarMoeda(totalProximos)}\n`;
            mensagem += `💵 *Total geral:* ${formatarMoeda(totalHoje + totalProximos)}`;
            
            await bot.sendMessage(chatId, mensagem, { parse_mode: 'Markdown' });
            console.log(`✅ Notificação enviada para ${chatId}`);
            
        } catch (error) {
            console.error(`❌ Erro ao notificar ${chatId}:`, error.message);
        }
    }
}

// Agenda fixa - roda todo dia às 08:00
const AGORA = new Date();
const PROXIMA_08 = new Date(
    AGORA.getFullYear(),
    AGORA.getMonth(),
    AGORA.getDate(),
    8, 0, 0
);

if (PROXIMA_08 <= AGORA) {
    PROXIMA_08.setDate(PROXIMA_08.getDate() + 1);
}

setTimeout(() => {
    enviarNotificacoesDiarias();
    setInterval(enviarNotificacoesDiarias, 24 * 60 * 60 * 1000);
}, PROXIMA_08 - AGORA);

console.log(`⏰ Notificações agendadas para todo dia às 08:00`);
