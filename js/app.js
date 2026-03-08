/**
 * メインアプリケーションロジック
 * UI状態管理、イベント処理、ステップ間遷移
 */
import { poolDB, templateDB } from './db.js';
import { getApiKey, setApiKey, extractDataFromImage, getSelectedModel, setSelectedModel } from './gemini.js';
import { DEFAULT_SHEET_ID } from './constants.js';
import {
    buildMasterData, matchPlayers, resolveCountryCode,
    populateTemplate, downloadCSV
} from './csv-processor.js';

// ──── グローバルエラーハンドリング ────
window.onerror = function (message, source, lineno, colno, error) {
    const errorMsg = `システムエラー: ${message} (${lineno}行目)`;
    console.error(errorMsg, error);
    // DOMが読み込まれていればログに出力
    const logContainer = document.getElementById('log-container');
    if (logContainer) {
        const entry = document.createElement('div');
        entry.className = 'log-entry log-error';
        entry.innerHTML = `<span class="log-time">[${new Date().toLocaleTimeString()}]</span> <span class="log-msg">${errorMsg}</span>`;
        logContainer.appendChild(entry);
    }
    return false;
};

// ──── 状態管理 ────
let extractedData = null;
let matchedResult = null;
let currentImageFile = null;
let cachedMasterData = null; // Google Sheets から取得したデータをキャッシュ

// ──── 初期化 ────
document.addEventListener('DOMContentLoaded', async () => {
    try {
        initAdminPanel();
        await loadMasterData(); // 起動時にマスターを読み込む
        await refreshTemplateList();
        initImageUpload();
        initProcessButton();
        initDownloadButton();
        addLog('アプリを起動しました。', 'info');
    } catch (err) {
        addLog(`初期化エラー: ${err.message}`, 'error');
    }
});

// ──── 管理者パネル・設定 ────
function initAdminPanel() {
    const modal = document.getElementById('admin-modal');
    const openBtn = document.getElementById('admin-toggle-btn');
    const closeBtn = document.getElementById('admin-close-btn');
    const saveBtn = document.getElementById('save-settings-btn') || document.getElementById('api-key-save'); // 互換性

    if (openBtn) openBtn.onclick = () => modal.classList.add('active');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('active');

    // 保存済み設定の反映
    const apiKeyInput = document.getElementById('api-key-input');
    const sheetIdInput = document.getElementById('sheet-id-input');
    if (apiKeyInput) apiKeyInput.value = getApiKey() || '';
    if (sheetIdInput) {
        const savedId = localStorage.getItem('google_sheet_id');
        sheetIdInput.value = savedId || DEFAULT_SHEET_ID || '';
    }

    // スプレッドシートID保存
    document.getElementById('sheet-id-save')?.addEventListener('click', async () => {
        const id = sheetIdInput?.value.trim() || '';
        localStorage.setItem('google_sheet_id', id);
        addLog('スプレッドシートIDを更新しました。', 'info');
        await loadMasterData();
        showToast('マスター設定を更新しました');
    });

    // APIキー保存
    document.getElementById('api-key-save')?.addEventListener('click', () => {
        const key = apiKeyInput?.value.trim();
        if (key) {
            setApiKey(key);
            addLog('APIキーを更新しました。', 'success');
            showToast('APIキーを保存しました');
        }
    });
}

// ──── マスターデータの読込 (Shared) ────
async function loadMasterData() {
    const indicator = document.getElementById('master-status-indicator');
    const dot = indicator?.querySelector('.status-dot');
    const text = indicator?.querySelector('.status-text');
    let sheetId = localStorage.getItem('google_sheet_id')?.trim();

    // LocalStorageになければデフォルト値を使用
    if (!sheetId) {
        sheetId = DEFAULT_SHEET_ID;
    }

    if (dot) dot.className = 'status-dot dot-loading';
    if (text) text.textContent = '読込中...';

    try {
        const { fetchMasterDataFromSheet, buildMasterData } = await import('./csv-processor.js');

        if (sheetId) {
            addLog(`Google Sheets (ID: ${sheetId.substring(0, 8)}...) から取得中...`, 'info');
            cachedMasterData = await fetchMasterDataFromSheet(sheetId);
        } else {
            addLog('共有マスター(Google Sheets)未設定。ローカルデータを読み込みます。', 'warning');
            cachedMasterData = await buildMasterData();
        }

        if (dot) dot.className = 'status-dot dot-on';
        if (text) text.textContent = (cachedMasterData && cachedMasterData.length > 0) ? '有効' : 'データ空';

        if (cachedMasterData && cachedMasterData.length > 0) {
            addLog(`マスターデータ読み込み完了: ${cachedMasterData.length} 名`, 'success');
        }
    } catch (err) {
        console.error('Master data load fail:', err);
        addLog(`マスター読込エラー: ${err.message}`, 'error');
        if (dot) dot.className = 'status-dot dot-off';
        if (text) text.textContent = 'エラー';
        cachedMasterData = [];
    }
}

