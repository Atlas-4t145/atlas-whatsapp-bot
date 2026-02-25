// index.js - BOT TELEGRAM NATIVO (consulta direta à API)
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// URL da API do Atlas (MESMA do chat.html)
const API_URL = 'https://atlas-database.onrender.com/api';

// Cache de sessões: chatId -> { token, user, telefone, senha }
const sessions = new Map();

// ===========================================
// FUNÇÕES AUXILIARES (cópia do chat.html)
// ===========================================
function formatarMoeda(valor) {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(dataISO) {
    const d = new Date(dataISO);
    return d.toLocaleDateString('pt-BR');
}

function limparTelefone(telefone) {
    return telefone.replace(/\D/g, '');
}

// ===========================================
// PROCESSAR MENSAGEM (COPIADO DO chat.html)
// ===========================================
async function processarMensagem(texto, transacoes, usuario) {
    const msg = texto.toLowerCase().trim();
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();

    // -----------------------------------------
    // 1-6. REGISTROS (FLEXÍVEL)
    // -----------------------------------------

    // Despesa simples
    const matchSimples = msg.match(/(pagar|gastei|comprei)\s+(.+?)\s+(\d+[.,]?\d*)/);
    if (matchSimples) {
        const valor = parseFloat(matchSimples[3].replace(',', '.'));
        const desc = matchSimples[2].charAt(0).toUpperCase() + matchSimples[2].slice(1);
        return {
            acao: 'criar_transacao',
            dados: {
                type: 'expense',
                amount: valor,
                name: desc,
                category: 'outros',
                date: hoje.toISOString().split('T')[0]
            },
            resposta: `✅ Despesa registrada: ${desc} ${formatarMoeda(valor)}`
        };
    }

    // Despesa com data
    const matchData = msg.match(/(.+?)\s+(\d+[.,]?\d*)\s+(hoje|ontem|amanhã)/);
    if (matchData) {
        const valor = parseFloat(matchData[2].replace(',', '.'));
        const desc = matchData[1].charAt(0).toUpperCase() + matchData[1].slice(1);
        let data = new Date();
        if (matchData[3] === 'ontem') data.setDate(data.getDate() - 1);
        if (matchData[3] === 'amanhã') data.setDate(data.getDate() + 1);
        
        return {
            acao: 'criar_transacao',
            dados: {
                type: 'expense',
                amount: valor,
                name: desc,
                category: 'outros',
                date: data.toISOString().split('T')[0]
            },
            resposta: `✅ Despesa registrada: ${desc} ${formatarMoeda(valor)} (${matchData[3]})`
        };
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

        return {
            acao: 'criar_transacao',
            dados: {
                type: 'expense',
                amount: valor,
                name: desc,
                category: 'outros',
                date: data.toISOString().split('T')[0],
                due_day: dia,
                recurrence_type: 'fixed'
            },
            resposta: `✅ Despesa registrada: ${desc} ${formatarMoeda(valor)} (vence dia ${dia})`
        };
    }

    // Despesa parcelada
    const matchParc = msg.match(/(.+?)\s+(\d+[.,]?\d*)\s+(\d+)x/);
    if (matchParc) {
        const total = parseFloat(matchParc[2].replace(',', '.'));
        const desc = matchParc[1].charAt(0).toUpperCase() + matchParc[1].slice(1);
        const parcelas = parseInt(matchParc[3]);
        const valorParcela = total / parcelas;

        return {
            acao: 'criar_parceladas',
            dados: {
                desc,
                total,
                parcelas,
                valorParcela
            },
            resposta: `✅ Compra parcelada: ${desc} ${formatarMoeda(total)} em ${parcelas}x de ${formatarMoeda(valorParcela)}`
        };
    }

    // Despesa recorrente (academia 120 todo dia 10)
    const matchRecorrente = texto.match(/(.+?)\s+(\d+[.,]?\d*)\s+todo dia\s+(\d+)/);
    if (matchRecorrente) {
        const valor = parseFloat(matchRecorrente[2].replace(',', '.'));
        const desc = matchRecorrente[1].charAt(0).toUpperCase() + matchRecorrente[1].slice(1);
        const dia = parseInt(matchRecorrente[3]);
        
        return {
            acao: 'criar_recorrente',
            dados: {
                desc,
                valor,
                dia,
                quantidadeMeses: 12
            },
            resposta: `✅ Despesa recorrente: ${desc} ${formatarMoeda(valor)} todo dia ${dia} – geradas 12 parcelas.`
        };
    }

    // Receita
    const matchRecb = msg.match(/(recebi|deposito)\s+(.+?)\s+(\d+[.,]?\d*)/);
    if (matchRecb) {
        const valor = parseFloat(matchRecb[3].replace(',', '.'));
        const desc = matchRecb[2].charAt(0).toUpperCase() + matchRecb[2].slice(1);
        
        return {
            acao: 'criar_transacao',
            dados: {
                type: 'income',
                amount: valor,
                name: desc,
                category: 'salario',
                date: hoje.toISOString().split('T')[0]
            },
            resposta: `💰 Receita registrada: ${desc} ${formatarMoeda(valor)}`
        };
    }

    // -----------------------------------------
    // 7-8. SALDO / STATUS
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

        return {
            acao: 'responder',
            resposta: `📊 *STATUS FINANCEIRO*\n\n` +
                   `📅 Mês atual:\n` +
                   `💰 Receitas: ${formatarMoeda(receitasMes)}\n` +
                   `💸 Despesas: ${formatarMoeda(despesasMes)}\n` +
                   `💵 Saldo: ${formatarMoeda(saldoMes)}\n\n` +
                   `📈 Acumulado total:\n` +
                   `💰 Total receitas: ${formatarMoeda(totalReceitas)}\n` +
                   `💸 Total despesas: ${formatarMoeda(totalDespesas)}\n` +
                   `💎 Saldo total: ${formatarMoeda(saldoTotal)}`
        };
    }

    // -----------------------------------------
    // 9. CONTAS A PAGAR
    // -----------------------------------------
    if (msg.includes('contas a pagar') || msg.includes('o que tenho pra pagar') || msg.includes('minhas contas')) {
        const hojeData = new Date();
        const despesas = transacoes
            .filter(t => t.type === 'expense')
            .map(t => ({ ...t, dataObj: new Date(t.date) }))
            .sort((a, b) => a.dataObj - b.dataObj);

        if (despesas.length === 0) return { acao: 'responder', resposta: "✅ Nenhuma conta a pagar." };

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
        return { acao: 'responder', resposta };
    }

    // -----------------------------------------
    // 10. MAIORES CONTAS
    // -----------------------------------------
    if (msg.includes('maiores contas') || msg.includes('gastos maiores') || msg.includes('top gastos')) {
        const despesas = transacoes
            .filter(t => t.type === 'expense')
            .sort((a, b) => Number(b.amount) - Number(a.amount))
            .slice(0, 10);

        if (!despesas.length) return { acao: 'responder', resposta: "Nenhuma despesa encontrada." };

        let resposta = "💰 *MAIORES CONTAS*\n━━━━━━━━━━━━━━\n\n";
        despesas.forEach((t, i) => {
            resposta += `${i+1}. ${t.name}: ${formatarMoeda(t.amount)} (${formatarData(t.date)})\n`;
        });
        return { acao: 'responder', resposta };
    }

    // -----------------------------------------
    // 11. PRÓXIMO MÊS
    // -----------------------------------------
    if (msg.includes('mês que vem') || msg.includes('próximo mês')) {
        let mes = mesAtual + 1;
        let ano = anoAtual;
        if (mes > 12) { mes = 1; ano++; }

        const despesas = transacoes.filter(t => {
            const d = new Date(t.date);
            return t.type === 'expense' && d.getMonth() + 1 === mes && d.getFullYear() === ano;
        }).sort((a, b) => new Date(a.date) - new Date(b.date));

        if (!despesas.length) return { acao: 'responder', resposta: `📅 *${mes}/${ano}*\n\nNenhuma despesa cadastrada.` };

        let resposta = `📅 *PRÓXIMO MÊS (${mes}/${ano})*\n━━━━━━━━━━━━━━\n\n`;
        let total = 0;
        despesas.forEach(t => {
            resposta += `• ${t.name}: ${formatarMoeda(t.amount)} (${formatarData(t.date)})\n`;
            total += Number(t.amount);
        });
        resposta += `\n━━━━━━━━━━━━━━\n💰 *Total: ${formatarMoeda(total)}*`;
        return { acao: 'responder', resposta };
    }

    // -----------------------------------------
    // 12-13. ONDE GASTO MAIS (CATEGORIAS + CONTAS)
    // -----------------------------------------
    if (msg.includes('onde gasto mais') || msg.includes('categorias') || msg.includes('meus gastos')) {
        const despesas = transacoes.filter(t => t.type === 'expense');
        if (!despesas.length) return { acao: 'responder', resposta: "Nenhuma despesa encontrada." };

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

        const topContas = [...despesas]
            .sort((a, b) => Number(b.amount) - Number(a.amount))
            .slice(0, 5);

        resposta += `\n📌 *MAIORES CONTAS*\n`;
        topContas.forEach(t => {
            resposta += `• ${t.name}: ${formatarMoeda(t.amount)}\n`;
        });

        return { acao: 'responder', resposta };
    }

    // -----------------------------------------
    // 14-16. CONSULTA POR CATEGORIA
    // -----------------------------------------
    const catsLista = ['alimentação', 'moradia', 'transporte', 'saúde', 'educação', 'lazer', 'cartão', 'supermercado', 'ifood', 'academia', 'aluguel', 'internet', 'água', 'luz'];
    for (let cat of catsLista) {
        if (msg.includes(cat)) {
            const filtradas = transacoes.filter(t => 
                t.type === 'expense' && 
                (t.category?.toLowerCase().includes(cat) || t.name?.toLowerCase().includes(cat))
            ).sort((a, b) => new Date(a.date) - new Date(b.date));

            if (!filtradas.length) return { acao: 'responder', resposta: `Nenhum gasto com *${cat}*.` };

            let resposta = `🍔 *GASTOS COM ${cat.toUpperCase()}*\n━━━━━━━━━━━━━━\n\n`;
            let total = 0;
            filtradas.forEach(t => {
                resposta += `• ${t.name}: ${formatarMoeda(t.amount)} (${formatarData(t.date)})\n`;
                total += Number(t.amount);
            });
            resposta += `\n━━━━━━━━━━━━━━\n💰 *Total: ${formatarMoeda(total)}*`;
            return { acao: 'responder', resposta };
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
        return { acao: 'responder', resposta };
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

        return {
            acao: 'responder',
            resposta: `📊 *COMPARATIVO*\n` +
                   `${mesPassado}/${anoPassado} → ${mesAtual}/${anoAtual}\n━━━━━━━━━━━━━━\n\n` +
                   `💰 Receitas:\n  Antes: ${formatarMoeda(recPass)}\n  Agora: ${formatarMoeda(recAtual)}\n  ${seta(diffRec)} ${diffRec > 0 ? '+' : ''}${formatarMoeda(diffRec)}\n\n` +
                   `💸 Despesas:\n  Antes: ${formatarMoeda(despPass)}\n  Agora: ${formatarMoeda(despAtual)}\n  ${seta(diffDesp)} ${diffDesp > 0 ? '+' : ''}${formatarMoeda(diffDesp)}\n\n` +
                   `💵 Saldo:\n  Antes: ${formatarMoeda(recPass - despPass)}\n  Agora: ${formatarMoeda(recAtual - despAtual)}\n  ${seta(diffSaldo)} ${diffSaldo > 0 ? '+' : ''}${formatarMoeda(diffSaldo)}`
        };
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
        if (!mesNum) return { acao: 'responder', resposta: "Mês inválido." };

        const ano = msg.match(/\b(20\d{2})\b/)?.[1] || anoAtual;
        const filtradas = transacoes.filter(t => {
            const d = new Date(t.date);
            return d.getMonth() + 1 === mesNum && d.getFullYear() == ano;
        }).sort((a, b) => new Date(a.date) - new Date(b.date));

        if (!filtradas.length) return { acao: 'responder', resposta: `Nenhuma transação em ${mesNome}/${ano}.` };

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
        return { acao: 'responder', resposta };
    }

    // -----------------------------------------
    // 20. EXTRATO ANO
    // -----------------------------------------
    const matchAno = msg.match(/\b(20\d{2})\b/);
    if (matchAno && (msg.includes('extrato') || msg.includes('ano'))) {
        const ano = parseInt(matchAno[1]);
        const filtradas = transacoes.filter(t => new Date(t.date).getFullYear() === ano);

        if (!filtradas.length) return { acao: 'responder', resposta: `Nenhuma transação em ${ano}.` };

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
        return { acao: 'responder', resposta };
    }

    // -----------------------------------------
    // 21. AJUDA (COMANDOS)
    // -----------------------------------------
    if (msg === 'ajuda' || msg === 'help' || msg === 'comandos') {
        return {
            acao: 'responder',
            resposta: `🤖 *COMANDOS DO ATLAS*\n\n` +
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
                   `• extrato 2025`
        };
    }

    // -----------------------------------------
    // 22. NÃO ENTENDEU
    // -----------------------------------------
    return {
        acao: 'responder',
        resposta: "❓ *Não entendi*\n\nDigite *ajuda* para ver os comandos disponíveis."
    };
}

// ===========================================
// FLUXO DE LOGIN (IGUAL AO chat.html)
// ===========================================
async function fazerLogin(chatId, telefone, senha) {
    try {
        console.log(`📡 Login para ${telefone}`);
        
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: telefone, password: senha })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro no login');

        // Login bem sucedido
        sessions.set(chatId, {
            token: data.token,
            user: data.user,
            telefone,
            senha
        });

        await bot.sendMessage(chatId, 
            `✅ *Login realizado com sucesso!*\n\n` +
            `👋 Olá *${data.user.name}*! Agora você pode usar o Atlas diretamente pelo Telegram.\n\n` +
            `Digite *ajuda* para ver os comandos disponíveis.`,
            { parse_mode: 'Markdown' }
        );

        return true;
    } catch (error) {
        console.error('❌ Erro no login:', error.message);
        await bot.sendMessage(chatId, `❌ *Erro no login:* ${error.message}`, { parse_mode: 'Markdown' });
        return false;
    }
}

