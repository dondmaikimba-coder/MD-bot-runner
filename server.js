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
app.use(express.json({limit:'10mb'}));

const bots = new Map();
const BOTS_DIR = path.join(__dirname, 'bots');
fs.ensureDirSync(BOTS_DIR);

async function startBot(botId, phone) {
    const botPath = path.join(BOTS_DIR, botId);
    await fs.ensureDir(botPath);
    const { state, saveCreds } = await useMultiFileAuthState(botPath);
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['MD HUB','Chrome','1.0'],
        printQRInTerminal: true
    });
    bots.set(botId, { sock, qr: null, status: 'QR_Pending', phone });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const bot = bots.get(botId);
        if(!bot) return;
        if(qr) {
            bot.qr = await QRCode.toDataURL(qr);
            bot.status = 'QR_Pending';
            console.log(`[${botId}] QR Ready`);
        }
        if(connection === 'open') {
            bot.status = 'ONLINE';
            bot.qr = null;
            console.log(`[${botId}] ONLINE`);
        }
        if(connection === 'close') {
            bot.status = 'Offline';
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if(shouldReconnect) setTimeout(()=> startBot(botId, phone), 3000);
        }
    });
}

app.post('/api/deploy', async (req,res)=>{
    const { botId, phone } = req.body;
    if(!botId) return res.status(400).json({error:'botId required'});
    await startBot(botId, phone);
    res.json({ success:true, status: 'saved for pairing - hosting attached' });
});

app.get('/api/bot/:id/qr', (req,res)=>{
    const bot = bots.get(req.params.id);
    if(!bot) return res.json({ qr: null, status: 'Not Found - Deploy first' });
    res.json({ qr: bot.qr, status: bot.status });
});

app.post('/api/bot/:id/restart', async (req,res)=>{
    const id = req.params.id;
    const b = bots.get(id);
    if(b) try{ b.sock.end(); }catch(e){}
    await startBot(id, b?.phone || '');
    res.json({ success:true });
});

app.get('/', (req,res)=> res.send('MD HUB Runner Online - Powered by VibeSkillz - QR API Ready'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log('Runner ONLINE on '+PORT));