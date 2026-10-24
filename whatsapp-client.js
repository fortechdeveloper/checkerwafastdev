const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

let client = null;
let isReady = false;
let qrCodeDataURL = null;

/**
 * Inisialisasi WhatsApp client dengan LocalAuth agar session tersimpan.
 * Session akan disimpan di folder ./sessions
 */
function initClient() {
    if (client) return client;

    client = new Client({
        authStrategy: new LocalAuth({ dataPath: './sessions' }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        }
    });

    client.on('qr', async (qr) => {
        console.log('[WA] QR Code diterima. Scan via WhatsApp > Linked Devices.');
        qrCodeDataURL = await qrcode.toDataURL(qr);
        isReady = false;
    });

    client.on('ready', () => {
        console.log('[WA] Client siap!');
        isReady = true;
        qrCodeDataURL = null;
    });

    client.on('authenticated', () => {
        console.log('[WA] Autentikasi berhasil.');
    });

    client.on('auth_failure', (msg) => {
        console.error('[WA] Autentikasi gagal:', msg);
        isReady = false;
    });

    client.on('disconnected', (reason) => {
        console.warn('[WA] Client terputus:', reason);
        isReady = false;
        // Coba inisialisasi ulang setelah 5 detik
        setTimeout(() => {
            client = null;
            initClient();
        }, 5000);
    });

    client.initialize();
    return client;
}

/**
 * Normalisasi nomor ke format <countrycode><msisdn> tanpa '+', spasi, atau tanda hubung.
 * Contoh: "+62 812-3456-7890" -> "6281234567890"
 */
function normalizeNumber(raw) {
    if (!raw) return null;
    let num = String(raw).trim().replace(/[\s\-().+]/g, '');
    // Jika diawali '0' (nomor lokal Indonesia), ganti dengan '62'
    if (num.startsWith('0')) {
        num = '62' + num.slice(1);
    }
    // Hanya angka yang diizinkan
    if (!/^\d{6,15}$/.test(num)) return null;
    return num;
}

/**
 * Cek apakah nomor terdaftar di WhatsApp.
 * @param {string} rawNumber - Nomor mentah dari input user.
 * @returns {Promise<{number: string, valid: boolean|null, error?: string}>}
 */
async function checkNumber(rawNumber) {
    if (!isReady || !client) {
        return { number: rawNumber, valid: null, error: 'WhatsApp client belum siap. Scan QR terlebih dahulu.' };
    }

    const normalized = normalizeNumber(rawNumber);
    if (!normalized) {
        return { number: rawNumber, valid: false, error: 'Format nomor tidak valid.' };
    }

    try {
        // whatsapp-web.js: gunakan getNumberId() atau isRegisteredUser()
        // getNumberId() mengembalikan ID jika nomor terdaftar, null jika tidak.
        const numberId = await client.getNumberId(normalized);
        if (numberId) {
            return { number: normalized, valid: true };
        } else {
            return { number: normalized, valid: false };
        }
    } catch (err) {
        console.error(`[WA] Error cek ${normalized}:`, err.message);
        return { number: normalized, valid: null, error: err.message };
    }
}

/**
 * Cek massal dengan delay acak untuk menghindari rate limit / ban.
 * @param {string[]} numbers - Array nomor mentah.
 * @param {function} onProgress - Callback (index, total, result).
 * @param {number} minDelay - Delay minimum (ms).
 * @param {number} maxDelay - Delay maksimum (ms).
 */
async function checkBulk(numbers, onProgress, minDelay = 3000, maxDelay = 8000) {
    const results = [];
    for (let i = 0; i < numbers.length; i++) {
        const result = await checkNumber(numbers[i]);
        results.push(result);
        if (onProgress) onProgress(i + 1, numbers.length, result);

        // Delay acak antar pengecekan (kecuali nomor terakhir)
        if (i < numbers.length - 1) {
            const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return results;
}

function getQRCode() {
    return qrCodeDataURL;
}

function getStatus() {
    return { ready: isReady, hasQR: !!qrCodeDataURL };
}

module.exports = {
    initClient,
    checkNumber,
    checkBulk,
    normalizeNumber,
    getQRCode,
    getStatus
};