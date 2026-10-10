const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const fs = require('fs');

// ================= CONFIG =================
const SENHA = "Tokinhadev7"; // ideal: definir BOT_SENHA no ambiente
const MAX_ADVERTENCIAS = 3;                            // ao chegar nisso, o usuário é removido
const DB_FILE = './dados.json';
const TIMEZONE = 'America/Sao_Paulo';

// ================= DADOS (salvos em arquivo) =================
const padrao = {
    grupos: [],        // grupos onde o bot está ativado
    antilink: [],      // grupos com anti-link ligado
    palavras: ['px', 'pix', 'fazer pix', 'fazerpix'],
    advertencias: {}   // { grupoId: { usuarioId: numero } }
};

function carregar() {
    try {
        return { ...padrao, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
    } catch {
        return JSON.parse(JSON.stringify(padrao));
    }
}
const db = carregar();
const salvar = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// ================= TEXTO DE AJUDA =================
const textoAjuda = `*Bot oficial do serve🤖*
~Familia 171 bot🤖~

comandos▼
🗑️ *!apagar* -- Apaga a mensagem respondida
❓ *!ajuda* -- Mostra este menu
⛔ *!ban @usuario* -- Bane o usuário (ou responda a mensagem dele)

🔞 *!+18* -- Apaga vídeo/foto respondido + adverte o autor
🔃 *!zerar @usuario* -- Redefine as advertências
⚠️ *!advertencias [@usuario]* -- Vê advertências

➕ *!addpalavra* -- Adiciona palavra proibida
➖ *!rempalavra* -- Remove palavra proibida
📋 *!listapalavras* -- Mostra palavras proibidas

🔐 *!senha <senha>* -- Liga o bot neste grupo
🥸 *!troca_rosto* -- Site de troca rosto
🙍 *!troca_corpo* -- Site de troca corpo
📱 *!iPhone* -- Site de saque

🔗 *!antilink on/off* -- Liga/Desativa o anti-link
🔒 *!fechar* -- Fecha o grupo (só admins falam)
🔓 *!abrir* -- Abre o grupo
⏰ *Auto: abre às 07:00 e fecha à 00:00*

🖼️ *!s* -- Cria figurinhas
🏓 *!ping* -- Testa se o bot está online
🩺 *!status* -- Diagnóstico do bot

_Comandos de moderação: só admins._`;

// ================= CLIENT =================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    }
});

// Se preferir parear por número (substitua pelo seu número com DDI e DDD, ex: 5511999999999)
// Opcional: client.on('qr', ...) pode ser substituído ou complementado

client.on('auth_failure', msg => console.log('Falha na autenticação', msg));
client.on('qr', async (qr) => {
    // Se a plataforma gerar uma URL web do QR code, você pode usá-la em geradores compatíveis
    console.log('QR Code gerado. Acesse os logs detalhados.');
});
client.on('ready', () => console.log('Bot iniciado :3'));

// ================= HELPERS =================
const ehGrupo = id => id.endsWith('@g.us');
const escapar = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const numero = id => id.split('@')[0];

// palavra inteira (evita apagar "expixel" por causa de "pix", por exemplo)
function contemPalavraProibida(texto) {
    return db.palavras.some(p => {
        const re = new RegExp(`(^|[^a-z0-9à-ú])${escapar(p.toLowerCase())}($|[^a-z0-9à-ú])`);
        return re.test(texto);
    });
}

const temLink = texto => /(https?:\/\/|www\.|chat\.whatsapp\.com)/i.test(texto);

const soNumero = id => (id || '').split('@')[0].split(':')[0];

async function idsEquivalentes(userId, extras = []) {
    const ids = new Set();
    const add = v => { if (v) { ids.add(v); ids.add(soNumero(v)); } };
    add(userId);
    extras.forEach(add);
    try {
        if (typeof client.getContactLidAndPhone === 'function') {
            const r = await client.getContactLidAndPhone([userId]);
            for (const x of r || []) { add(x.lid); add(x.pn); }
        }
    } catch {}
    return ids;
}

async function ehAdmin(chat, userId, extras = []) {
    const ids = await idsEquivalentes(userId, extras);
    return chat.participants.some(p =>
        (p.isAdmin || p.isSuperAdmin) &&
        (ids.has(p.id._serialized) || ids.has(soNumero(p.id._serialized)))
    );
}