// ──── テンプレート一覧のみ更新 ────
async function refreshTemplateList() {
    const templateList = document.getElementById('template-file-list');
    if (templateList) {
        const files = await templateDB.getAll();
        templateList.innerHTML = files.length === 0
            ? '<div class="file-empty">登録なし</div>'
            : '';
        files.forEach(f => templateList.appendChild(createFileItem(f.name, f.uploadedAt, 'template')));
    }
}

function createFileItem(name, uploadedAt, type) {
    const item = document.createElement('div');
    item.className = 'file-item';
    const date = uploadedAt ? new Date(uploadedAt).toLocaleDateString('ja-JP') : '';
    item.innerHTML = `
    <div class="file-info">
      <span class="file-name" title="${name}">📄 ${name}</span>
      <span class="file-date">${date}</span>
    </div>
    <button type="button" class="btn-icon btn-delete" title="削除" data-name="${name}" data-type="${type}">✕</button>
  `;
    return item;
}

// ──── イベント集中管理 ────
document.addEventListener('click', async (e) => {
    const target = e.target;
    try {
        // サイドバー開閉
        if (target.closest('#sidebar-toggle')) {
            document.getElementById('sidebar')?.classList.toggle('sidebar-collapsed');
            document.getElementById('main-content')?.classList.toggle('main-expanded');
            return;
        }

        // テンプレート追加
        if (target.closest('#template-upload-btn')) {
            document.getElementById('template-upload-input')?.click();
            return;
        }

        // 削除
        const deleteBtn = target.closest('.btn-delete');
        if (deleteBtn) {
            const { name, type } = deleteBtn.dataset;
            if (confirm(`「${name}」を削除しますか？`)) {
                await templateDB.delete(name);
                addLog(`テンプレート「${name}」を削除しました`, 'warning');
                await refreshTemplateList();
            }
            return;
        }

        // リセット
        if (target.closest('#hard-reset-btn')) {
            if (confirm('すべての登録データを消去（初期化）しますか？')) {
                localStorage.clear();
                const tFiles = await templateDB.getAll();
                for (const f of tFiles) await templateDB.delete(f.name);
                location.reload();
            }
            return;
        }
    } catch (err) {
        addLog(`操作エラー: ${err.message}`, 'error');
    }
}, true);

// ファイル選択時の処理
document.addEventListener('change', async (e) => {
    const input = e.target;
    if (input.id === 'template-upload-input') {
        const { decodeFileContents } = await import('./csv-processor.js');

        for (const file of input.files) {
            const buffer = await file.arrayBuffer();
            const text = decodeFileContents(buffer);

            await templateDB.save(file.name, text);
            addLog(`テンプレート「${file.name}」を登録しました`, 'success');
        }
        input.value = '';
        await refreshTemplateList();
    }
});

// ──── 画像アップロード機能 ────
function initImageUpload() {
    const dropZone = document.getElementById('image-drop-zone');
    const fileInput = document.getElementById('image-upload-input');
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) handleImageFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleImageFile(e.target.files[0]);
    });
}

function handleImageFile(file) {
    if (!file.type.startsWith('image/')) {
        addLog('画像ファイルを選択してください', 'error');
        return;
    }
    currentImageFile = file;
    const preview = document.getElementById('image-preview');
    if (preview) {
        const url = URL.createObjectURL(file);
        preview.innerHTML = `<img src="${url}" class="preview-img"><div class="preview-filename">${file.name}</div>`;
        preview.style.display = 'block';
    }
    document.getElementById('image-drop-zone')?.classList.add('has-file');
    document.getElementById('process-btn')?.removeAttribute('disabled');
    addLog(`画像「${file.name}」をセットしました`, 'info');
}

