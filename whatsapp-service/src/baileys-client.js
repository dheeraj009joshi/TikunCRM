import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ level: 'silent' });

class BaileysClient {
    constructor() {
        this.socket = null;
        this.qrCode = null;
        this.qrCodeBase64 = null;
        this.isConnected = false;
        this.connectionState = 'disconnected';
        this.messageHandlers = [];
        this.statusHandlers = [];
        this.authPath = path.join(__dirname, '..', 'auth');
        this.isConnecting = false; // Prevent multiple connection attempts
        
        if (!fs.existsSync(this.authPath)) {
            fs.mkdirSync(this.authPath, { recursive: true });
        }
    }

    onMessage(handler) {
        this.messageHandlers.push(handler);
    }

    onStatusChange(handler) {
        this.statusHandlers.push(handler);
    }

    notifyStatusChange(status, data = {}) {
        this.connectionState = status;
        this.statusHandlers.forEach(handler => {
            try {
                handler(status, data);
            } catch (err) {
                console.error('Status handler error:', err);
            }
        });
    }

    async connect() {
        // Prevent multiple simultaneous connection attempts
        if (this.isConnecting) {
            console.log('Connection already in progress, skipping...');
            return;
        }
        
        this.isConnecting = true;
        
        try {
            // Close existing socket if any
            if (this.socket) {
                console.log('Closing existing socket...');
                this.socket.ev.removeAllListeners();
                this.socket.end();
                this.socket = null;
            }
            
            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
            const { version } = await fetchLatestBaileysVersion();

            this.socket = makeWASocket({
                version,
                auth: state,
                logger,
                printQRInTerminal: false, // Disabled - we handle QR ourselves
                browser: ['LeedsCRM', 'Chrome', '120.0.0'],
                syncFullHistory: false,
                markOnlineOnConnect: true,
            });

            this.socket.ev.on('creds.update', saveCreds);

            this.socket.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    this.qrCode = qr;
                    this.isConnected = false;
                    // Convert QR to base64 image for frontend
                    try {
                        const qrBase64 = await QRCode.toDataURL(qr, {
                            width: 300,
                            margin: 2,
                        });
                        // Remove the data:image/png;base64, prefix for cleaner storage
                        const base64Only = qrBase64.replace(/^data:image\/png;base64,/, '');
                        this.qrCodeBase64 = base64Only;
                        this.notifyStatusChange('qr', { qr: base64Only });
                        console.log('QR Code received and converted to base64');
                    } catch (err) {
                        console.error('Failed to convert QR to base64:', err);
                        this.qrCodeBase64 = null;
                        this.notifyStatusChange('qr', { qr });
                    }
                }

                if (connection === 'close') {
                    this.isConnected = false;
                    this.isConnecting = false; // Reset connecting flag
                    this.qrCode = null;
                    const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;

                    if (reason === DisconnectReason.loggedOut) {
                        console.log('Logged out, clearing auth...');
                        this.notifyStatusChange('logged_out');
                        fs.rmSync(this.authPath, { recursive: true, force: true });
                        fs.mkdirSync(this.authPath, { recursive: true });
                        setTimeout(() => this.connect(), 5000);
                    } else if (reason === DisconnectReason.connectionClosed || 
                               reason === DisconnectReason.connectionLost) {
                        console.log('Connection lost, reconnecting in 5s...');
                        this.notifyStatusChange('reconnecting');
                        setTimeout(() => this.connect(), 5000);
                    } else if (reason === DisconnectReason.restartRequired) {
                        console.log('Restart required, reconnecting...');
                        this.notifyStatusChange('reconnecting');
                        setTimeout(() => this.connect(), 3000);
                    } else {
                        console.log('Disconnected, reason:', reason);
                        this.notifyStatusChange('disconnected', { reason });
                        // Only reconnect if not a permanent error
                        if (reason !== 401 && reason !== 403) {
                            setTimeout(() => this.connect(), 10000);
                        }
                    }
                }

                if (connection === 'open') {
                    this.isConnected = true;
                    this.isConnecting = false; // Reset connecting flag
                    this.qrCode = null;
                    this.notifyStatusChange('connected');
                    console.log('WhatsApp connected successfully!');
                }
            });

            this.socket.ev.on('messages.upsert', async (m) => {
                const messages = m.messages;
                for (const msg of messages) {
                    if (msg.key.fromMe) continue;
                    
                    const messageData = this.parseMessage(msg);
                    if (messageData) {
                        this.messageHandlers.forEach(handler => {
                            try {
                                handler(messageData);
                            } catch (err) {
                                console.error('Message handler error:', err);
                            }
                        });
                    }
                }
            });

            this.socket.ev.on('messages.update', async (updates) => {
                console.log('=== messages.update event ===', JSON.stringify(updates, null, 2));
                for (const update of updates) {
                    console.log('Processing update:', update.key?.id, 'status:', update.update?.status);
                    if (update.update.status) {
                        const statusMap = {
                            2: 'sent',
                            3: 'delivered',
                            4: 'read',
                        };
                        const status = statusMap[update.update.status];
                        console.log('Mapped status:', status, 'for message:', update.key?.id);
                        if (status) {
                            this.notifyStatusChange('message_status', {
                                messageId: update.key.id,
                                status,
                                remoteJid: update.key.remoteJid,
                            });
                        }
                    }
                }
            });

            // Handle presence updates (online/offline/typing)
            this.socket.ev.on('presence.update', async (update) => {
                const { id, presences } = update;
                if (presences) {
                    for (const [jid, presence] of Object.entries(presences)) {
                        const phone = jid.replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '');
                        this.notifyStatusChange('presence', {
                            phone,
                            remoteJid: jid,
                            presence: presence.lastKnownPresence || 'unavailable',
                            lastSeen: presence.lastSeen,
                        });
                    }
                }
            });

        } catch (err) {
            console.error('Connection error:', err);
            this.isConnecting = false; // Reset connecting flag
            this.notifyStatusChange('error', { error: err.message });
            setTimeout(() => this.connect(), 10000);
        }
    }

    parseMessage(msg) {
        try {
            const remoteJid = msg.key.remoteJid;
            // Handle different WhatsApp ID formats:
            // - @s.whatsapp.net: regular users
            // - @g.us: groups
            // - @lid: linked devices / business accounts
            const phone = remoteJid
                .replace('@s.whatsapp.net', '')
                .replace('@g.us', '')
                .replace('@lid', '')
                .replace(/:.*$/, ''); // Remove any port/suffix like :30
            const isGroup = remoteJid.endsWith('@g.us');

            let content = '';
            let mediaType = null;
            let mediaUrl = null;

            if (msg.message?.conversation) {
                content = msg.message.conversation;
            } else if (msg.message?.extendedTextMessage?.text) {
                content = msg.message.extendedTextMessage.text;
            } else if (msg.message?.imageMessage) {
                content = msg.message.imageMessage.caption || '';
                mediaType = 'image';
            } else if (msg.message?.videoMessage) {
                content = msg.message.videoMessage.caption || '';
                mediaType = 'video';
            } else if (msg.message?.audioMessage) {
                mediaType = 'audio';
            } else if (msg.message?.documentMessage) {
                content = msg.message.documentMessage.fileName || '';
                mediaType = 'document';
            }

            return {
                id: msg.key.id,
                phone,
                remoteJid,
                isGroup,
                content,
                mediaType,
                mediaUrl,
                timestamp: msg.messageTimestamp,
                pushName: msg.pushName || phone,
            };
        } catch (err) {
            console.error('Parse message error:', err);
            return null;
        }
    }

    async sendMessage(phone, message, options = {}) {
        if (!this.isConnected || !this.socket) {
            return {
                success: false,
                phone,
                error: 'WhatsApp not connected',
            };
        }

        const formattedPhone = phone.replace(/[^0-9]/g, '');
        const jid = `${formattedPhone}@s.whatsapp.net`;

        try {
            // Check if number exists on WhatsApp with timeout
            const checkPromise = this.socket.onWhatsApp(jid);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Check timeout')), 10000)
            );
            
            const [exists] = await Promise.race([checkPromise, timeoutPromise]);
            if (!exists) {
                return {
                    success: false,
                    phone: formattedPhone,
                    error: `Phone number ${phone} is not on WhatsApp`,
                };
            }

            const sentMessage = await this.socket.sendMessage(jid, {
                text: message,
            });

            return {
                success: true,
                messageId: sentMessage.key.id,
                timestamp: Date.now(),
                phone: formattedPhone,
            };
        } catch (err) {
            console.error('Send message error:', err.message);
            return {
                success: false,
                phone: formattedPhone,
                error: err.message,
            };
        }
    }

    async sendBulkMessages(recipients, message, options = {}) {
        const { minDelay = 3000, maxDelay = 8000 } = options; // Reduced delays
        const results = [];

        for (let i = 0; i < recipients.length; i++) {
            const recipient = recipients[i];
            
            // Check connection before each message
            if (!this.isConnected || !this.socket) {
                results.push({
                    success: false,
                    phone: recipient.phone,
                    customerId: recipient.customerId,
                    error: 'WhatsApp disconnected',
                });
                continue;
            }
            
            const result = await this.sendMessage(recipient.phone, message);
            results.push({
                ...result,
                customerId: recipient.customerId,
            });
            
            console.log(`Message ${i + 1}/${recipients.length}: ${result.success ? 'Sent' : 'Failed'} to ${recipient.phone}`);

            // Only delay if there are more messages and previous was successful
            if (i < recipients.length - 1 && result.success) {
                const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
                console.log(`Waiting ${delay}ms before next message...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        return results;
    }

    getStatus() {
        return {
            connected: this.isConnected,
            state: this.connectionState,
            hasQr: !!this.qrCodeBase64,
        };
    }

    getQrCode() {
        return this.qrCodeBase64;
    }

    getRawQrCode() {
        return this.qrCode;
    }

    async subscribeToPresence(phone) {
        if (!this.isConnected || !this.socket) {
            return { success: false, error: 'WhatsApp not connected' };
        }
        
        const formattedPhone = phone.replace(/[^0-9]/g, '');
        const jid = `${formattedPhone}@s.whatsapp.net`;
        
        try {
            await this.socket.presenceSubscribe(jid);
            return { success: true, jid };
        } catch (err) {
            console.error('Presence subscribe error:', err);
            return { success: false, error: err.message };
        }
    }

    async disconnect() {
        if (this.socket) {
            this.socket.ev.removeAllListeners();
            this.socket.end();
            this.socket = null;
            this.isConnected = false;
            this.qrCode = null;
            this.qrCodeBase64 = null;
            this.notifyStatusChange('disconnected');
        }
    }

    async logout() {
        if (this.socket) {
            try {
                await this.socket.logout();
            } catch (err) {
                console.error('Logout error:', err);
            }
            this.socket = null;
            this.isConnected = false;
            this.qrCode = null;
            this.qrCodeBase64 = null;
            this.notifyStatusChange('logged_out');
        }
    }
}

const client = new BaileysClient();
export default client;
