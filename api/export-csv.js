/**
 * Endpoint export CSV dari hasil yang sudah ada di frontend.
 * Body: { results: [{ original, number, valid, error }] }
 */

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Gunakan POST.' });
    }

    const results = (req.body && req.body.results) || [];
    if (!Array.isArray(results) || results.length === 0) {
        return res.status(400).json({ error: 'Tidak ada hasil untuk diexport.' });
    }

    const header = ['No', 'Nomor Input', 'Nomor Ternormalisasi', 'Status', 'Keterangan'];
    const lines = [header.map(csvEscape).join(',')];

    results.forEach((r, i) => {
        const status = r.valid === true ? 'AKTIF' : (r.valid === false ? 'TIDAK AKTIF' : 'ERROR');
        const row = [
            i + 1,
            r.original || '',
            r.number || '',
            status,
            r.error || ''
        ];
        lines.push(row.map(csvEscape).join(','));
    });

    const csv = '\uFEFF' + lines.join('\r\n');
    const filename = `hasil_cek_whatsapp_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
};