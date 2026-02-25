import express from 'express';
import client from '../baileys-client.js';

const router = express.Router();

function checkConnection(req, res, next) {
    if (!client.isConnected) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp not connected. Please scan QR code first.',
        });
    }
    next();
}

router.post('/', checkConnection, async (req, res) => {
    const { phone, message, quotedMsgId } = req.body;

    if (!phone || !message) {
        return res.status(400).json({
            success: false,
            error: 'Phone and message are required',
        });
    }

    try {
        const result = await client.sendMessage(phone, message, { quotedMsgId });
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.post('/text', checkConnection, async (req, res) => {
    const { phone, message, quotedMsgId } = req.body;

    if (!phone || !message) {
        return res.status(400).json({
            success: false,
            error: 'Phone and message are required',
        });
    }

    try {
        const result = await client.sendMessage(phone, message, { quotedMsgId });
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.post('/image', checkConnection, async (req, res) => {
    const { phone, image, filename, caption } = req.body;

    if (!phone || !image) {
        return res.status(400).json({
            success: false,
            error: 'Phone and image (base64 or URL) are required',
        });
    }

    try {
        const result = await client.sendImage(
            phone,
            image,
            filename || 'image.jpg',
            caption || ''
        );
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.post('/file', checkConnection, async (req, res) => {
    const { phone, file, filename, caption } = req.body;

    if (!phone || !file || !filename) {
        return res.status(400).json({
            success: false,
            error: 'Phone, file (base64 or URL), and filename are required',
        });
    }

    try {
        const result = await client.sendFile(phone, file, filename, caption || '');
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.post('/audio', checkConnection, async (req, res) => {
    const { phone, audio, isPtt = true } = req.body;

    if (!phone || !audio) {
        return res.status(400).json({
            success: false,
            error: 'Phone and audio (base64 or URL) are required',
        });
    }

    try {
        const result = await client.sendAudio(phone, audio, isPtt);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.post('/video', checkConnection, async (req, res) => {
    const { phone, video, filename, caption } = req.body;

    if (!phone || !video) {
        return res.status(400).json({
            success: false,
            error: 'Phone and video (base64 or URL) are required',
        });
    }

    try {
        const result = await client.sendVideo(
            phone,
            video,
            filename || 'video.mp4',
            caption || ''
        );
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.post('/location', checkConnection, async (req, res) => {
    const { phone, latitude, longitude, title, address } = req.body;

    if (!phone || latitude === undefined || longitude === undefined) {
        return res.status(400).json({
            success: false,
            error: 'Phone, latitude, and longitude are required',
        });
    }

    try {
        const result = await client.sendLocation(
            phone,
            parseFloat(latitude),
            parseFloat(longitude),
            title || '',
            address || ''
        );
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.post('/reaction', checkConnection, async (req, res) => {
    const { messageId, emoji } = req.body;

    if (!messageId || !emoji) {
        return res.status(400).json({
            success: false,
            error: 'MessageId and emoji are required',
        });
    }

    try {
        const result = await client.sendReaction(messageId, emoji);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.post('/bulk', checkConnection, async (req, res) => {
    const { recipients, message, options = {}, minDelay, maxDelay, batchSize, media, mediaType, mediaFilename } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Recipients array is required',
        });
    }

    if (!message && !media) {
        return res.status(400).json({
            success: false,
            error: 'Message or media is required',
        });
    }

    const finalOptions = {
        minDelay: options.minDelay || minDelay || 3,
        maxDelay: options.maxDelay || maxDelay || 8,
        maxRecipients: options.maxRecipients || 100,
        batchSize: options.batchSize || batchSize || 10,
    };

    if (recipients.length > finalOptions.maxRecipients) {
        return res.status(400).json({
            success: false,
            error: `Maximum ${finalOptions.maxRecipients} recipients allowed per bulk send`,
        });
    }

    try {
        const minDelayMs = finalOptions.minDelay * 1000;
        const maxDelayMs = finalOptions.maxDelay * 1000;
        
        const results = await client.sendBulkMessages(recipients, message || "", {
            minDelay: minDelayMs,
            maxDelay: maxDelayMs,
            batchSize: finalOptions.batchSize,
            media,
            mediaType,
            mediaFilename,
        });

        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        res.json({
            success: true,
            summary: {
                total: recipients.length,
                successful,
                failed,
                batchSize: finalOptions.batchSize,
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

router.post('/check-number', checkConnection, async (req, res) => {
    const { phone } = req.body;

    if (!phone) {
        return res.status(400).json({
            success: false,
            error: 'Phone number is required',
        });
    }

    try {
        const result = await client.checkNumber(phone);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

router.get('/download-media/:messageId', checkConnection, async (req, res) => {
    const { messageId } = req.params;

    if (!messageId) {
        return res.status(400).json({
            success: false,
            error: 'Message ID is required',
        });
    }

    try {
        const result = await client.downloadMedia(messageId);
        if (result.success) {
            res.json(result);
        } else {
            res.status(404).json(result);
        }
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

export default router;
