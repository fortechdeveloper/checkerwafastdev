const els = {
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    qrContainer: document.getElementById('qr-container'),
    qrImage: document.getElementById('qr-image'),
    numbersInput: document.getElementById('numbers-input'),
    btnCheck: document.getElementById('btn-check'),
    btnClear: document.getElementById('btn-clear'),
    csvFile: document.getElementById('csv-file'),
    progressSection: document.getElementById('progress-section'),
    progressFill: document.getElementById('progress-fill'),
    progressText: document.getElementById('progress-text'),
    resultsSection: document.getElementById('results-section'),
    resultsBody: document.getElementById('results-body'),
    btnExport: document.getElementById('btn-export')
};

let currentResults = [];
let isChecking = false;

// ===================== STATUS & QR =====================
async function pollStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        if (data.ready) {
            els.statusDot.className = 'dot online';
            els.statusText.textContent = 'Terhubung ke WhatsApp';
            els.qrContainer.classList.add('hidden');
            els.btnCheck.disabled = false;
        } else if (data.hasQR) {
            els.statusDot.className = 'dot pending';
            els.statusText.textContent = 'Menunggu scan QR...';
            els.btnCheck.disabled = true;
            await showQR();
        } else {
            els.statusDot.className = 'dot offline';
            els.statusText.textContent = 'Tidak terhubung. Inisialisasi...';
            els.btnCheck.disabled = true;
        }
    } catch (err) {
        els.statusDot.className = 'dot offline';
        els.statusText.textContent = 'Gagal menghubungi server.';
        els.btnCheck.disabled = true;
    }
}

async function showQR() {
    try {
        const res = await fetch('/api/qr');
        if (!res.ok) return;
        const data = await res.json();
        els.qrImage.src = data.qr;
        els.qrContainer.classList.remove('hidden');
    } catch {
        // abaikan
    }
}

// Poll status setiap 3 detik
setInterval(pollStatus, 3000);
pollStatus();

// ===================== INPUT =====================
function parseNumbersFromText(text) {
    return text
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
}

function parseNumbersFromCSV(csvText) {
    // Sederhana: ambil kolom pertama, skip baris header jika ada
    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    // Deteksi header sederhana (jika baris pertama mengandung huruf)
    const startIdx = /[a-zA-Z]/.test(lines[0]) ? 1 : 0;
    return lines.slice(startIdx).map(line => line.split(/[,;\t]/)[0].replace(/["']/g, '').trim()).filter(Boolean);
}

els.csvFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const numbers = parseNumbersFromCSV(text);
    els.numbersInput.value = numbers.join('\n');
});

els.btnClear.addEventListener('click', () => {
    if (isChecking) return;
    els.numbersInput.value = '';
    els.resultsBody.innerHTML = '';
    els.resultsSection.classList.add('hidden');
    els.progressSection.classList.add('hidden');
    currentResults = [];
});

// ===================== CHECK BULK =====================
els.btnCheck.addEventListener('click', async () => {
    if (isChecking) return;

    const numbers = parseNumbersFromText(els.numbersInput.value);
    if (numbers.length === 0) {
        alert('Masukkan minimal satu nomor.');
        return;
    }
    if (numbers.length > 1000) {
        alert('Maksimal 1000 nomor per batch. Silakan bagi menjadi beberapa batch.');
        return;
    }

    isChecking = true;
    els.btnCheck.disabled = true;
    els.btnCheck.textContent = 'Sedang Mengerjakan...';
    els.progressSection.classList.remove('hidden');
    els.resultsSection.classList.remove('hidden');
    els.resultsBody.innerHTML = '';
    currentResults = [];

    els.progressFill.style.width = '0%';
    els.progressText.textContent = `0 / ${numbers.length}`;

    try {
        const response = await fetch('/api/check-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ numbers })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Terjadi kesalahan di server.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop(); // simpan sisa yang belum lengkap

            for (const part of parts) {
                if (!part.trim()) continue;
                const lines = part.split('\n');
                let eventType = 'message';
                let dataLine = '';
                for (const line of lines) {
                    if (line.startsWith('event: ')) eventType = line.slice(7).trim();
                    if (line.startsWith('data: ')) dataLine = line.slice(6);
                }
                if (!dataLine) continue;
                const payload = JSON.parse(dataLine);

                if (eventType === 'progress') {
                    const { index, total, result } = payload;
                    currentResults.push(result);
                    renderResultRow(index, result);
                    const pct = Math.round((index / total) * 100);
                    els.progressFill.style.width = `${pct}%`;
                    els.progressText.textContent = `${index} / ${total}`;
                } else if (eventType === 'done') {
                    els.progressFill.style.width = '100%';
                    els.progressText.textContent = `Selesai — ${payload.results.length} nomor dicek`;
                } else if (eventType === 'error') {
                    console.error('Server error:', payload.message);
                    alert('Terjadi kesalahan: ' + payload.message);
                }
            }
        }
    } catch (err) {
        console.error(err);
        alert('Gagal memproses: ' + err.message);
    } finally {
        isChecking = false;
        els.btnCheck.disabled = false;
        els.btnCheck.textContent = 'Mulai Cek';
    }
});

function renderResultRow(index, result) {
    const tr = document.createElement('tr');
    const statusClass = result.valid === true ? 'valid' : (result.valid === false ? 'invalid' : 'error');
    const statusLabel = result.valid === true ? 'AKTIF' : (result.valid === false ? 'TIDAK AKTIF' : 'ERROR');
    tr.innerHTML = `
        <td>${index}</td>
        <td><code>${result.number}</code></td>
        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        <td>${result.error || '-'}</td>
    `;
    els.resultsBody.appendChild(tr);
}

// ===================== EXPORT CSV =====================
els.btnExport.addEventListener('click', async () => {
    if (currentResults.length === 0) {
        alert('Belum ada hasil untuk diexport.');
        return;
    }
    try {
        const res = await fetch('/api/export-csv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ results: currentResults })
        });
        if (!res.ok) throw new Error('Gagal export');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'hasil_cek_whatsapp.csv';
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Gagal export CSV: ' + err.message);
    }
});