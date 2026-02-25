import express from 'express';
import client from '../baileys-client.js';

const router = express.Router();

router.get('/', async (req, res) => {
    const qrCodeBase64 = client.getQrCode();
    
    if (!qrCodeBase64) {
        const status = await client.getStatus();
        if (status.connected) {
            return res.json({
                success: true,
                connected: true,
                message: 'Already connected to WhatsApp',
            });
        }
        return res.json({
            success: false,
            connected: false,
            message: 'QR code not available yet. Please wait...',
        });
    }

    res.json({
        success: true,
        connected: false,
        qr: qrCodeBase64,
    });
});

router.get('/image', async (req, res) => {
    const qrCodeBase64 = client.getQrCode();
    
    if (!qrCodeBase64) {
        const status = await client.getStatus();
        if (status.connected) {
            return res.status(200).send('Already connected');
        }
        return res.status(404).send('QR code not available');
    }

    try {
        const imageBuffer = Buffer.from(qrCodeBase64, 'base64');
        res.set('Content-Type', 'image/png');
        res.send(imageBuffer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/base64', async (req, res) => {
    const qrCodeBase64 = client.getQrCode();
    
    if (!qrCodeBase64) {
        const status = await client.getStatus();
        if (status.connected) {
            return res.json({
                success: true,
                connected: true,
                message: 'Already connected',
                phoneNumber: status.phoneNumber,
            });
        }
        return res.json({
            success: false,
            connected: false,
            message: 'QR code not available',
        });
    }

    res.json({
        success: true,
        connected: false,
        qr: qrCodeBase64,
    });
});

export default router;
