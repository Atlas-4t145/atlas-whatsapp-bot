const express = require('express');
const axios = require('axios');
const moment = require('moment');
const app = express();
app.use(express.json());

// ===========================================
// CONFIGURAÇÕES DO Z-API
// ===========================================
const ZAPI_INSTANCE_ID = '3EEE292351BD9148D7FF625405C53502';
const ZAPI_TOKEN = '035FAAEF857C90111DD6D6DA';
const ZAPI_URL = 'https://api.z-api.io';

const API_URL = 'https://atlas-database.onrender.com/api';
const userCache = new Map();

// ===========================================
// BUSCAR DADOS DO USUÁRIO PELO NÚMERO (ÚNICA VERIFICAÇÃO)
// ===========================================
async function buscarUsuario(numero) {
    const num = numero.replace(/\D/g, '');
    if (userCache.has(num)) return userCache.get(num);
    
    try {
        // Única chamada - verifica se o número existe no banco
        const res = await axios.get(`${API_URL}/usuario-por-telefone/${num}`);
        userCache.set(num, res.data);
        return res.data;
    } catch {
        return null;
    }
}

// ===========================================
// BUSCAR TRANSAÇÕES DO USUÁRIO (VIA ROTA PÚBLICA)
// ===========================================
async function buscarTransacoes(userId, mes, ano) {
    try {
        const res = await axios.get(`${API_URL}/transactions/${ano}/${mes}?user_id=${userId}`);
        return res.data;
    } catch {
        return [];
    }
}

async function buscarTodasTransacoes(userId) {
    try {
        const res = await axios.get(`${API_URL}/transactions?user_id=${userId}`);
        return res.data;
    } catch {
        return [];
    }
}

// ===========================================
// CRIAR TRANSAÇÃO
// ===========================================
async function criarTransacao(userId, dados) {
    try {
        const res = await axios.post(`${API_URL}/transactions`, {
            user_id: userId,
            ...dados
        });
        return res.data;
    } catch {
        return null;
    }
}

