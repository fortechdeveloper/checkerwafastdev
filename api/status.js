/**
 * Endpoint status: cek apakah APIFY_TOKEN sudah dikonfigurasi.
 * Frontend memanggil ini saat load untuk memastikan backend siap.
 */

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const token = process.env.APIFY_TOKEN;
    const hasToken = Boolean(token && token.length > 10);
    const actor = process.env.APIFY_ACTOR || 'devscrapper~whatsapp-number-validator';

    return res.status(200).json({
        ready: hasToken,
        engine: 'apify',
        actor,
        message: hasToken
            ? 'Siap menerima pengecekan.'
            : 'APIFY_TOKEN belum diset. Buka Vercel → Settings → Environment Variables → tambah APIFY_TOKEN.'
    });
};