function addAdvertencia(grupoId, userId) {
    db.advertencias[grupoId] = db.advertencias[grupoId] || {};
    db.advertencias[grupoId][userId] = (db.advertencias[grupoId][userId] || 0) + 1;
    salvar();
    return db.advertencias[grupoId][userId];
}

// Advertência + remoção automática ao atingir o limite
async function adverter(chat, userId, botAdmin) {
    const total = addAdvertencia(chat.id._serialized, userId);
    if (total >= MAX_ADVERTENCIAS && botAdmin) {
        try {
            await chat.removeParticipants([userId]);
            db.advertencias[chat.id._serialized][userId] = 0;
            salvar();
            await chat.sendMessage(`⛔ @${numero(userId)} atingiu ${MAX_ADVERTENCIAS} advertências e foi removido.`, { mentions: [userId] });
        } catch (e) {
            console.log('Erro ao remover por advertências:', e.message);
        }
    }
    return total;
}

// ================= AGENDAMENTO =================
async function agendar(abrir) {
    for (const id of db.grupos) {
        try {
            const chat = await client.getChatById(id);
            await chat.setMessagesAdminsOnly(!abrir);
            await chat.sendMessage(abrir
                ? '⏰ Bom dia! O grupo foi aberto automaticamente.'
                : '⏰ Meia-noite! O grupo foi fechado automaticamente. Até amanhã!');
        } catch (e) {
            console.log('Aviso no cron (ignorado):', e.message);
        }
    }
}
cron.schedule('0 7 * * *', () => agendar(true), { timezone: TIMEZONE });
cron.schedule('0 0 * * *', () => agendar(false), { timezone: TIMEZONE });

// ================= MENSAGENS =================
client.on('message_create', async (msg) => {
    try {
        await tratar(msg);
    } catch (e) {
        console.log('Erro ao tratar mensagem:', e && e.stack ? e.stack : e);
    }
});

