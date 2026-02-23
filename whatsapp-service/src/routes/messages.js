import express from 'express';
import client from '../baileys-client.js';

const router = express.Router();

router.get('/:phone', async (req, res) => {
    const { phone } = req.params;
    const { limit = 50 } = req.query;

    if (!client.isConnected || !client.socket) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp not connected',
        });
    }

    try {
        const formattedPhone = phone.replace(/[^0-9]/g, '');
        const jid = `${formattedPhone}@s.whatsapp.net`;

        const messages = client.store.messages[jid];
        
        if (!messages) {
            return res.json({
                success: true,
                phone: formattedPhone,
                messages: [],
            });
        }

        const messageArray = messages.array.slice(-parseInt(limit)).map(msg => ({
            id: msg.key.id,
            fromMe: msg.key.fromMe,
            content: msg.message?.conversation || 
                     msg.message?.extendedTextMessage?.text || 
                     msg.message?.imageMessage?.caption ||
                     '',
            timestamp: msg.messageTimestamp,
            status: msg.status,
        }));

        res.json({
            success: true,
            phone: formattedPhone,
            messages: messageArray,
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.get('/', async (req, res) => {
    if (!client.isConnected || !client.socket) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp not connected',
        });
    }

    try {
        const chats = Object.keys(client.store.messages || {});
        const conversations = chats
            .filter(jid => jid.endsWith('@s.whatsapp.net'))
            .map(jid => {
                const messages = client.store.messages[jid];
                const lastMessage = messages?.array?.slice(-1)[0];
                const phone = jid.replace('@s.whatsapp.net', '');
                
                return {
                    phone,
                    jid,
                    lastMessage: lastMessage ? {
                        content: lastMessage.message?.conversation ||
                                lastMessage.message?.extendedTextMessage?.text ||
                                '',
                        timestamp: lastMessage.messageTimestamp,
                        fromMe: lastMessage.key.fromMe,
                    } : null,
                    messageCount: messages?.array?.length || 0,
                };
            })
            .filter(c => c.messageCount > 0)
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

export default router;
