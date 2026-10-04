const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
app.use(cors({origin:'*'}));
app.use(express.json());

const bots = new Map(); // botId -> { sock, qr, status }
const BOTS_DIR = path.join(__dirname, 'bots');
fs.ensureDirSync(BOTS_DIR);

async function startBot(botId, phone) {
    const botPath = path.join(BOTS_DIR, botId);
    await fs.ensureDir(botPath);
    const { state, saveCreds } = await useMultiFileAuthState(botPath);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['MD HUB', 'Chrome', '1.0'],
        printQRInTerminal: false
    });

    bots.set(botId, { sock, qr: null, status: 'QR_Pending', phone });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const bot = bots.get(botId);
        if(!bot) return;

        if(qr) {
            const qrImage = await QRCode.toDataURL(qr);
            bot.qr = qrImage;
            bot.status = 'QR_Pending';
            console.log(`[${botId}] QR generated`);
        }
        if(connection === 'open') {
            bot.status = 'Online';
            bot.qr = null;
            console.log(`[${botId}] ONLINE`);
        }
        if(connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut;
            bot.status = 'Offline';
            if(shouldReconnect) {
                setTimeout(() => startBot(botId, phone), 3000);
            }
        }
    });

    // SIMPLE COMMAND HANDLER - Your bot logic
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if(!m?.message || m.key.fromMe) return;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
        const from = m.key.remoteJid;
        if(text === '.ping') await sock.sendMessage(from, { text: 'MD HUB 24/7 Online ✅\nPowered by VibeSkillz Technologies' });
    });
}

// API FOR YOUR BASE44 FRONTEND TO CALL
app.post('/api/deploy', async (req, res) => {
    const { botId, phone } = req.body; // botId = +263773139866 from your screenshot
    if(!botId) return res.status(400).json({error:'botId required'});
    await startBot(botId, phone);
    res.json({ success: true, botId, message: 'Bot saved for pairing' });
});

app.get('/api/bot/:id/qr', (req, res) => {
    const bot = bots.get(req.params.id);
    if(!bot) return res.status(404).json({error:'not found'});
    res.json({ qr: bot.qr, status: bot.status });
});

app.post('/api/bot/:id/restart', async (req, res) => {
    const { id } = req.params;
    const bot = bots.get(id);
    if(bot) { try{ bot.sock.end(); }catch(e){} }
    await startBot(id, bot?.phone);
    console.log(`[${id}] restart requested (hosting service attached)`);
    res.json({ success: true, status: 'Restarting' });
});

app.post('/api/bot/:id/stop', (req, res) => {
    const bot = bots.get(req.params.id);
    if(bot) { bot.sock.end(); bot.status='Offline'; }
    res.json({ success: true });
});

app.get('/', (req,res)=> res.send('MD HUB Runner Online - Powered by VibeSkillz'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log('Runner on '+PORT));