async function tratar(msg) {
    const corpo = (msg.body || '').trim();
    const texto = corpo.toLowerCase();
    const [cmdBruto = '', ...args] = corpo.split(/\s+/);
    const cmd = cmdBruto.toLowerCase();

    if (!ehGrupo(msg.from)) {
        if (cmd.startsWith('!')) await msg.reply('Os comandos só funcionam em grupos.');
        return;
    }

    const grupoId = msg.from;
    const autor = msg.author || msg.from;

    // --- Ativação por senha (única coisa permitida com o bot desligado) ---
    if (cmd === '!senha') {
        if (args.join(' ') === SENHA) {
            if (!db.grupos.includes(grupoId)) {
                db.grupos.push(grupoId);
                salvar();
            }
            try { await msg.delete(true); } catch {} // apaga a mensagem com a senha, se o bot for admin
            await client.sendMessage(grupoId, 'Senha correta! Bot ativado neste grupo com sucesso.');
        } else {
            await msg.reply('Senha incorreta.');
        }
        return;
    }

    if (!db.grupos.includes(grupoId)) {
        if (cmd.startsWith('!')) {
            await msg.reply('O bot não está ativado neste grupo. Para ativar, use o comando !senha <senha>.');
        }
        return;
    }

    let chat = null;
    try {
        chat = await msg.getChat();
    } catch (e) {
        console.log('msg.getChat falhou:', e.message);
        try {
            chat = await client.getChatById(grupoId);
        } catch (e2) {
            console.log('getChatById falhou:', e2.message);
        }
    }
    if (!chat || !chat.participants) {
        console.log('Não foi possível ler os dados do grupo. Atualize o whatsapp-web.js e apague a pasta .wwebjs_cache.');
        if (cmd.startsWith('!')) await msg.reply('⚠️ Não consegui ler os dados do grupo agora. O dono do bot precisa atualizar o whatsapp-web.js.');
        return;
    }
    if (cmd === '!troca_rosto') {
        await msg.reply('Aqui está o link para a ferramenta:\n`https://aifaceswap.io/pt/`');
        return;
    } else if (cmd === '!troca_corpo') {
        await msg.reply('Aqui está o link para a ferramenta:\n`https://remaker.ai/pt/face-swap-free/`');
        return;
    } else if (cmd === '!iphone') {
        await msg.reply('Aqui está o link para a ferramenta:\n`https://h5game.pocketliveapp.com/webpage/#/withdrawalLogin`');
        return;
    }
    const botId = client.info.wid._serialized;
const botAdmin = await ehAdmin(chat, botId, [client.info.lid && (client.info.lid._serialized || client.info.lid)]);

let contato = null;
try { contato = await msg.getContact(); } catch {}
const admin = msg.fromMe || await ehAdmin(chat, autor, [contato && contato.id && contato.id._serialized, contato && contato.number]);

if (cmd.startsWith('!') && !admin) {
    console.log('Não reconheci como admin:', autor, '| admins do grupo:',
        chat.participants.filter(p => p.isAdmin || p.isSuperAdmin).map(p => p.id._serialized));
}

    // --- Filtros automáticos (não valem para admins) ---
    if (!admin) {
        if (contemPalavraProibida(texto)) {
    try {
        await msg.delete(true);
        const total = await adverter(chat, autor, botAdmin);
        await chat.sendMessage(
            `⚠️ Não é permitido falar sobre isso aqui! @${numero(autor)} foi advertido (${total}/${MAX_ADVERTENCIAS}).`,
            { mentions: [autor] }
        );
    } catch {}
    return;
}
        if (db.antilink.includes(grupoId) && temLink(texto)) {
        try {
            await msg.delete(true);
            const total = await adverter(chat, autor, botAdmin);
            await chat.sendMessage(
                `🚫 Links não são permitidos! @${numero(autor)} foi advertido (${total}/${MAX_ADVERTENCIAS}).`,
                { mentions: [autor] }
        );
    } catch {}
    return;
}
    }

    if (!cmd.startsWith('!')) return;

    // --- Comandos livres ---
    if (cmd === '!ajuda') return void (await msg.reply(textoAjuda));
    if (cmd === '!ping') return void (await msg.reply('Bot online e funcionando!'));
    if (cmd === '!status') {
        return void (await msg.reply(
            `🩺 *Status*\nBot: online\nAdmin no grupo: ${botAdmin ? 'sim ✅' : 'não ❌ (preciso ser admin para moderar)'}\n` +
            `Anti-link: ${db.antilink.includes(grupoId) ? 'ligado' : 'desligado'}\nPalavras proibidas: ${db.palavras.length}`
        ));
    }

    if (cmd === '!s') {
        const alvo = msg.hasMedia ? msg : (msg.hasQuotedMsg ? await msg.getQuotedMessage() : null);
        if (!alvo || !alvo.hasMedia) {
            return void (await msg.reply('Envie uma imagem/vídeo com !s na legenda, ou responda uma mídia com !s.'));
        }
        const media = await alvo.downloadMedia();
        await client.sendMessage(grupoId, media, { sendMediaAsSticker: true, quotedMessageId: msg.id._serialized });
        return;
    }

    if (cmd === '!troca' || texto === '!link troca de rosto') {
        await msg.reply('Aqui está o link para a ferramenta:\n`https://aifaceswap.io/pt/`');
    }

    // --- Comandos de admin ---
    const restritos = ['!ban', '!fechar', '!abrir', '!+18', '!advertencias', '!advertências', '!zerar',
        '!addpalavra', '!rempalavra', '!listapalavras', '!apagar', '!antilink'];
    if (!restritos.includes(cmd)) return;

    if (!admin) return void (await msg.reply('⛔ Só administradores podem usar este comando.'));

    const precisaBotAdmin = ['!ban', '!fechar', '!abrir', '!+18', '!apagar'];
    if (precisaBotAdmin.includes(cmd) && !botAdmin) {
        return void (await msg.reply('Preciso ser administrador do grupo para fazer isso.'));
    }

    // alvo = usuários marcados, ou o autor da mensagem respondida
    async function pegarAlvos() {
        let ids = [...(msg.mentionedIds || [])].map(i => (typeof i === 'string' ? i : i._serialized));
        if (!ids.length && msg.hasQuotedMsg) {
            const q = await msg.getQuotedMessage();
            ids = [q.author || q.from];
        }
        return ids;
    }

    switch (cmd) {
        case '!ban': {
            const alvos = await pegarAlvos();
            if (!alvos.length) return void (await msg.reply('Marque (@) ou responda o usuário que deseja banir.'));
            for (const id of alvos) {
                if (id === botId || await ehAdmin(chat, id)) {
                    await msg.reply('Ta tentando banir logo o mestre platina?');
                    continue;
                }
                try {
                    await chat.removeParticipants([id]);
                } catch (e) {
                    await msg.reply(`Erro ao banir @${numero(id)}.`);
                }
            }
            await msg.reply('Comando de ban executado!');
            break;
        }

        case '!fechar':
            await chat.setMessagesAdminsOnly(true);
            await chat.sendMessage('Grupo fechado! Apenas administradores podem enviar mensagens.');
            break;

        case '!abrir':
            await chat.setMessagesAdminsOnly(false);
            await chat.sendMessage('Grupo aberto!');
            break;

        case '!apagar': {
            if (!msg.hasQuotedMsg) return void (await msg.reply('Responda à mensagem que deseja apagar com o comando !apagar.'));
            const q = await msg.getQuotedMessage();
            await q.delete(true);
            try { await msg.delete(true); } catch {}
            break;
        }

        case '!+18': {
            if (!msg.hasQuotedMsg) return void (await msg.reply('Responda à mensagem +18 que deseja apagar.'));
            const q = await msg.getQuotedMessage();
            const infrator = q.author || q.from;
            await q.delete(true);
            const total = await adverter(chat, infrator, botAdmin);
            await chat.sendMessage(
                `🔞 Conteúdo +18 removido! @${numero(infrator)} foi advertido (${total}/${MAX_ADVERTENCIAS}).`,
                { mentions: [infrator] }
            );
            break;
        }

        case '!advertencias':
        case '!advertências': {
            const alvos = await pegarAlvos();
            const lista = db.advertencias[grupoId] || {};
            if (alvos.length) {
                const id = alvos[0];
                return void (await msg.reply(`@${numero(id)} tem ${lista[id] || 0}/${MAX_ADVERTENCIAS} advertências.`, undefined, { mentions: [id] }));
            }
            const linhas = Object.entries(lista).filter(([, n]) => n > 0).map(([id, n]) => `• @${numero(id)}: ${n}/${MAX_ADVERTENCIAS}`);
            await msg.reply(linhas.length ? `⚠️ *Advertências:*\n${linhas.join('\n')}` : 'Ninguém tem advertências neste grupo.',
                undefined, { mentions: Object.keys(lista) });
            break;
        }

        case '!zerar': {
            const alvos = await pegarAlvos();
            if (!alvos.length) return void (await msg.reply('Marque (@) o usuário: !zerar @usuario'));
            db.advertencias[grupoId] = db.advertencias[grupoId] || {};
            alvos.forEach(id => (db.advertencias[grupoId][id] = 0));
            salvar();
            await msg.reply('As advertências foram zeradas.');
            break;
        }

        case '!addpalavra': {
            const nova = args.join(' ').toLowerCase();
            if (!nova) return void (await msg.reply('Por favor, forneça uma palavra para adicionar.'));
            if (db.palavras.includes(nova)) return void (await msg.reply('Essa palavra já está na lista.'));
            db.palavras.push(nova);
            salvar();
            await msg.reply(`A palavra/termo "${nova}" foi adicionada à lista de palavras proibidas.`);
            break;
        }

        case '!rempalavra': {
            const remover = args.join(' ').toLowerCase();
            if (!remover) return void (await msg.reply('Por favor, forneça uma palavra para remover.'));
            const i = db.palavras.indexOf(remover);
            if (i === -1) return void (await msg.reply('Essa palavra não foi encontrada na lista.'));
            db.palavras.splice(i, 1);
            salvar();
            await msg.reply(`A palavra "${remover}" foi removida da lista.`);
            break;
        }

        case '!listapalavras':
            await msg.reply(`Palavras proibidas: ${db.palavras.join(', ') || '(nenhuma)'}`);
            break;

        case '!antilink': {
            const opcao = (args[0] || '').toLowerCase();
            if (opcao === 'on') {
                if (!db.antilink.includes(grupoId)) db.antilink.push(grupoId);
                salvar();
                await msg.reply('Anti-link ativado.');
            } else if (opcao === 'off') {
                db.antilink = db.antilink.filter(g => g !== grupoId);
                salvar();
                await msg.reply('Anti-link desativado.');
            } else {
                await msg.reply('Use: !antilink on ou !antilink off');
            }
            break;
        }
    }
}

client.initialize();