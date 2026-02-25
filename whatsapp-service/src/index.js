import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import axios from 'axios';
import client from './baileys-client.js';
import qrRoutes from './routes/qr.js';
import sendRoutes from './routes/send.js';
import messagesRoutes from './routes/messages.js';

const app = express();
const PORT = process.env.PORT || 3001;
const PYTHON_WEBHOOK_URL = process.env.PYTHON_WEBHOOK_URL || 'http://localhost:8000/api/v1/whatsapp-baileys/webhook/incoming';
const PYTHON_STATUS_WEBHOOK_URL = process.env.PYTHON_STATUS_WEBHOOK_URL || 'http://localhost:8000/api/v1/whatsapp-baileys/webhook/status';

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const wsClients = new Set();

wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    wsClients.add(ws);

    client.getStatus().then(status => {
        ws.send(JSON.stringify({
            type: 'status',
            data: status,
        }));
    });

    ws.on('close', () => {
        console.log('WebSocket client disconnected');
        wsClients.delete(ws);
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        wsClients.delete(ws);
    });
});

function broadcastToClients(message) {
    const data = JSON.stringify(message);
    wsClients.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
            ws.send(data);
        }
    });
}

client.onStatusChange(async (status, data) => {
    console.log('Status changed:', status, data);
    
    if (status === 'message_status') {
        broadcastToClients({
            type: 'message_status',
            data: data,
        });
        
        const statusSuccess = await sendWebhookWithRetry(PYTHON_STATUS_WEBHOOK_URL, {
            messageId: data.messageId,
            status: data.status,
            remoteJid: data.remoteJid,
            phone: data.phone,
        }, 2);
        
        if (statusSuccess) {
            console.log(`Status update sent to Python: ${data.messageId} -> ${data.status} (phone: ${data.phone})`);
        } else {
            console.error('Failed to send status update to Python after retries');
        }
    } else if (status === 'presence') {
        broadcastToClients({
            type: 'presence',
            data: data,
        });
    } else if (status === 'incoming_call') {
        broadcastToClients({
            type: 'incoming_call',
            data: data,
        });
    } else {
        broadcastToClients({
            type: 'status',
            status,
            data,
        });
    }
});

async function sendWebhookWithRetry(url, data, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await axios.post(url, data, { timeout: 15000 });
            return true;
        } catch (err) {
            const isLastAttempt = attempt === maxRetries;
            console.error(`Webhook attempt ${attempt}/${maxRetries} failed:`, err.message);
            if (!isLastAttempt) {
                const delay = attempt * 1000;
                console.log(`Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    return false;
}

client.onMessage(async (message) => {
    console.log('Incoming message:', message);
    
    if (message.remoteJid?.includes('@g.us')) {
        console.log(`Skipping group message from ${message.remoteJid}`);
        return;
    }
    
    const digitsOnly = message.phone?.replace(/\D/g, '');
    if (!digitsOnly || digitsOnly.length < 10) {
        console.log(`Skipping message with invalid phone: ${message.phone}`);
        return;
    }
    
    const normalizedPhone = digitsOnly.length > 12 ? digitsOnly.slice(-12) : digitsOnly;
    
    // Handle reactions differently
    if (message.isReaction) {
        broadcastToClients({
            type: 'reaction',
            data: {
                phone: normalizedPhone,
                messageId: message.reactionToMsgId,
                emoji: message.reactionEmoji,
                fromMe: false,
            },
        });
        console.log(`Reaction ${message.reactionEmoji} received for message ${message.reactionToMsgId}`);
        return;
    }
    
    broadcastToClients({
        type: 'message',
        data: { ...message, phone: normalizedPhone },
    });

    const success = await sendWebhookWithRetry(PYTHON_WEBHOOK_URL, {
        from: normalizedPhone,
        body: message.content,
        id: message.id,
        mediaUrl: message.mediaUrl,
        mediaType: message.mediaType,
        pushName: message.pushName,
        timestamp: message.timestamp,
        quotedMsgId: message.quotedMsgId,
    });
    
    if (success) {
        console.log('Webhook sent successfully to Python backend');
    } else {
        console.error('Failed to send webhook to Python backend after all retries');
    }
});

app.use('/qr', qrRoutes);
app.use('/send', sendRoutes);
app.use('/messages', messagesRoutes);

app.get('/status', async (req, res) => {
    res.json(await client.getStatus());
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

app.post('/disconnect', async (req, res) => {
    try {
        await client.disconnect();
        res.json({ success: true, message: 'Disconnected (session preserved)' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/logout', async (req, res) => {
    try {
        await client.logout();
        res.json({ success: true, message: 'Logged out (session cleared)' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/reconnect', async (req, res) => {
    try {
        await client.connect();
        res.json({ success: true, message: 'Reconnecting...' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/presence/subscribe', async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ success: false, error: 'Phone number required' });
    }
    
    try {
        const result = await client.subscribeToPresence(phone);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

server.listen(PORT, async () => {
    console.log(`WhatsApp service running on port ${PORT}`);
    console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
    
    console.log('Starting WhatsApp connection with Baileys...');
    await client.connect();
});

process.on('SIGINT', async () => {
    console.log('Shutting down (session preserved)...');
    await client.disconnect();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down...');
    await client.disconnect();
    process.exit(0);
});
