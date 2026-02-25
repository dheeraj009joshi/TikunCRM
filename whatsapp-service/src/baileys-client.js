import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    downloadMediaMessage,
    getContentType,
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
        this.isConnecting = false;
        this.phoneNumber = null;
        this.messageStore = new Map();
        this.lidToPhoneMap = new Map();
        this.lidMappingPath = path.join(__dirname, '..', 'auth', 'lid-mapping.json');
        
        if (!fs.existsSync(this.authPath)) {
            fs.mkdirSync(this.authPath, { recursive: true });
        }
        
        if (fs.existsSync(this.lidMappingPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.lidMappingPath, 'utf-8'));
                this.lidToPhoneMap = new Map(Object.entries(data));
                console.log('Loaded LID mappings:', this.lidToPhoneMap.size);
            } catch (e) {
                console.log('Could not read LID mapping file:', e.message);
            }
        }
    }
    
    saveLidMapping() {
        try {
            const data = Object.fromEntries(this.lidToPhoneMap);
            fs.writeFileSync(this.lidMappingPath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('Could not save LID mapping:', e.message);
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
        if (this.isConnecting) {
            console.log('Connection already in progress, skipping...');
            return;
        }
        
        this.isConnecting = true;
        
        try {
            if (this.socket) {
                console.log('Closing existing socket...');
                this.socket.ev.removeAllListeners();
                this.socket.end();
                this.socket = null;
            }
            
            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
            const { version } = await fetchLatestBaileysVersion();

            console.log('Creating Baileys socket with version:', version);

            this.socket = makeWASocket({
                version,
                auth: state,
                logger,
                printQRInTerminal: false,
                browser: ['LeedsCRM', 'Chrome', '120.0.0'],
                syncFullHistory: false,
                markOnlineOnConnect: true,
                generateHighQualityLinkPreview: false,
                getMessage: async (key) => {
                    const msg = this.messageStore.get(key.id);
                    return msg?.message || undefined;
                },
            });

            this.socket.ev.on('creds.update', saveCreds);

            this.socket.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    this.qrCode = qr;
                    this.isConnected = false;
                    try {
                        const qrBase64 = await QRCode.toDataURL(qr, {
                            width: 300,
                            margin: 2,
                        });
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
                    this.isConnecting = false;
                    this.qrCode = null;
                    this.phoneNumber = null;
                    const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;

                    if (reason === DisconnectReason.loggedOut) {
                        console.log('Logged out, clearing auth...');
                        this.notifyStatusChange('logged_out');
                        fs.rmSync(this.authPath, { recursive: true, force: true });
                        fs.mkdirSync(this.authPath, { recursive: true });
                        setTimeout(() => this.connect(), 5000);
                    } else if (reason === DisconnectReason.connectionClosed || 
                               reason === DisconnectReason.connectionLost ||
                               reason === DisconnectReason.connectionReplaced) {
                        console.log('Connection lost, reconnecting in 5s...');
                        this.notifyStatusChange('reconnecting');
                        setTimeout(() => this.connect(), 5000);
                    } else if (reason === DisconnectReason.restartRequired) {
                        console.log('Restart required, reconnecting...');
                        this.notifyStatusChange('reconnecting');
                        setTimeout(() => this.connect(), 3000);
                    } else if (reason === DisconnectReason.timedOut) {
                        console.log('Connection timed out, reconnecting...');
                        this.notifyStatusChange('reconnecting');
                        setTimeout(() => this.connect(), 5000);
                    } else {
                        console.log('Disconnected, reason:', reason);
                        this.notifyStatusChange('disconnected', { reason });
                        if (reason !== 401 && reason !== 403) {
                            setTimeout(() => this.connect(), 10000);
                        }
                    }
                }

                if (connection === 'open') {
                    this.isConnected = true;
                    this.isConnecting = false;
                    this.qrCode = null;
                    this.qrCodeBase64 = null;
                    await this.fetchPhoneNumber();
                    this.notifyStatusChange('connected', { phoneNumber: this.phoneNumber });
                    console.log('WhatsApp connected successfully! Phone:', this.phoneNumber);
                }
            });

            this.socket.ev.on('messages.upsert', async (m) => {
                const messages = m.messages;
                for (const msg of messages) {
                    this.messageStore.set(msg.key.id, msg);
                    
                    console.log('Raw message structure:', JSON.stringify({
                        key: msg.key,
                        pushName: msg.pushName,
                        participant: msg.key.participant,
                        verifiedBizName: msg.verifiedBizName,
                        messageContextInfo: msg.message?.extendedTextMessage?.contextInfo,
                    }, null, 2));
                    
                    if (msg.key.fromMe) continue;
                    
                    const messageData = await this.parseMessage(msg);
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
                for (const update of updates) {
                    if (update.update.status) {
                        const statusMap = {
                            2: 'sent',
                            3: 'delivered',
                            4: 'read',
                        };
                        const status = statusMap[update.update.status];
                        if (status) {
                            const remoteJid = update.key.remoteJid;
                            let phone = null;
                            if (remoteJid) {
                                const isLid = remoteJid.endsWith('@lid');
                                phone = remoteJid
                                    .replace('@s.whatsapp.net', '')
                                    .replace('@c.us', '')
                                    .replace('@lid', '')
                                    .replace(/:.*$/, '')
                                    .replace(/\D/g, '');
                                
                                if (isLid) {
                                    const cachedPhone = this.lidToPhoneMap.get(phone);
                                    if (cachedPhone) {
                                        phone = cachedPhone;
                                    }
                                }
                            }
                            
                            this.notifyStatusChange('message_status', {
                                messageId: update.key.id,
                                status,
                                remoteJid,
                                phone,
                            });
                        }
                    }
                }
            });

            this.socket.ev.on('presence.update', async (update) => {
                const { id, presences } = update;
                if (presences) {
                    for (const [jid, presence] of Object.entries(presences)) {
                        const phone = jid
                            .replace('@s.whatsapp.net', '')
                            .replace('@lid', '')
                            .replace(/\D/g, '');
                        this.notifyStatusChange('presence', {
                            phone,
                            remoteJid: jid,
                            presence: presence.lastKnownPresence,
                            isOnline: presence.lastKnownPresence === 'available',
                        });
                    }
                }
            });

        } catch (err) {
            console.error('Connection error:', err);
            this.isConnecting = false;
            this.notifyStatusChange('error', { error: err.message });
            setTimeout(() => this.connect(), 10000);
        }
    }

    async fetchPhoneNumber() {
        if (!this.socket || !this.socket.user) return;
        try {
            const user = this.socket.user;
            this.phoneNumber = user.id?.split(':')[0] || user.id?.split('@')[0];
            console.log('Connected phone number:', this.phoneNumber);
        } catch (err) {
            console.error('Error fetching phone number:', err.message);
        }
    }

    async parseMessage(msg) {
        try {
            const remoteJid = msg.key.remoteJid;
            const isGroup = remoteJid.endsWith('@g.us');
            const isLid = remoteJid.endsWith('@lid');
            
            let phone = remoteJid
                .replace('@s.whatsapp.net', '')
                .replace('@g.us', '')
                .replace('@lid', '')
                .replace(/:.*$/, '');

            const lidId = phone;

            if (isLid) {
                if (msg.key.senderPn) {
                    phone = msg.key.senderPn.replace('@s.whatsapp.net', '').replace(/:.*$/, '');
                    this.lidToPhoneMap.set(lidId, phone);
                    this.saveLidMapping();
                    console.log(`Extracted phone from senderPn: ${phone} (LID: ${lidId})`);
                } else {
                    const cachedPhone = this.lidToPhoneMap.get(lidId);
                    if (cachedPhone) {
                        phone = cachedPhone;
                        console.log(`Resolved LID ${lidId} to cached phone: ${phone}`);
                    } else {
                        console.log(`LID ${lidId} has no senderPn and not in cache`);
                    }
                }
            }

            let content = '';
            let mediaType = null;
            let mediaUrl = null;

            const messageContent = msg.message;
            if (!messageContent) return null;

            const contentType = getContentType(messageContent);

            if (messageContent?.conversation) {
                content = messageContent.conversation;
            } else if (messageContent?.extendedTextMessage?.text) {
                content = messageContent.extendedTextMessage.text;
            } else if (messageContent?.imageMessage) {
                content = messageContent.imageMessage.caption || '';
                mediaType = 'image';
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {
                        logger,
                        reuploadRequest: this.socket?.updateMediaMessage,
                    });
                    const mimeType = messageContent.imageMessage.mimetype || 'image/jpeg';
                    mediaUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
                    console.log(`Downloaded image: ${buffer.length} bytes`);
                } catch (e) {
                    console.error('Failed to download image:', e.message);
                }
            } else if (messageContent?.videoMessage) {
                content = messageContent.videoMessage.caption || '';
                mediaType = 'video';
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {
                        logger,
                        reuploadRequest: this.socket?.updateMediaMessage,
                    });
                    const mimeType = messageContent.videoMessage.mimetype || 'video/mp4';
                    mediaUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
                    console.log(`Downloaded video: ${buffer.length} bytes`);
                } catch (e) {
                    console.error('Failed to download video:', e.message);
                }
            } else if (messageContent?.audioMessage) {
                mediaType = messageContent.audioMessage.ptt ? 'ptt' : 'audio';
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {
                        logger,
                        reuploadRequest: this.socket?.updateMediaMessage,
                    });
                    const mimeType = messageContent.audioMessage.mimetype || 'audio/ogg';
                    mediaUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
                    console.log(`Downloaded audio: ${buffer.length} bytes`);
                } catch (e) {
                    console.error('Failed to download audio:', e.message);
                }
            } else if (messageContent?.documentMessage) {
                content = messageContent.documentMessage.fileName || '';
                mediaType = 'document';
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {
                        logger,
                        reuploadRequest: this.socket?.updateMediaMessage,
                    });
                    const mimeType = messageContent.documentMessage.mimetype || 'application/octet-stream';
                    mediaUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
                    console.log(`Downloaded document: ${buffer.length} bytes`);
                } catch (e) {
                    console.error('Failed to download document:', e.message);
                }
            } else if (messageContent?.locationMessage) {
                const loc = messageContent.locationMessage;
                content = `Location: ${loc.degreesLatitude}, ${loc.degreesLongitude}`;
                mediaType = 'location';
            } else if (messageContent?.stickerMessage) {
                mediaType = 'sticker';
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {
                        logger,
                        reuploadRequest: this.socket?.updateMediaMessage,
                    });
                    mediaUrl = `data:image/webp;base64,${buffer.toString('base64')}`;
                    console.log(`Downloaded sticker: ${buffer.length} bytes`);
                } catch (e) {
                    console.error('Failed to download sticker:', e.message);
                }
            } else if (messageContent?.contactMessage || messageContent?.contactsArrayMessage) {
                content = messageContent.contactMessage?.displayName || '';
                mediaType = 'contact';
            } else if (messageContent?.reactionMessage) {
                const reaction = messageContent.reactionMessage;
                content = reaction.text || '';
                mediaType = 'reaction';
                return {
                    id: msg.key.id,
                    phone,
                    remoteJid,
                    isGroup,
                    isLid,
                    content,
                    mediaType,
                    mediaUrl: null,
                    timestamp: msg.messageTimestamp,
                    pushName: msg.pushName || phone,
                    quotedMsgId: reaction.key?.id || null,
                    isReaction: true,
                    reactionEmoji: reaction.text,
                    reactionToMsgId: reaction.key?.id,
                };
            }

            const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage;
            const quotedMsgId = messageContent?.extendedTextMessage?.contextInfo?.stanzaId;

            return {
                id: msg.key.id,
                phone,
                remoteJid,
                isGroup,
                isLid,
                content,
                mediaType,
                mediaUrl,
                timestamp: msg.messageTimestamp,
                pushName: msg.pushName || phone,
                quotedMsgId: quotedMsgId || null,
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
            const checkPromise = this.socket.onWhatsApp(jid);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Check timeout')), 10000)
            );
            
            const [exists] = await Promise.race([checkPromise, timeoutPromise]);
            if (!exists || !exists.exists) {
                return {
                    success: false,
                    phone: formattedPhone,
                    error: `Phone number ${phone} is not on WhatsApp`,
                };
            }

            const msgOptions = { text: message };
            
            if (options.quotedMsgId) {
                const quotedMsg = this.messageStore.get(options.quotedMsgId);
                if (quotedMsg) {
                    msgOptions.quoted = quotedMsg;
                }
            }

            const sentMessage = await this.socket.sendMessage(jid, msgOptions);

            if (sentMessage.key.remoteJid?.endsWith('@lid')) {
                const lidId = sentMessage.key.remoteJid.replace('@lid', '').replace(/:.*$/, '');
                this.lidToPhoneMap.set(lidId, formattedPhone);
                this.saveLidMapping();
                console.log(`Mapped LID ${lidId} to phone ${formattedPhone}`);
            }

            return {
                success: true,
                messageId: sentMessage.key.id,
                timestamp: Date.now(),
                phone: formattedPhone,
                from: this.phoneNumber,
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

    async sendImage(phone, imageData, filename = 'image.jpg', caption = '') {
        if (!this.isConnected || !this.socket) {
            return { success: false, phone, error: 'WhatsApp not connected' };
        }

        const formattedPhone = phone.replace(/[^0-9]/g, '');
        const jid = `${formattedPhone}@s.whatsapp.net`;

        try {
            let mediaSource;
            if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
                mediaSource = { url: imageData };
            } else if (imageData.startsWith('data:')) {
                const base64Data = imageData.split(',')[1];
                mediaSource = Buffer.from(base64Data, 'base64');
            } else {
                mediaSource = Buffer.from(imageData, 'base64');
            }

            const sentMessage = await this.socket.sendMessage(jid, {
                image: mediaSource,
                caption: caption || undefined,
            });

            return {
                success: true,
                messageId: sentMessage.key.id,
                timestamp: Date.now(),
                phone: formattedPhone,
                from: this.phoneNumber,
            };
        } catch (err) {
            console.error('Send image error:', err.message);
            return { success: false, phone: formattedPhone, error: err.message };
        }
    }

    async sendFile(phone, fileData, filename, caption = '') {
        if (!this.isConnected || !this.socket) {
            return { success: false, phone, error: 'WhatsApp not connected' };
        }

        const formattedPhone = phone.replace(/[^0-9]/g, '');
        const jid = `${formattedPhone}@s.whatsapp.net`;

        try {
            let mediaSource;
            if (fileData.startsWith('http://') || fileData.startsWith('https://')) {
                mediaSource = { url: fileData };
            } else if (fileData.startsWith('data:')) {
                const base64Data = fileData.split(',')[1];
                mediaSource = Buffer.from(base64Data, 'base64');
            } else {
                mediaSource = Buffer.from(fileData, 'base64');
            }

            const sentMessage = await this.socket.sendMessage(jid, {
                document: mediaSource,
                fileName: filename,
                caption: caption || undefined,
            });

            return {
                success: true,
                messageId: sentMessage.key.id,
                timestamp: Date.now(),
                phone: formattedPhone,
                from: this.phoneNumber,
            };
        } catch (err) {
            console.error('Send file error:', err.message);
            return { success: false, phone: formattedPhone, error: err.message };
        }
    }

    async sendAudio(phone, audioData, isPtt = true) {
        if (!this.isConnected || !this.socket) {
            return { success: false, phone, error: 'WhatsApp not connected' };
        }

        const formattedPhone = phone.replace(/[^0-9]/g, '');
        const jid = `${formattedPhone}@s.whatsapp.net`;

        try {
            let mediaSource;
            if (audioData.startsWith('http://') || audioData.startsWith('https://')) {
                mediaSource = { url: audioData };
            } else if (audioData.startsWith('data:')) {
                const base64Data = audioData.split(',')[1];
                mediaSource = Buffer.from(base64Data, 'base64');
            } else {
                mediaSource = Buffer.from(audioData, 'base64');
            }

            const sentMessage = await this.socket.sendMessage(jid, {
                audio: mediaSource,
                ptt: isPtt,
            });

            return {
                success: true,
                messageId: sentMessage.key.id,
                timestamp: Date.now(),
                phone: formattedPhone,
                from: this.phoneNumber,
            };
        } catch (err) {
            console.error('Send audio error:', err.message);
            return { success: false, phone: formattedPhone, error: err.message };
        }
    }

    async sendVideo(phone, videoData, filename = 'video.mp4', caption = '') {
        if (!this.isConnected || !this.socket) {
            return { success: false, phone, error: 'WhatsApp not connected' };
        }

        const formattedPhone = phone.replace(/[^0-9]/g, '');
        const jid = `${formattedPhone}@s.whatsapp.net`;

        try {
            let mediaSource;
            if (videoData.startsWith('http://') || videoData.startsWith('https://')) {
                mediaSource = { url: videoData };
            } else if (videoData.startsWith('data:')) {
                const base64Data = videoData.split(',')[1];
                mediaSource = Buffer.from(base64Data, 'base64');
            } else {
                mediaSource = Buffer.from(videoData, 'base64');
            }

            const sentMessage = await this.socket.sendMessage(jid, {
                video: mediaSource,
                caption: caption || undefined,
            });

            return {
                success: true,
                messageId: sentMessage.key.id,
                timestamp: Date.now(),
                phone: formattedPhone,
                from: this.phoneNumber,
            };
        } catch (err) {
            console.error('Send video error:', err.message);
            return { success: false, phone: formattedPhone, error: err.message };
        }
    }

    async sendLocation(phone, latitude, longitude, title = '', address = '') {
        if (!this.isConnected || !this.socket) {
            return { success: false, phone, error: 'WhatsApp not connected' };
        }

        const formattedPhone = phone.replace(/[^0-9]/g, '');
        const jid = `${formattedPhone}@s.whatsapp.net`;

        try {
            const sentMessage = await this.socket.sendMessage(jid, {
                location: {
                    degreesLatitude: latitude,
                    degreesLongitude: longitude,
                    name: title || undefined,
                    address: address || undefined,
                },
            });

            return {
                success: true,
                messageId: sentMessage.key.id,
                timestamp: Date.now(),
                phone: formattedPhone,
                from: this.phoneNumber,
            };
        } catch (err) {
            console.error('Send location error:', err.message);
            return { success: false, phone: formattedPhone, error: err.message };
        }
    }

    async sendReaction(messageId, emoji) {
        if (!this.isConnected || !this.socket) {
            return { success: false, error: 'WhatsApp not connected' };
        }

        try {
            const storedMsg = this.messageStore.get(messageId);
            if (!storedMsg) {
                return { success: false, error: 'Message not found in store' };
            }

            await this.socket.sendMessage(storedMsg.key.remoteJid, {
                react: {
                    text: emoji,
                    key: storedMsg.key,
                },
            });

            return { success: true, messageId, emoji };
        } catch (err) {
            console.error('Send reaction error:', err.message);
            return { success: false, error: err.message };
        }
    }

    async sendBulkMessages(recipients, message, options = {}) {
        const { minDelay = 3000, maxDelay = 8000, batchSize = 10, media, mediaType, mediaFilename } = options;
        const results = [];

        const normalizedRecipients = recipients.map(r => 
            typeof r === 'string' ? { phone: r } : r
        );

        const batches = [];
        for (let i = 0; i < normalizedRecipients.length; i += batchSize) {
            batches.push(normalizedRecipients.slice(i, i + batchSize));
        }

        const hasMedia = !!media;
        const contentType = hasMedia ? `${mediaType}${message ? ' + text' : ''}` : 'text';
        console.log(`Sending ${normalizedRecipients.length} ${contentType} messages in ${batches.length} batches of up to ${batchSize}`);

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            const batchStartIndex = batchIndex * batchSize;

            if (!this.isConnected || !this.socket) {
                batch.forEach((recipient, i) => {
                    results.push({
                        success: false,
                        phone: recipient.phone,
                        customerId: recipient.customerId,
                        error: 'WhatsApp disconnected',
                    });
                });
                continue;
            }

            console.log(`\n--- Batch ${batchIndex + 1}/${batches.length} (${batch.length} messages) ---`);

            const batchPromises = batch.map(async (recipient, indexInBatch) => {
                const globalIndex = batchStartIndex + indexInBatch + 1;
                try {
                    let result;
                    
                    if (hasMedia) {
                        // Send media with optional caption
                        if (mediaType === 'image') {
                            result = await this.sendImage(recipient.phone, media, mediaFilename || 'image.jpg', message || undefined);
                        } else if (mediaType === 'video') {
                            result = await this.sendVideo(recipient.phone, media, mediaFilename || 'video.mp4', message || undefined);
                        } else if (mediaType === 'file') {
                            result = await this.sendFile(recipient.phone, media, mediaFilename || 'document', message || undefined);
                        } else {
                            // Fallback: send as text if unknown media type
                            result = await this.sendMessage(recipient.phone, message || '[Media]');
                        }
                    } else {
                        // Text only
                        result = await this.sendMessage(recipient.phone, message);
                    }
                    
                    console.log(`Message ${globalIndex}/${normalizedRecipients.length}: ${result.success ? 'Sent' : 'Failed'} to ${recipient.phone}`);
                    return {
                        ...result,
                        customerId: recipient.customerId,
                    };
                } catch (err) {
                    console.log(`Message ${globalIndex}/${normalizedRecipients.length}: Failed to ${recipient.phone} - ${err.message}`);
                    return {
                        success: false,
                        phone: recipient.phone,
                        customerId: recipient.customerId,
                        error: err.message,
                    };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            const successCount = batchResults.filter(r => r.success).length;
            console.log(`Batch ${batchIndex + 1} complete: ${successCount}/${batch.length} successful`);

            if (batchIndex < batches.length - 1) {
                const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
                console.log(`Waiting ${delay}ms before next batch...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        const totalSuccess = results.filter(r => r.success).length;
        console.log(`\n=== Bulk send complete: ${totalSuccess}/${results.length} successful ===`);

        return results;
    }

    async checkNumber(phone) {
        if (!this.isConnected || !this.socket) {
            return { success: false, error: 'WhatsApp not connected' };
        }

        const formattedPhone = phone.replace(/[^0-9]/g, '');
        const jid = `${formattedPhone}@s.whatsapp.net`;

        try {
            const [result] = await this.socket.onWhatsApp(jid);
            return {
                success: true,
                phone: formattedPhone,
                exists: result?.exists || false,
                jid: result?.jid || jid,
            };
        } catch (err) {
            console.error('Check number error:', err.message);
            return { success: false, phone: formattedPhone, error: err.message };
        }
    }

    async downloadMedia(messageId) {
        if (!this.isConnected || !this.socket) {
            return { success: false, error: 'WhatsApp not connected' };
        }

        try {
            const storedMsg = this.messageStore.get(messageId);
            if (!storedMsg) {
                return { success: false, error: 'Message not found in store' };
            }

            const buffer = await downloadMediaMessage(storedMsg, 'buffer', {});
            const base64 = buffer.toString('base64');
            return { success: true, data: base64 };
        } catch (err) {
            console.error('Download media error:', err.message);
            return { success: false, error: err.message };
        }
    }

    async getMessageById(messageId) {
        if (!this.isConnected || !this.socket) {
            return null;
        }

        try {
            return this.messageStore.get(messageId) || null;
        } catch (err) {
            console.error('Get message error:', err.message);
            return null;
        }
    }

    async getStatus() {
        if (this.isConnected && !this.phoneNumber && this.socket) {
            await this.fetchPhoneNumber();
        }
        return {
            connected: this.isConnected,
            state: this.connectionState,
            hasQr: !!this.qrCodeBase64,
            phoneNumber: this.phoneNumber,
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

    async markAsRead(phone, messageIds = []) {
        if (!this.isConnected || !this.socket) {
            return { success: false, error: 'WhatsApp not connected' };
        }

        const formattedPhone = phone.replace(/[^0-9]/g, '');
        let jid = `${formattedPhone}@s.whatsapp.net`;
        
        const lidEntry = [...this.lidToPhoneMap.entries()].find(([, p]) => p === formattedPhone);
        if (lidEntry) {
            jid = `${lidEntry[0]}@lid`;
        }

        try {
            const keys = messageIds.map(id => ({
                remoteJid: jid,
                id: id,
                fromMe: false,
            }));
            
            if (keys.length > 0) {
                await this.socket.readMessages(keys);
                console.log(`Marked ${keys.length} messages as read for ${phone}`);
            }
            
            return { success: true, phone, count: keys.length };
        } catch (err) {
            console.error('Mark as read error:', err.message);
            return { success: false, error: err.message };
        }
    }

    async disconnect() {
        if (this.socket) {
            this.socket.ev.removeAllListeners();
            this.socket.end();
            this.socket = null;
            this.isConnected = false;
            this.isConnecting = false;
            this.qrCode = null;
            this.qrCodeBase64 = null;
            this.phoneNumber = null;
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
            this.isConnecting = false;
            this.qrCode = null;
            this.qrCodeBase64 = null;
            this.phoneNumber = null;
            fs.rmSync(this.authPath, { recursive: true, force: true });
            fs.mkdirSync(this.authPath, { recursive: true });
            this.notifyStatusChange('logged_out');
        }
    }
}

const client = new BaileysClient();
export default client;
