import express from 'express';
import client from '../baileys-client.js';

const router = express.Router();

router.get('/:phone', async (req, res) => {
    const { phone } = req.params;
    const { limit = 50 } = req.query;

    if (!client.isConnected) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp not connected',
        });
    }

    try {
        const formattedPhone = phone.replace(/[^0-9]/g, '');
        const jid = `${formattedPhone}@s.whatsapp.net`;

        const messages = [];
        const limitNum = parseInt(limit);
        
        for (const [id, msg] of client.messageStore.entries()) {
            if (msg.key?.remoteJid === jid) {
                const parsed = client.parseMessage(msg);
                if (parsed) {
                    messages.push({
                        id: msg.key.id,
                        fromMe: msg.key.fromMe,
                        content: parsed.content || '',
                        timestamp: msg.messageTimestamp,
                        type: parsed.mediaType || 'text',
                        hasMedia: !!parsed.mediaType,
                    });
                }
            }
            if (messages.length >= limitNum) break;
        }

        messages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        res.json({
            success: true,
            phone: formattedPhone,
            messages: messages.slice(0, limitNum),
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.get('/', async (req, res) => {
    if (!client.isConnected) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp not connected',
        });
    }

    try {
        const chatMap = new Map();
        
        for (const [id, msg] of client.messageStore.entries()) {
            const jid = msg.key?.remoteJid;
            if (!jid || !jid.endsWith('@s.whatsapp.net')) continue;
            
            const phone = jid.replace('@s.whatsapp.net', '');
            const existing = chatMap.get(phone);
            const timestamp = msg.messageTimestamp;
            
            if (!existing || (timestamp && timestamp > (existing.lastMessage?.timestamp || 0))) {
                const parsed = client.parseMessage(msg);
                chatMap.set(phone, {
                    phone,
                    jid,
                    name: msg.pushName || phone,
                    lastMessage: {
                        content: parsed?.content || '',
                        timestamp: timestamp,
                        fromMe: msg.key.fromMe,
                    },
                    unreadCount: 0,
                });
            }
        }
        
        const conversations = Array.from(chatMap.values())
            .sort((a, b) => {
                const aTime = a.lastMessage?.timestamp || 0;
                const bTime = b.lastMessage?.timestamp || 0;
                return bTime - aTime;
            });

        res.json({
            success: true,
            conversations,
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.get('/message/:messageId', async (req, res) => {
    const { messageId } = req.params;

    if (!client.isConnected) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp not connected',
        });
    }

    try {
        const message = await client.getMessageById(messageId);
        
        if (!message) {
            return res.status(404).json({
                success: false,
                error: 'Message not found',
            });
        }

        const parsed = client.parseMessage(message);

        res.json({
            success: true,
            message: {
                id: message.key?.id || messageId,
                fromMe: message.key?.fromMe || false,
                content: parsed?.content || '',
                timestamp: message.messageTimestamp,
                type: parsed?.mediaType || 'text',
                hasMedia: !!parsed?.mediaType,
            },
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.post('/read', async (req, res) => {
    const { phone, messageIds } = req.body;

    if (!client.isConnected) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp not connected',
        });
    }

    if (!phone) {
        return res.status(400).json({
            success: false,
            error: 'Phone number is required',
        });
    }

    try {
        const result = await client.markAsRead(phone, messageIds || []);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

export default router;
