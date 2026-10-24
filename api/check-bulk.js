/**
 * Endpoint utama: validasi nomor massal via Apify.
 *
 * Alur:
 *   1. Terima array nomor (maks 100 per request — biar tidak kena timeout Vercel).
 *   2. Normalisasi format (Indo + internasional).
 *   3. Kirim ke Apify actor untuk divalidasi (dengan retry).
 *   4. Parse hasil dan kembalikan JSON.
 *
 * Frontend otomatis chunk batch > 100 nomor jadi beberapa request.
 */

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR = process.env.APIFY_ACTOR || 'devscrapper~whatsapp-number-validator';
const APIFY_BASE = 'https://api.apify.com/v2';
const MAX_PER_REQUEST = 100;
const APIFY_TIMEOUT_MS = 50000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 1500;

/**
 * Normalisasi nomor ke format <countrycode><msisdn> tanpa simbol.
 * - Handle nomor lokal Indo (0xxx → 62xxx)
 * - Handle prefix '+' dan separator '-', ' ', '(', ')', '.'
 * - Handle input yang cuma 8xxx (asumsi Indo)
 */
function normalizeNumber(raw) {
    if (raw === null || raw === undefined) return null;
    let s = String(raw).trim();
    if (!s) return null;

    // Buang semua karakter non-digit dan '+'
    s = s.replace(/[^\d+]/g, '');

    // Strip leading '+'
    if (s.startsWith('+')) s = s.slice(1);

    // Kalau diawali '0' (nomor lokal Indonesia), jadi '62...'
    if (s.startsWith('0')) {
        s = '62' + s.slice(1);
    }
    // Kalau diawali '8' (user ketik tanpa 0/62), asumsikan Indonesia
    else if (s.startsWith('8') && s.length >= 9 && s.length <= 12) {
        s = '62' + s;
    }

    // Validasi: harus 6–15 digit
    if (!/^\d{6,15}$/.test(s)) return null;

    return s;
}

/**
 * Sleep helper untuk retry backoff.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Satu percobaan panggilan ke Apify actor.
 * Return array of items (raw) — atau throw error.
 */
async function callApifyOnce(numbers) {
    const url = `${APIFY_BASE}/acts/${encodeURIComponent(APIFY_ACTOR)}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), APIFY_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phoneNumbers: numbers,
                numbers: numbers
            }),
            signal: controller.signal
        });
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('Apify timeout (>50s). Coba kurangi nomor per batch.');
        }
        throw new Error('Gagal menghubungi Apify: ' + err.message);
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        const retryable = response.status >= 500 && response.status < 600;
        const err = new Error(`Apify HTTP ${response.status}: ${errText.slice(0, 200)}`);
        err.retryable = retryable;
        throw err;
    }

    return response.json().catch(() => []);
}

/**
 * Panggil Apify dengan retry exponential backoff.
 */
async function callApifyWithRetry(numbers) {
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await callApifyOnce(numbers);
        } catch (err) {
            lastErr = err;
            if (attempt < MAX_RETRIES && err.retryable) {
                await sleep(RETRY_BACKOFF_MS * Math.pow(2, attempt));
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}

/**
 * Normalisasi hasil dari berbagai skema actor Apify.
 * Return map: { [normalizedNumber]: boolean | null }
 */
function parseApifyResults(items) {
    const resultMap = {};
    if (!Array.isArray(items)) return resultMap;

    for (const item of items) {
        if (!item || typeof item !== 'object') continue;

        const phone =
            item.phone ||
            item.number ||
            item.phoneNumber ||
            item.input ||
            item.nomor ||
            (item.query && item.query.phoneNumber);
        if (!phone) continue;

        const key = normalizeNumber(phone);
        if (!key) continue;

        let isValid = null;
        const flagKeys = [
            'exists', 'isValid', 'isRegistered', 'registered', 'valid',
            'isWhatsApp', 'isWhatsAppRegistered', 'hasWhatsApp'
        ];
        for (const k of flagKeys) {
            if (typeof item[k] === 'boolean') {
                isValid = item[k];
                break;
            }
        }

        if (isValid === null && typeof item.status === 'string') {
            const s = item.status.toLowerCase();
            if (s.includes('valid') || s.includes('exist') || s.includes('registered')) isValid = true;
            else if (s.includes('invalid') || s.includes('not') || s.includes('unregistered')) isValid = false;
        }

        resultMap[key] = isValid;
    }

    return resultMap;
}

/**
 * Handler Vercel.
 */
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Gunakan POST.' });
    }

    if (!APIFY_TOKEN) {
        return res.status(503).json({
            error: 'Server belum dikonfigurasi. Set APIFY_TOKEN di Vercel → Settings → Environment Variables.',
            hint: 'Daftar gratis di https://console.apify.com → Settings → Integrations → API Token.'
        });
    }

    const body = req.body || {};
    let rawNumbers = [];

    if (Array.isArray(body.numbers)) {
        rawNumbers = body.numbers;
    } else if (typeof body.text === 'string') {
        rawNumbers = body.text.split(/\r?\n/);
    } else if (typeof body.csv === 'string') {
        rawNumbers = body.csv.split(/\r?\n/).map(line => line.split(/[,;\t]/)[0]);
    }

    rawNumbers = rawNumbers.map(s => String(s).trim()).filter(Boolean);

    if (rawNumbers.length === 0) {
        return res.status(400).json({ error: 'Tidak ada nomor yang dikirim.' });
    }

    if (rawNumbers.length > MAX_PER_REQUEST) {
        return res.status(400).json({
            error: `Maksimal ${MAX_PER_REQUEST} nomor per request. Frontend otomatis membagi batch besar.`,
            received: rawNumbers.length
        });
    }

    const originalToNormalized = new Map();
    const normalizedNumbers = [];
    const seen = new Set();

    for (const raw of rawNumbers) {
        const norm = normalizeNumber(raw);
        originalToNormalized.set(raw, norm);
        if (norm && !seen.has(norm)) {
            seen.add(norm);
            normalizedNumbers.push(norm);
        }
    }

    if (normalizedNumbers.length === 0) {
        const results = rawNumbers.map(raw => ({
            original: raw,
            number: originalToNormalized.get(raw) || raw,
            valid: false,
            error: 'Format nomor tidak valid.'
        }));
        return res.status(200).json({ results, engine: 'local-validation', count: results.length });
    }

    let apifyMap = {};
    let apifyError = null;
    try {
        const items = await callApifyWithRetry(normalizedNumbers);
        apifyMap = parseApifyResults(items);
    } catch (err) {
        apifyError = err.message;
    }

    const results = rawNumbers.map(raw => {
        const norm = originalToNormalized.get(raw);
        if (!norm) {
            return {
                original: raw,
                number: raw,
                valid: false,
                error: 'Format nomor tidak valid.'
            };
        }

        if (apifyError) {
            return {
                original: raw,
                number: norm,
                valid: null,
                error: apifyError
            };
        }

        const valid = apifyMap[norm];
        if (typeof valid !== 'boolean') {
            return {
                original: raw,
                number: norm,
                valid: null,
                error: 'Tidak ada hasil dari engine validasi.'
            };
        }

        return {
            original: raw,
            number: norm,
            valid,
            error: null
        };
    });

    return res.status(200).json({
        results,
        engine: 'apify',
        actor: APIFY_ACTOR,
        count: results.length
    });
};