/* ============================================================
 * Frontend logic untuk WA Bulk Checker
 * ============================================================ */

const els = {
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    statusHint: document.getElementById('status-hint'),
    numbersInput: document.getElementById('numbers-input'),
    btnCheck: document.getElementById('btn-check'),
    btnClear: document.getElementById('btn-clear'),
    csvFile: document.getElementById('csv-file'),
    progressSection: document.getElementById('progress-section'),
    progressFill: document.getElementById('progress-fill'),
    progressText: document.getElementById('progress-text'),
    progressNote: document.getElementById('progress-note'),
    resultsSection: document.getElementById('results-section'),
    resultsBody: document.getElementById('results-body'),
    btnExport: document.getElementById('btn-export'),
    statsRow: document.getElementById('stats-row')
};

const CHUNK_SIZE = 100;
let currentResults = [];
let isChecking = false;

/* ============================================================
 * HELPERS
 * ============================================================ */

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* ============================================================
 * STATUS CHECK
 * ============================================================ */

async function checkStatus() {
    try {
        const res = await fetch('/api/status', { cache: 'no-store' });
        const data = await res.json();
        if (data.ready) {
            els.statusDot.className = 'dot online';
            els.statusText.textContent = `Engine siap (${data.engine})`;
            els.statusHint.classList.add('hidden');
            els.btnCheck.disabled = false;
        } else {
            els.statusDot.className = 'dot offline';
            els.statusText.textContent = 'Engine belum dikonfigurasi';
            els.statusHint.textContent = data.message;
            els.statusHint.classList.remove('hidden');
            els.btnCheck.disabled = true;
        }
    } catch (err) {
        els.statusDot.className = 'dot offline';
        els.statusText.textContent = 'Gagal menghubungi server.';
        els.statusHint.textContent = err.message;
        els.statusHint.classList.remove('hidden');
        els.btnCheck.disabled = true;
    }
}

checkStatus();

/* ============================================================
 * INPUT PARSING
 * ============================================================ */

function parseNumbersFromText(text) {
    return text
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
}

function parseNumbersFromCSV(csvText) {
    const lines = csvText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);
    if (lines.length === 0) return [];

    const startIdx = /[a-zA-Z]/.test(lines[0]) ? 1 : 0;

    return lines.slice(startIdx).map(line => {
        const first = line.split(/[,;\t]/)[0] || '';
        return first.replace(/["']/g, '').trim();
    }).filter(Boolean);
}

els.csvFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const nums = parseNumbersFromCSV(text);
    els.numbersInput.value = nums.join('\n');
});

els.btnClear.addEventListener('click', () => {
    if (isChecking) return;
    els.numbersInput.value = '';
    els.resultsBody.innerHTML = '';
    els.statsRow.innerHTML = '';
    els.resultsSection.classList.add('hidden');
    els.progressSection.classList.add('hidden');
    currentResults = [];
});

/* ============================================================
 * RENDERING
 * ============================================================ */

function renderResultRow(index, r) {
    const tr = document.createElement('tr');
    const statusClass = r.valid === true
        ? 'valid'
        : (r.valid === false ? 'invalid' : 'error');
    const statusLabel = r.valid === true
        ? 'AKTIF'
        : (r.valid === false ? 'TIDAK AKTIF' : 'ERROR');

    tr.innerHTML = `
        <td>${index}</td>
        <td><code>${escapeHtml(r.original || '')}</code></td>
        <td><code>${escapeHtml(r.number || '')}</code></td>
        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        <td>${escapeHtml(r.error || '-')}</td>
    `;
    els.resultsBody.appendChild(tr);
}

function renderStats() {
    const aktif = currentResults.filter(r => r.valid === true).length;
    const tidakAktif = currentResults.filter(r => r.valid === false).length;
    const error = currentResults.filter(r => r.valid === null).length;

    els.statsRow.innerHTML = `
        <span class="stat-pill">Total: <b>${currentResults.length}</b></span>
        <span class="stat-pill" style="color:var(--success)">Aktif: <b>${aktif}</b></span>
        <span class="stat-pill" style="color:var(--danger)">Tidak Aktif: <b>${tidakAktif}</b></span>
        <span class="stat-pill" style="color:var(--warning)">Error: <b>${error}</b></span>
    `;
}

/* ============================================================
 * CHECK PROCESSING
 * ============================================================ */

async function processChunk(chunk, chunkIndex, totalChunks, alreadyProcessed, totalNumbers) {
    const response = await fetch('/api/check-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numbers: chunk })
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const results = data.results || [];

    results.forEach((r, i) => {
        const globalIndex = alreadyProcessed + i + 1;
        renderResultRow(globalIndex, r);
        currentResults.push(r);
    });

    const done = alreadyProcessed + results.length;
    const pct = Math.round((done / totalNumbers) * 100);
    els.progressFill.style.width = `${pct}%`;
    els.progressText.textContent = `${done} / ${totalNumbers}`;
    els.progressNote.textContent = `Batch ${chunkIndex + 1} / ${totalChunks} selesai.`;

    return results.length;
}

els.btnCheck.addEventListener('click', async () => {
    if (isChecking) return;

    const numbers = parseNumbersFromText(els.numbersInput.value);
    if (numbers.length === 0) {
        alert('Masukkan minimal satu nomor.');
        return;
    }

    isChecking = true;
    els.btnCheck.disabled = true;
    els.btnCheck.textContent = 'Sedang Mengerjakan...';
    els.progressSection.classList.remove('hidden');
    els.resultsSection.classList.remove('hidden');
    els.resultsBody.innerHTML = '';
    els.statsRow.innerHTML = '';
    currentResults = [];

    const chunks = chunkArray(numbers, CHUNK_SIZE);
    const totalNumbers = numbers.length;

    els.progressFill.style.width = '0%';
    els.progressText.textContent = `0 / ${totalNumbers}`;
    els.progressNote.textContent = `Memproses ${chunks.length} batch...`;

    let processed = 0;

    try {
        for (let i = 0; i < chunks.length; i++) {
            try {
                processed += await processChunk(
                    chunks[i], i, chunks.length, processed, totalNumbers
                );
                if (i < chunks.length - 1) await sleep(500);
            } catch (err) {
                if (i === 0) throw err;

                for (const raw of chunks[i]) {
                    const fake = {
                        original: raw,
                        number: raw,
                        valid: null,
                        error: 'Batch gagal: ' + err.message
                    };
                    renderResultRow(processed + 1, fake);
                    currentResults.push(fake);
                    processed++;
                }
                const pct = Math.round((processed / totalNumbers) * 100);
                els.progressFill.style.width = `${pct}%`;
                els.progressText.textContent = `${processed} / ${totalNumbers}`;
            }
        }

        els.progressFill.style.width = '100%';
        els.progressNote.textContent = `Selesai. ${processed} nomor diproses.`;
        renderStats();
    } catch (err) {
        console.error(err);
        alert('Gagal memproses: ' + err.message);
        els.progressNote.textContent = 'Terhenti karena error.';
    } finally {
        isChecking = false;
        els.btnCheck.disabled = false;
        els.btnCheck.textContent = 'Mulai Cek';
    }
});

/* ============================================================
 * EXPORT CSV
 * ============================================================ */

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
        a.download = `hasil_cek_whatsapp_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Gagal export CSV: ' + err.message);
    }
});