// ──── データ処理実行 ────
function initProcessButton() {
    const btn = document.getElementById('process-btn');
    btn?.addEventListener('click', async () => {
        if (!currentImageFile) return;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 処理中...';
        try {
            const { buildMasterData, matchPlayers, resolveCountryCode } = await import('./csv-processor.js');

            addLog('🔍 画像解析中...', 'info');
            extractedData = await extractDataFromImage(currentImageFile, msg => addLog(msg, 'info'));

            addLog('📋 マスター照合中...', 'info');
            // キャッシュされたマスターデータを使用（なければその場で構築）
            const masterData = await buildMasterData(cachedMasterData);
            matchedResult = matchPlayers(extractedData.players, masterData);

            if (matchedResult.unmatched.length) {
                addLog(`⚠️ 未照合：${matchedResult.unmatched.join(', ')}`, 'warning');
            }

            const countryCode = resolveCountryCode(extractedData.country, matchedResult.matched);
            displayResults(extractedData.type, matchedResult.matched, countryCode);
            addLog('✅ 処理完了', 'success');
        } catch (err) {
            addLog(`❌ エラー: ${err.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '⚡ データ処理実行';
        }
    });
}

// ──── 結果表示 ────
function displayResults(type, players, countryCode) {
    const table = document.getElementById('result-table');
    const typeLabel = document.getElementById('result-type');
    const countryLabel = document.getElementById('result-country');
    if (!table) return;

    if (typeLabel) typeLabel.textContent = type === 'batter' ? '打者' : '投手';
    if (countryLabel) countryLabel.textContent = `国番号: ${countryCode}`;

    const keys = type === 'batter'
        ? ['選手ID', 'PLAYER', 'PLAYER_KANA', 'マスター選手名', 'G', 'AB', 'H', 'HR', 'RBI', 'SB', 'CS', 'AVG']
        : ['選手ID', 'PLAYER', 'PLAYER_KANA', 'マスター選手名', 'G', 'W', 'L', 'SV', 'IP', 'SO', 'ERA', 'ER'];

    const thead = `<tr>${keys.map(k => `<th>${k === 'PLAYER_KANA' ? '抽出カナ' : k}</th>`).join('')}</tr>`;
    const tbody = players.map(p => {
        const rowId = (p['選手ID'] || p['ID'] || '').toString();
        const rowClass = rowId ? '' : ' class="row-unmatched"';
        return `<tr${rowClass}>${keys.map(k => {
            const val = p[k] ?? '';
            return `<td>${(k === '選手ID' && !rowId) ? '❌未照合' : val}</td>`;
        }).join('')}</tr>`;
    }).join('');

    table.innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
    document.getElementById('result-section').style.display = 'block';

    const dlBtn = document.getElementById('download-btn');
    if (dlBtn) {
        dlBtn.dataset.type = type;
        dlBtn.dataset.countryCode = countryCode;
        dlBtn.disabled = false;
    }
}

// ──── ダウンロード機能 ────
function initDownloadButton() {
    const btn = document.getElementById('download-btn');
    btn?.addEventListener('click', async () => {
        if (!matchedResult) return;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 生成中...';
        try {
            const { populateTemplate, downloadCSV } = await import('./csv-processor.js');
            const { type, countryCode } = btn.dataset;
            const { headers, rows } = await populateTemplate(type, matchedResult.matched);
            const filename = `${type === 'batter' ? 'DataBatter' : 'DataPitcher'}${countryCode}.csv`;
            downloadCSV(filename, headers, rows);
            addLog(`📥 「${filename}」をダウンロードしました`, 'success');
        } catch (err) {
            addLog(`❌ ダウンロード失敗: ${err.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '📥 CSVダウンロード';
        }
    });
}

function addLog(message, type = 'info') {
    const logContainer = document.getElementById('log-container');
    if (!logContainer) return;
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    const time = new Date().toLocaleTimeString('ja-JP');
    entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-msg">${message}</span>`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('toast-show'), 10);
    setTimeout(() => { toast.classList.remove('toast-show'); setTimeout(() => toast.remove(), 300); }, 2500);
}