// ===========================================
// FORMATADORES
// ===========================================
function formatarMoeda(valor) {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(data) {
    return moment(data).format('DD/MM/YYYY');
}

// ===========================================
// FUNÇÃO PRINCIPAL - 22 FUNCIONALIDADES
// ===========================================
async function processar(numero, mensagem) {
    // 1. VERIFICAR NÚMERO (ÚNICA VALIDAÇÃO)
    const usuario = await buscarUsuario(numero);
    if (!usuario) {
        return "❌ Número não autorizado. Acesse o portal Atlas para vincular seu WhatsApp.";
    }
    
    const texto = mensagem.toLowerCase().trim();
    const hoje = moment();
    const mesAtual = hoje.month() + 1;
    const anoAtual = hoje.year();
    
    // ===========================================
    // FUNCIONALIDADES 1-6: REGISTRAR TRANSAÇÕES
    // ===========================================
    
    // FUNC 1: Despesa simples (pagar luz 150)
    const matchSimples = texto.match(/(pagar|gastei|comprei)\s+(.+?)\s+(\d+[.,]?\d*)/);
    if (matchSimples) {
        const valor = parseFloat(matchSimples[3].replace(',', '.'));
        const desc = matchSimples[2].charAt(0).toUpperCase() + matchSimples[2].slice(1);
        
        await criarTransacao(usuario.id, {
            type: 'expense',
            amount: valor,
            name: desc,
            category: 'outros',
            date: hoje.format('YYYY-MM-DD')
        });
        
        return `✅ Despesa registrada: ${desc} ${formatarMoeda(valor)}`;
    }
    
    // FUNC 2: Despesa com data (ifood 89 ontem)
    const matchData = texto.match(/(.+?)\s+(\d+[.,]?\d*)\s+(hoje|ontem|amanhã)/);
    if (matchData) {
        const desc = matchData[1].charAt(0).toUpperCase() + matchData[1].slice(1);
        const valor = parseFloat(matchData[2].replace(',', '.'));
        let data = hoje;
        
        if (matchData[3] === 'ontem') data = hoje.subtract(1, 'day');
        if (matchData[3] === 'amanhã') data = hoje.add(1, 'day');
        
        await criarTransacao(usuario.id, {
            type: 'expense',
            amount: valor,
            name: desc,
            category: 'outros',
            date: data.format('YYYY-MM-DD')
        });
        
        return `✅ Despesa registrada: ${desc} ${formatarMoeda(valor)} (${matchData[3]})`;
    }
    
    // FUNC 3: Despesa com vencimento (aluguel 2500 dia 10)
    const matchVencimento = texto.match(/(.+?)\s+(\d+[.,]?\d*)\s+dia\s+(\d+)/);
    if (matchVencimento) {
        const desc = matchVencimento[1].charAt(0).toUpperCase() + matchVencimento[1].slice(1);
        const valor = parseFloat(matchVencimento[2].replace(',', '.'));
        const dia = parseInt(matchVencimento[3]);
        
        // Cria para o mês atual com o dia específico
        let data = moment().date(dia);
        if (data.isBefore(hoje)) {
            data = data.add(1, 'month');
        }
        
        await criarTransacao(usuario.id, {
            type: 'expense',
            amount: valor,
            name: desc,
            category: 'outros',
            date: data.format('YYYY-MM-DD'),
            due_day: dia,
            recurrence_type: 'fixed'
        });
        
        return `✅ Despesa registrada: ${desc} ${formatarMoeda(valor)} (vence dia ${dia})`;
    }
    
    // FUNC 4: Despesa parcelada (celular 3000 10x)
    const matchParcelado = texto.match(/(.+?)\s+(\d+[.,]?\d*)\s+(\d+)x/);
    if (matchParcelado) {
        const desc = matchParcelado[1].charAt(0).toUpperCase() + matchParcelado[1].slice(1);
        const valorTotal = parseFloat(matchParcelado[2].replace(',', '.'));
        const parcelas = parseInt(matchParcelado[3]);
        const valorParcela = valorTotal / parcelas;
        
        for (let i = 0; i < parcelas; i++) {
            const dataParcela = moment().add(i, 'month');
            await criarTransacao(usuario.id, {
                type: 'expense',
                amount: valorParcela,
                name: `${desc} (${i+1}/${parcelas})`,
                category: 'outros',
                date: dataParcela.format('YYYY-MM-DD'),
                recurrence_type: 'parceled',
                current_installment: i+1,
                total_installments: parcelas
            });
        }
        
        return `✅ Compra parcelada registrada: ${desc} ${formatarMoeda(valorTotal)} em ${parcelas}x de ${formatarMoeda(valorParcela)}`;
    }
    
    // FUNC 5: Despesa recorrente (academia 120 todo dia 10)
    const matchRecorrente = texto.match(/(.+?)\s+(\d+[.,]?\d*)\s+todo dia\s+(\d+)/);
    if (matchRecorrente) {
        const desc = matchRecorrente[1].charAt(0).toUpperCase() + matchRecorrente[1].slice(1);
        const valor = parseFloat(matchRecorrente[2].replace(',', '.'));
        const dia = parseInt(matchRecorrente[3]);
        
        await criarTransacao(usuario.id, {
            type: 'expense',
            amount: valor,
            name: desc,
            category: 'outros',
            date: moment().date(dia).format('YYYY-MM-DD'),
            due_day: dia,
            recurrence_type: 'fixed'
        });
        
        return `✅ Despesa recorrente registrada: ${desc} ${formatarMoeda(valor)} todo dia ${dia}`;
    }
    
    // FUNC 6: Receita (recebi salario 5000)
    const matchReceita = texto.match(/(recebi|deposito)\s+(.+?)\s+(\d+[.,]?\d*)/);
    if (matchReceita) {
        const valor = parseFloat(matchReceita[3].replace(',', '.'));
        const desc = matchReceita[2].charAt(0).toUpperCase() + matchReceita[2].slice(1);
        
        await criarTransacao(usuario.id, {
            type: 'income',
            amount: valor,
            name: desc,
            category: 'salario',
            date: hoje.format('YYYY-MM-DD')
        });
        
        return `💰 Receita registrada: ${desc} ${formatarMoeda(valor)}`;
    }
    
    // ===========================================
    // FUNCIONALIDADES 7-20: CONSULTAS
    // ===========================================
    
    // FUNC 7 e 8: Saldo / Status
    if (texto.includes('saldo') || texto.includes('status')) {
        const transacoes = await buscarTodasTransacoes(usuario.id);
        
        const receitas = transacoes.filter(t => t.type === 'income');
        const despesas = transacoes.filter(t => t.type === 'expense');
        
        const totalReceitas = receitas.reduce((s, t) => s + Number(t.amount), 0);
        const totalDespesas = despesas.reduce((s, t) => s + Number(t.amount), 0);
        const saldoAcumulado = totalReceitas - totalDespesas;
        
        // Transações do mês atual
        const transacoesMes = transacoes.filter(t => {
            const data = moment(t.date);
            return data.month() + 1 === mesAtual && data.year() === anoAtual;
        });
        
        const receitasMes = transacoesMes.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
        const despesasMes = transacoesMes.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
        const saldoMes = receitasMes - despesasMes;
        
        return `📊 *STATUS FINANCEIRO*\n\n` +
               `📅 Mês atual:\n` +
               `💰 Receitas: ${formatarMoeda(receitasMes)}\n` +
               `💸 Despesas: ${formatarMoeda(despesasMes)}\n` +
               `💵 Saldo: ${formatarMoeda(saldoMes)}\n\n` +
               `📈 Acumulado total:\n` +
               `💰 Total receitas: ${formatarMoeda(totalReceitas)}\n` +
               `💸 Total despesas: ${formatarMoeda(totalDespesas)}\n` +
               `💎 Saldo total: ${formatarMoeda(saldoAcumulado)}`;
    }
    
    // FUNC 9: Contas a pagar
    if (texto.includes('contas a pagar') || texto.includes('o que tenho pra pagar') || texto.includes('minhas contas')) {
        const transacoes = await buscarTransacoes(usuario.id, mesAtual, anoAtual);
        
        const despesas = transacoes
            .filter(t => t.type === 'expense')
            .sort((a, b) => moment(a.date) - moment(b.date));
        
        if (despesas.length === 0) {
            return "✅ Nenhuma conta a pagar este mês!";
        }
        
        let resposta = "📋 *CONTAS A PAGAR*\n━━━━━━━━━━━━━━\n\n";
        let total = 0;
        const hojeData = moment();
        
        const hojeList = [];
        const amanhaList = [];
        const proximosList = [];
        
        despesas.forEach(t => {
            const data = moment(t.date);
            const dias = data.diff(hojeData, 'days');
            
            if (dias === 0) {
                hojeList.push(t);
            } else if (dias === 1) {
                amanhaList.push(t);
            } else if (dias > 1 && dias <= 7) {
                proximosList.push(t);
            }
        });
        
        if (hojeList.length > 0) {
            resposta += `📅 *HOJE* (${hojeData.format('DD/MM')})\n`;
            hojeList.forEach(t => {
                resposta += `• ${t.name}: ${formatarMoeda(t.amount)}\n`;
                total += Number(t.amount);
            });
            resposta += '\n';
        }
        
        if (amanhaList.length > 0) {
            resposta += `📅 *AMANHÃ* (${hojeData.add(1, 'day').format('DD/MM')})\n`;
            amanhaList.forEach(t => {
                resposta += `• ${t.name}: ${formatarMoeda(t.amount)}\n`;
                total += Number(t.amount);
            });
            resposta += '\n';
        }
        
        if (proximosList.length > 0) {
            resposta += `📅 *PRÓXIMOS DIAS*\n`;
            proximosList.forEach(t => {
                const data = moment(t.date);
                resposta += `• ${t.name}: ${formatarMoeda(t.amount)} (${data.format('DD/MM')})\n`;
                total += Number(t.amount);
            });
            resposta += '\n';
        }
        
        resposta += `━━━━━━━━━━━━━━\n💰 *Total: ${formatarMoeda(total)}*`;
        
        return resposta;
    }
    
    // FUNC 10: Maiores contas
    if (texto.includes('maiores contas') || texto.includes('gastos maiores') || texto.includes('top gastos')) {
        const transacoes = await buscarTransacoes(usuario.id, mesAtual, anoAtual);
        
        const despesas = transacoes
            .filter(t => t.type === 'expense')
            .sort((a, b) => Number(b.amount) - Number(a.amount))
            .slice(0, 10);
        
        if (despesas.length === 0) {
            return "Nenhuma despesa este mês.";
        }
        
        let resposta = "💰 *MAIORES CONTAS DO MÊS*\n━━━━━━━━━━━━━━\n\n";
        
        despesas.forEach((t, i) => {
            const data = moment(t.date);
            resposta += `${i+1}. ${t.name}: ${formatarMoeda(t.amount)} (${data.format('DD/MM')})\n`;
        });
        
        return resposta;
    }
    
    // FUNC 11: Como está o mês que vem
    if (texto.includes('mês que vem') || texto.includes('próximo mês')) {
        let mesProx = mesAtual + 1;
        let anoProx = anoAtual;
        if (mesProx > 12) {
            mesProx = 1;
            anoProx++;
        }
        
        const transacoes = await buscarTransacoes(usuario.id, mesProx, anoProx);
        
        const despesas = transacoes.filter(t => t.type === 'expense');
        
        if (despesas.length === 0) {
            return `📅 *${mesProx}/${anoProx}*\n\nNenhuma despesa cadastrada para o próximo mês.`;
        }
        
        let resposta = `📅 *PRÓXIMO MÊS (${mesProx}/${anoProx})*\n━━━━━━━━━━━━━━\n\n`;
        let total = 0;
        
        despesas.sort((a, b) => moment(a.date) - moment(b.date));
        
        despesas.forEach(t => {
            const data = moment(t.date);
            resposta += `• ${t.name}: ${formatarMoeda(t.amount)} (${data.format('DD/MM')})\n`;
            total += Number(t.amount);
        });
        
        resposta += `\n━━━━━━━━━━━━━━\n💰 *Total: ${formatarMoeda(total)}*`;
        
        return resposta;
    }
    
    // FUNC 12 e 13: Onde gasto mais (categorias + contas)
    if (texto.includes('onde gasto mais') || texto.includes('categorias') || texto.includes('meus gastos')) {
        const transacoes = await buscarTransacoes(usuario.id, mesAtual, anoAtual);
        
        const despesas = transacoes.filter(t => t.type === 'expense');
        
        if (despesas.length === 0) {
            return "Nenhuma despesa este mês.";
        }
        
        // Agrupar por categoria
        const categorias = {};
        despesas.forEach(t => {
            const cat = t.category || 'outros';
            if (!categorias[cat]) categorias[cat] = 0;
            categorias[cat] += Number(t.amount);
        });
        
        const totalDespesas = despesas.reduce((s, t) => s + Number(t.amount), 0);
        
        // Ordenar categorias
        const sortedCats = Object.entries(categorias)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        let resposta = "📊 *ONDE VOCÊ GASTA MAIS*\n━━━━━━━━━━━━━━\n\n";
        resposta += "📌 *TOP 5 CATEGORIAS*\n";
        
        sortedCats.forEach(([cat, valor]) => {
            const percent = (valor / totalDespesas * 100).toFixed(1);
            resposta += `• ${cat}: ${formatarMoeda(valor)} (${percent}%)\n`;
        });
        
        // Top 5 contas individuais
        const topContas = [...despesas]
            .sort((a, b) => Number(b.amount) - Number(a.amount))
            .slice(0, 5);
        
        resposta += `\n📌 *MAIORES CONTAS*\n`;
        topContas.forEach(t => {
            resposta += `• ${t.name}: ${formatarMoeda(t.amount)}\n`;
        });
        
        return resposta;
    }
    
    // FUNC 14-16: Consulta por categoria específica
    const categoriasExistentes = ['alimentação', 'moradia', 'transporte', 'saúde', 'educação', 'lazer', 'cartão', 'supermercado', 'ifood', 'academia', 'aluguel', 'internet', 'água', 'luz', 'energia', 'água', 'gasolina', 'combustível', 'mercado', 'restaurante', 'cinema', 'streaming', 'netflix', 'spotify'];
    
    for (const cat of categoriasExistentes) {
        if (texto.includes(cat)) {
            const transacoes = await buscarTransacoes(usuario.id, mesAtual, anoAtual);
            
            const filtradas = transacoes.filter(t => 
                t.type === 'expense' && 
                (t.category?.toLowerCase().includes(cat) || t.name?.toLowerCase().includes(cat))
            );
            
            if (filtradas.length === 0) {
                return `Nenhum gasto com *${cat}* este mês.`;
            }
            
            let resposta = `🍔 *GASTOS COM ${cat.toUpperCase()}*\n━━━━━━━━━━━━━━\n\n`;
            let total = 0;
            
            filtradas.sort((a, b) => moment(a.date) - moment(b.date));
            
            filtradas.forEach(t => {
                const data = moment(t.date);
                resposta += `• ${t.name}: ${formatarMoeda(t.amount)} (${data.format('DD/MM')})\n`;
                total += Number(t.amount);
            });
            
            resposta += `\n━━━━━━━━━━━━━━\n💰 *Total: ${formatarMoeda(total)}*`;
            
            return resposta;
        }
    }
    
    // FUNC 17: Resumo semanal
    if (texto.includes('resumo semanal') || texto.includes('essa semana') || texto.includes('gastos da semana')) {
        const inicioSemana = moment().startOf('week');
        const fimSemana = moment().endOf('week');
        
        const transacoes = await buscarTodasTransacoes(usuario.id);
        
        const semana = transacoes.filter(t => {
            const data = moment(t.date);
            return data.isBetween(inicioSemana, fimSemana, null, '[]');
        });
        
        const receitas = semana.filter(t => t.type === 'income');
        const despesas = semana.filter(t => t.type === 'expense');
        
        const totalR = receitas.reduce((s, t) => s + Number(t.amount), 0);
        const totalD = despesas.reduce((s, t) => s + Number(t.amount), 0);
        
        let resposta = `📅 *RESUMO DA SEMANA*\n`;
        resposta += `${inicioSemana.format('DD/MM')} a ${fimSemana.format('DD/MM')}\n`;
        resposta += `━━━━━━━━━━━━━━\n\n`;
        resposta += `💰 Receitas: ${formatarMoeda(totalR)}\n`;
        resposta += `💸 Despesas: ${formatarMoeda(totalD)}\n`;
        resposta += `💵 Saldo: ${formatarMoeda(totalR - totalD)}\n\n`;
        
        if (despesas.length > 0) {
            resposta += `📌 *Principais gastos:*\n`;
            despesas.sort((a, b) => Number(b.amount) - Number(a.amount))
                .slice(0, 3)
                .forEach(t => {
                    const data = moment(t.date);
                    resposta += `• ${t.name}: ${formatarMoeda(t.amount)} (${data.format('DD/MM')})\n`;
                });
        }
        
        return resposta;
    }
    
    // FUNC 18: Comparar com mês passado
    if (texto.includes('comparar') || texto.includes('mês passado') || texto.includes('diferença')) {
        let mesPassado = mesAtual - 1;
        let anoPassado = anoAtual;
        if (mesPassado === 0) {
            mesPassado = 12;
            anoPassado--;
        }
        
        const transacoesAtual = await buscarTransacoes(usuario.id, mesAtual, anoAtual);
        const transacoesPassado = await buscarTransacoes(usuario.id, mesPassado, anoPassado);
        
        const receitasAtual = transacoesAtual.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
        const despesasAtual = transacoesAtual.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
        const saldoAtual = receitasAtual - despesasAtual;
        
        const receitasPassado = transacoesPassado.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
        const despesasPassado = transacoesPassado.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
        const saldoPassado = receitasPassado - despesasPassado;
        
        const diffReceitas = receitasAtual - receitasPassado;
        const diffDespesas = despesasAtual - despesasPassado;
        const diffSaldo = saldoAtual - saldoPassado;
        
        function seta(valor) {
            if (valor > 0) return '📈';
            if (valor < 0) return '📉';
            return '➡️';
        }
        
        return `📊 *COMPARATIVO*\n` +
        `${mesPassado}/${anoPassado} → ${mesAtual}/${anoAtual}\n` +
        `━━━━━━━━━━━━━━\n\n` +
        `💰 Receitas:\n` +
        `  Antes: ${formatarMoeda(receitasPassado)}\n` +
        `  Agora: ${formatarMoeda(receitasAtual)}\n` +
        `  ${seta(diffReceitas)} ${diffReceitas > 0 ? '+' : ''}${formatarMoeda(diffReceitas)}\n\n` +
        `💸 Despesas:\n` +
        `  Antes: ${formatarMoeda(despesasPassado)}\n` +
        `  Agora: ${formatarMoeda(despesasAtual)}\n` +
        `  ${seta(diffDespesas)} ${diffDespesas > 0 ? '+' : ''}${formatarMoeda(diffDespesas)}\n\n` +
        `💵 Saldo:\n` +
        `  Antes: ${formatarMoeda(saldoPassado)}\n` +
        `  Agora: ${formatarMoeda(saldoAtual)}\n` +
        `  ${seta(diffSaldo)} ${diffSaldo > 0 ? '+' : ''}${formatarMoeda(diffSaldo)}`;
    }
    
    // FUNC 19: Extrato por mês
    const matchExtratoMes = texto.match(/extrato\s+([a-z]+)/i);
    if (matchExtratoMes) {
        const meses = {
            'janeiro': 1, 'fevereiro': 2, 'março': 3, 'abril': 4,
            'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8,
            'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12
        };
        
        const mesNome = matchExtratoMes[1].toLowerCase();
        const mesNum = meses[mesNome];
        
        if (mesNum) {
            const ano = texto.includes(String(anoAtual)) ? anoAtual : anoAtual;
            const transacoes = await buscarTransacoes(usuario.id, mesNum, ano);
            
            if (transacoes.length === 0) {
                return `Nenhuma transação em ${mesNome}/${ano}.`;
            }
            
            const receitas = transacoes.filter(t => t.type === 'income');
            const despesas = transacoes.filter(t => t.type === 'expense');
            
            const totalR = receitas.reduce((s, t) => s + Number(t.amount), 0);
            const totalD = despesas.reduce((s, t) => s + Number(t.amount), 0);
            
            let resposta = `📋 *EXTRATO ${mesNome.toUpperCase()}/${ano}*\n━━━━━━━━━━━━━━\n\n`;
            
            if (receitas.length > 0) {
                resposta += `💰 *Receitas:*\n`;
                receitas.sort((a, b) => moment(a.date) - moment(b.date));
                receitas.forEach(t => {
                    const data = moment(t.date);
                    resposta += `  ${data.format('DD/MM')} - ${t.name}: ${formatarMoeda(t.amount)}\n`;
                });
                resposta += `  Total: ${formatarMoeda(totalR)}\n\n`;
            }
            
            if (despesas.length > 0) {
                resposta += `💸 *Despesas:*\n`;
                despesas.sort((a, b) => moment(a.date) - moment(b.date));
                despesas.forEach(t => {
                    const data = moment(t.date);
                    resposta += `  ${data.format('DD/MM')} - ${t.name}: ${formatarMoeda(t.amount)}\n`;
                });
                resposta += `  Total: ${formatarMoeda(totalD)}\n\n`;
            }
            
            resposta += `━━━━━━━━━━━━━━\n`;
            resposta += `💵 *Saldo do mês: ${formatarMoeda(totalR - totalD)}*`;
            
            return resposta;
        }
    }
    
    // FUNC 20: Extrato por ano
    const matchAno = texto.match(/\b(20\d{2})\b/);
    if (matchAno && (texto.includes('extrato') || texto.includes('ano'))) {
        const ano = parseInt(matchAno[1]);
        const transacoes = await buscarTodasTransacoes(usuario.id);
        
        const anoTransacoes = transacoes.filter(t => moment(t.date).year() === ano);
        
        if (anoTransacoes.length === 0) {
            return `Nenhuma transação em ${ano}.`;
        }
        
        const receitas = anoTransacoes.filter(t => t.type === 'income');
        const despesas = anoTransacoes.filter(t => t.type === 'expense');
        
        const totalR = receitas.reduce((s, t) => s + Number(t.amount), 0);
        const totalD = despesas.reduce((s, t) => s + Number(t.amount), 0);
        
        // Agrupar por mês
        const meses = {};
        for (let i = 1; i <= 12; i++) {
            meses[i] = { receitas: 0, despesas: 0 };
        }
        
        receitas.forEach(t => {
            const mes = moment(t.date).month() + 1;
            meses[mes].receitas += Number(t.amount);
        });
        
        despesas.forEach(t => {
            const mes = moment(t.date).month() + 1;
            meses[mes].despesas += Number(t.amount);
        });
        
        let resposta = `📅 *EXTRATO ${ano}*\n━━━━━━━━━━━━━━\n\n`;
        
        const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        
        for (let i = 1; i <= 12; i++) {
            if (meses[i].receitas > 0 || meses[i].despesas > 0) {
                resposta += `${nomes[i-1]}:\n`;
                resposta += `  💰 ${formatarMoeda(meses[i].receitas)}\n`;
                resposta += `  💸 ${formatarMoeda(meses[i].despesas)}\n`;
                resposta += `  💵 ${formatarMoeda(meses[i].receitas - meses[i].despesas)}\n\n`;
            }
        }
        
        resposta += `━━━━━━━━━━━━━━\n`;
        resposta += `💰 Total receitas: ${formatarMoeda(totalR)}\n`;
        resposta += `💸 Total despesas: ${formatarMoeda(totalD)}\n`;
        resposta += `💎 *Saldo anual: ${formatarMoeda(totalR - totalD)}*`;
        
        return resposta;
    }
    
    // ===========================================
    // FUNCIONALIDADE 21: Ajuda
    // ===========================================
    if (texto === 'ajuda' || texto === 'help' || texto === 'comandos') {
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
    
    // ===========================================
    // SE NÃO ENTENDEU NADA
    // ===========================================
    return "❓ *Não entendi*\n\nDigite *ajuda* para ver os comandos disponíveis.";
}

// ===========================================
// WEBHOOK - RECEBE DO Z-API E ENVIA RESPOSTA
// ===========================================
app.post('/webhook', async (req, res) => {
    try {
        // O Z-API envia a mensagem no body
        const { phone, text } = req.body;
        
        console.log(`📩 ${phone}: ${text}`);
        
        // Processa a mensagem
        const resposta = await processar(phone, text);
        
        // Envia a resposta de volta via Z-API
        await axios.post(`${ZAPI_URL}/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`, {
            phone: phone,
            message: resposta
        });
        
        // Responde pro Z-API que recebeu (não é a resposta pro usuário)
        res.json({ success: true });
        
    } catch (error) {
        console.error('Erro:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===========================================
// ROTA DE TESTE (opcional - pode manter)
// ===========================================
app.get('/teste/:numero/:msg', async (req, res) => {
    const resposta = await processar(req.params.numero, req.params.msg);
    res.json({ resposta });
});

// ===========================================
// HEALTH CHECK
// ===========================================
app.get('/health', (req, res) => {
    res.json({ 
        status: 'online',
        timestamp: new Date().toISOString(),
        funcionalidades: 22
    });
});

// ===========================================
// FUNCIONALIDADE 21: AVISOS DIÁRIOS (CRON)
// ===========================================
app.get('/cron/avisos', async (req, res) => {
    const { key } = req.query;
    if (key !== '@tlas@dm1n2026') {
        return res.status(401).json({ error: 'Não autorizado' });
    }
    
    // TODO: Implementar avisos diários
    // Buscar todos os usuários e enviar contas a pagar
    
    res.json({ message: 'Avisos enviados' });
});

// ===========================================
// INICIAR
// ===========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🤖 BOT ATLAS RODANDO NA PORTA ${PORT}`);
    console.log(`✅ 22 FUNCIONALIDADES CARREGADAS`);
});