// ===========================================
// EXECUTAR AÇÃO (criar transação na API)
// ===========================================
async function executarAcao(chatId, acao, token) {
    if (!acao.acao || acao.acao === 'responder') {
        return acao.resposta;
    }

    if (acao.acao === 'criar_transacao') {
        try {
            const response = await fetch(`${API_URL}/transactions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(acao.dados)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Erro ao criar transação');
            }

            return acao.resposta;
        } catch (error) {
            return `❌ Erro ao registrar: ${error.message}`;
        }
    }

    if (acao.acao === 'criar_parceladas') {
        try {
            const { desc, total, parcelas, valorParcela } = acao.dados;
            const hoje = new Date();

            for (let i = 0; i < parcelas; i++) {
                const dataParcela = new Date();
                dataParcela.setMonth(hoje.getMonth() + i);

                await fetch(`${API_URL}/transactions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        type: 'expense',
                        amount: valorParcela,
                        name: `${desc} (${i+1}/${parcelas})`,
                        category: 'outros',
                        date: dataParcela.toISOString().split('T')[0],
                        recurrence_type: 'parceled',
                        current_installment: i+1,
                        total_installments: parcelas
                    })
                });
            }

            return acao.resposta;
        } catch (error) {
            return `❌ Erro ao registrar parcelas: ${error.message}`;
        }
    }

    if (acao.acao === 'criar_recorrente') {
        try {
            const { desc, valor, dia, quantidadeMeses } = acao.dados;
            const hoje = new Date();
            
            let primeiraData = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
            if (primeiraData <= hoje) {
                primeiraData = new Date(hoje.getFullYear(), hoje.getMonth() + 1, dia);
            }

            for (let i = 0; i < quantidadeMeses; i++) {
                const dataTransacao = new Date(primeiraData);
                dataTransacao.setMonth(primeiraData.getMonth() + i);

                const ano = dataTransacao.getFullYear();
                const mes = String(dataTransacao.getMonth() + 1).padStart(2, '0');
                const diaFormatado = String(dataTransacao.getDate()).padStart(2, '0');
                const dataFormatada = `${ano}-${mes}-${diaFormatado}`;

                await fetch(`${API_URL}/transactions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        type: 'expense',
                        amount: valor,
                        name: `${desc} (${i+1}/${quantidadeMeses})`,
                        category: 'outros',
                        date: dataFormatada,
                        due_day: dia,
                        recurrence_type: 'fixed'
                    })
                });
            }

            return acao.resposta;
        } catch (error) {
            return `❌ Erro ao registrar recorrente: ${error.message}`;
        }
    }

    return acao.resposta;
}

// ===========================================
// WEBHOOK DO TELEGRAM
// ===========================================
app.post('/telegram-webhook', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text;

    // Verificar se já está logado
    const session = sessions.get(chatId);

    // Se NÃO está logado
    if (!session) {
        // Se for a primeira mensagem, inicia fluxo de login
        const telefone = limparTelefone(text);
        
        if (telefone.length >= 10) {
            // Recebeu telefone, agora espera senha
            sessions.set(chatId, { aguardandoSenha: true, telefone });
            await bot.sendMessage(chatId, "📱 Telefone recebido! Agora digite sua senha:");
        } else if (sessions.get(chatId)?.aguardandoSenha) {
            // Está aguardando senha
            const senha = text;
            const telefone = sessions.get(chatId).telefone;
            
            // Tenta fazer login
            const sucesso = await fazerLogin(chatId, telefone, senha);
            
            if (!sucesso) {
                sessions.delete(chatId);
                await bot.sendMessage(chatId, "❌ Login falhou. Digite seu telefone para tentar novamente:");
            }
        } else {
            // Não está logado e não é número
            await bot.sendMessage(chatId, 
                "👋 *Bem-vindo ao Atlas Financeiro!*\n\n" +
                "Para começar, digite seu telefone (com DDI):\n" +
                "Exemplo: *5549984094010*",
                { parse_mode: 'Markdown' }
            );
        }
        
        return res.sendStatus(200);
    }

    // JÁ ESTÁ LOGADO
    try {
        // Carregar transações atuais
        const transacoesResponse = await fetch(`${API_URL}/transactions`, {
            headers: { 'Authorization': `Bearer ${session.token}` }
        });
        const transacoes = await transacoesResponse.json();

        // Processar mensagem (igual ao chat.html)
        const resultado = await processarMensagem(text, transacoes, session.user);

        // Executar ação necessária (criar transações na API)
        const resposta = await executarAcao(chatId, resultado, session.token);

        // Enviar resposta
        await bot.sendMessage(chatId, resposta, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('❌ Erro ao processar:', error);
        
        // Se token expirou, tentar relogar
        if (error.message.includes('Token') || error.message.includes('401')) {
            sessions.delete(chatId);
            await bot.sendMessage(chatId, 
                "⏰ *Sessão expirada!*\n\nDigite seu telefone para fazer login novamente:",
                { parse_mode: 'Markdown' }
            );
        } else {
            await bot.sendMessage(chatId, `❌ Erro: ${error.message}`);
        }
    }

    res.sendStatus(200);
});

// ===========================================
// ROTA PARA RECEBER RESPOSTA DO CHAT (caso queira manter compatibilidade)
// ===========================================
app.post('/resposta-telegram', express.json(), async (req, res) => {
    const { chatId, resposta } = req.body;
    
    if (chatId && resposta) {
        try {
            await bot.sendMessage(chatId, resposta, { parse_mode: 'Markdown' });
            console.log(`✅ Resposta enviada para ${chatId}`);
        } catch (error) {
            console.error('❌ Erro ao enviar:', error);
        }
    }
    
    res.json({ ok: true });
});

// ===========================================
// HEALTH CHECK
// ===========================================
app.get('/health', (req, res) => {
    res.json({ 
        status: 'online',
        sessions: sessions.size,
        mode: 'Nativo - Consulta direta à API'
    });
});

// ===========================================
// INICIAR
// ===========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🤖 BOT ATLAS RODANDO NA PORTA ${PORT}`);
    console.log(`📡 Conectando à API: ${API_URL}`);
    
    try {
        await bot.setWebHook(`https://atlas-whatsapp-bot-1.onrender.com/telegram-webhook`);
        console.log('✅ Webhook registrado no Telegram');
    } catch (error) {
        console.error('❌ Erro ao registrar webhook:', error.message);
    }
});
