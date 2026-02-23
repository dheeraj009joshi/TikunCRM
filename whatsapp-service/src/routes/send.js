import express from 'express';
import client from '../baileys-client.js';

const router = express.Router();

router.post('/', async (req, res) => {
    const { phone, message } = req.body;

    if (!phone || !message) {
        return res.status(400).json({
            success: false,
            error: 'Phone and message are required',
        });
    }

    // Check connection first
    if (!client.isConnected || !client.socket) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp not connected. Please scan QR code first.',
        });
    }

    try {
        const result = await client.sendMessage(phone, message);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.post('/bulk', async (req, res) => {
    const { recipients, message, options = {} } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Recipients array is required',
        });
    }

    if (!message) {
        return res.status(400).json({
            success: false,
            error: 'Message is required',
        });
    }

    // Check connection first
    if (!client.isConnected || !client.socket) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp not connected. Please scan QR code first.',
        });
    }

    const maxRecipients = options.maxRecipients || 100;
    if (recipients.length > maxRecipients) {
        return res.status(400).json({
            success: false,
            error: `Maximum ${maxRecipients} recipients allowed per bulk send`,
        });
    }

    try {
        // Convert seconds to milliseconds if needed (Python sends seconds)
        const minDelayMs = (options.minDelay || 3) * 1000;
        const maxDelayMs = (options.maxDelay || 8) * 1000;
        
        const results = await client.sendBulkMessages(recipients, message, {
            minDelay: minDelayMs,
            maxDelay: maxDelayMs,
        });

        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        res.json({
            success: true,
            summary: {
                total: recipients.length,
                successful,
                failed,
            },
            results,
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.post('/check-number', async (req, res) => {
    const { phone } = req.body;

    if (!phone) {
        return res.status(400).json({
            success: false,
            error: 'Phone number is required',
        });
    }

    if (!client.isConnected || !client.socket) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp not connected',
        });
    }

    try {
        const formattedPhone = phone.replace(/[^0-9]/g, '');
        const jid = `${formattedPhone}@s.whatsapp.net`;
        const [exists] = await client.socket.onWhatsApp(jid);

        res.json({
            success: true,
            phone: formattedPhone,
            exists: !!exists,
            jid: exists ? exists.jid : null,
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

export default router;
