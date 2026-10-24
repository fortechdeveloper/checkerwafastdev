const express = require('express');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const wa = require('./whatsapp-client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Inisialisasi WhatsApp client saat server start
wa.initClient();

/**
 * Endpoint status: apakah client siap, atau perlu scan QR.
 */
app.get('/api/status', (req, res) => {
    res.json(wa.getStatus());
});

/**
 * Endpoint QR: mengembalikan data URL QR code (jika belum login).
 */
app.get('/api/qr', (req, res) => {
    const qr = wa.getQRCode();
    if (!qr) {
        return res.status(404).json({ error: 'QR tidak tersedia. Mungkin sudah login atau belum diinisialisasi.' });
    }
    res.json({ qr });
});

/**
 * Endpoint utama: cek massal.
 * Body: { numbers: string[] }  atau  { csv: string }
 * Response: streaming SSE dengan progress per nomor.
 */
app.post('/api/check-bulk', async (req, res) => {
    let numbers = [];

    // Prioritas: array numbers
    if (Array.isArray(req.body.numbers)) {
        numbers = req.body.numbers;
    } else if (typeof req.body.csv === 'string') {
        // Parse CSV (satu kolom, satu nomor per baris)
        try {
            const records = parse(req.body.csv, { columns: false, skip_empty_lines: true, trim: true });
            numbers = records.map(row => row[0]).filter(Boolean);
        } catch (err) {
            return res.status(400).json({ error: 'CSV tidak valid: ' + err.message });
        }
    } else if (typeof req.body.text === 'string') {
        // Parse textarea (satu nomor per baris)
        numbers = req.body.text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }

    if (numbers.length === 0) {
        return res.status(400).json({ error: 'Tidak ada nomor yang diberikan.' });
    }

    if (numbers.length > 1000) {
        return res.status(400).json({ error: 'Maksimal 1000 nomor per batch. Silakan bagi menjadi beberapa batch.' });
    }

    // Set header untuk SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    // Kirim event awal
    res.write(`event: start\ndata: ${JSON.stringify({ total: numbers.length })}\n\n`);

    const results = [];
    try {
        await wa.checkBulk(
            numbers,
            (index, total, result) => {
                results.push(result);
                res.write(`event: progress\ndata: ${JSON.stringify({ index, total, result })}\n\n`);
            },
            3000,   // min delay 3 detik
            8000    // max delay 8 detik
        );
        res.write(`event: done\ndata: ${JSON.stringify({ results })}\n\n`);
    } catch (err) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    } finally {
        res.end();
    }
});

/**
 * Endpoint export CSV dari hasil yang dikirim client.
 * Body: { results: [{ number, valid, error }] }
 */
app.post('/api/export-csv', (req, res) => {
    const results = req.body.results;
    if (!Array.isArray(results) || results.length === 0) {
        return res.status(400).json({ error: 'Tidak ada hasil untuk diexport.' });
    }

    const rows = results.map(r => ({
        number: r.number || '',
        status: r.valid === true ? 'AKTIF' : (r.valid === false ? 'TIDAK AKTIF' : 'ERROR'),
        keterangan: r.error || ''
    }));

    const csv = stringify(rows, { header: true });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="hasil_cek_whatsapp.csv"');
    res.send(csv);
});

// Fallback: kirim index.html untuk route yang tidak dikenal (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`[Server] Berjalan di http://localhost:${PORT}`);
});