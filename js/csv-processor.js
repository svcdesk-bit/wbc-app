/**
 * CSV データ処理モジュール
 * マスターデータ照合、データ変換、テンプレートCSVへの流し込み
 */
import { COUNTRY_CODES, BATTER_COLUMN_MAP, PITCHER_COLUMN_MAP } from './constants.js';
import { poolDB, templateDB } from './db.js';

/**
 * ファイルのバイナリデータからテキストをデコード（UTF-8/Shift-JIS自動判別）
 * @param {ArrayBuffer|Uint8Array} buffer 
 * @returns {string} デコードされたテキスト
 */
export function decodeFileContents(buffer) {
    const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

    // 1. UTF-8 BOM チェック
    if (uint8[0] === 0xEF && uint8[1] === 0xBB && uint8[2] === 0xBF) {
        return new TextDecoder('utf-8').decode(uint8);
    }

    // 2. UTF-8 として正当かどうかチェック
    // fatal: true にすると不正なシーケンスで例外を投げる
    try {
        const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
        return utf8Decoder.decode(uint8);
    } catch (e) {
        // UTF-8 で失敗した場合は Shift-JIS を試す
        try {
            const sjisDecoder = new TextDecoder('shift-jis');
            return sjisDecoder.decode(uint8);
        } catch (e2) {
            // 最悪のフォールバック
            return new TextDecoder('utf-8').decode(uint8);
        }
    }
}

/**
 * CSVテキストをパースして配列に変換
 * @param {string} csvText
 * @returns {{ headers: string[], rows: string[][] }}
 */
export function parseCSV(csvText) {
    if (typeof csvText !== 'string') {
        throw new Error('parseCSV expects a string. Use decodeFileContents first.');
    }
    // BOM除去
    const text = csvText.replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return { headers: [], rows: [] };

    const headers = parseCSVLine(lines[0]);
    const rows = lines.slice(1).map(line => parseCSVLine(line));
    return { headers, rows };
}

/**
 * CSV行をパース（ダブルクオート対応）
 */
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
    }
    result.push(current);
    return result;
}

/**
 * 配列をCSVテキストに変換（BOM付きUTF-8）
 */
export function toCSVText(headers, rows) {
    const escapeField = (field) => {
        const str = String(field ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    };
    const lines = [headers.map(escapeField).join(',')];
    for (const row of rows) {
        lines.push(row.map(escapeField).join(','));
    }
    return lines.join('\r\n');
}

/**
 * ヘッダー名を正規化する（揺れを吸収）
 */
function normalizeHeaderName(header) {
    if (!header) return '';
    const h = header.trim().toLowerCase();
    // 柔軟なマッチング
    if (/英語選手名|english.*name|player.*name.*en|英語.*名/.test(h)) return '英語選手名';
    if (/选手名|選手名|名前|氏名|name|player|選手.*名/.test(h)) return '選手名';
    if (/选手id|選手id|id|player.*id/.test(h)) return '選手ID';
    if (/国名|国籍|チーム|国|country|team/.test(h)) return '国名';
    return header.trim();
}

/**
 * Googleスプレッドシートからマスターデータを取得
 */
export async function fetchMasterDataFromSheet(input) {
    if (!input) throw new Error('スプレッドシートIDまたはURLが設定されていません');

    // URLからIDを抽出
    let sheetId = input.trim();
    const urlMatch = sheetId.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (urlMatch) {
        sheetId = urlMatch[1];
    }

    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('シートの取得に失敗しました。スプレッドシート右上の青い「共有」ボタンを押し、[一般的なアクセス] を [リンクを知っている全員] に変更しているか確認してください。');
        }
        const buffer = await response.arrayBuffer();
        const csvText = decodeFileContents(buffer);
        const { headers, rows } = parseCSV(csvText);

        if (!headers || headers.length === 0) {
            throw new Error('シートが空か、正しく読み込めませんでした。');
        }

        const normalizedHeaders = headers.map(normalizeHeaderName);
        const idIdx = normalizedHeaders.indexOf('選手ID');
        const engIdx = normalizedHeaders.indexOf('英語選手名');
        const nameIdx = normalizedHeaders.indexOf('選手名');
        const countryIdx = normalizedHeaders.indexOf('国名');

        if (idIdx === -1 || (engIdx === -1 && nameIdx === -1)) {
            const foundHeaders = headers.join(', ');
            throw new Error(`必要なカラム「選手ID」「英語選手名」が見つかりません。見出しを確認してください。\n(見つかったカラム: ${foundHeaders})`);
        }

        return rows.map(row => ({
            選手ID: (row[idIdx] || '').trim(),
            英語選手名: (engIdx !== -1 ? row[engIdx] : '').trim(),
            選手名: (nameIdx !== -1 ? row[nameIdx] : '').trim(),
            国名: (countryIdx !== -1 ? row[countryIdx] : '').trim()
        })).filter(p => p.選手ID && (p.英語選手名 || p.選手名));
    } catch (err) {
        console.error('Fetch error:', err);
        throw new Error(`Google Sheets連携エラー: ${err.message}`);
    }
}

/**
 * 選手情報のマスターデータを構築
 * @param {Array} sheetData Google Sheetsから取得済みのデータ (オプション)
 * @returns {Promise<Array>}
 */
export async function buildMasterData(sheetData = null) {
    // スプレッドシートデータがある場合はそれを最優先
    if (sheetData && Array.isArray(sheetData) && sheetData.length > 0) {
        return sheetData;
    }

    // バックアップとしてIndexedDBからも読み込む(互換性維持)
    const files = await poolDB.getAll();
    const masterData = [];
    for (const file of files) {
        const { headers, rows } = parseCSV(file.content);
        const normalizedHeaders = headers.map(normalizeHeaderName);

        for (const row of rows) {
            const entry = {};
            normalizedHeaders.forEach((h, i) => {
                entry[h] = (row[i] || '').trim();
            });
            // 元のヘッダー名でもアクセスできるように保持
            headers.forEach((h, i) => {
                if (!entry[h]) entry[h] = (row[i] || '').trim();
            });
            masterData.push(entry);
        }
    }
    return masterData;
}

/**
 * 野球のポジション略称（名前末尾に付与されるもの）
 */
const POSITION_ABBRS = [
    'RHP', 'LHP', 'DH', 'PH', 'PR', 'SP', 'RP', 'CP',
    '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF',
    'C', 'P', 'IF', 'OF', 'UT',
];

/**
 * 選手名の末尾からポジション略称を除去
 * 例: "John Smith C" → "John Smith"
 */
function stripPosition(name) {
    if (!name) return '';
    let trimmed = name.trim();

    // 末尾のポジションを繰り返し除去（例: "Name LF RF" に対応）
    let changed = true;
    while (changed) {
        changed = false;
        for (const pos of POSITION_ABBRS) {
            const regex = new RegExp(`\\s+${pos}$`, 'i');
            if (regex.test(trimmed)) {
                trimmed = trimmed.replace(regex, '').trim();
                changed = true;
                break;
            }
        }
    }
    return trimmed;
}

/**
 * 英語名の正規化
 * - Unicode NFKD正規化でアクセント記号を分離し除去
 * - 小文字化、余分な空白除去
 */
function normalizeEnglishName(name) {
    if (!name) return '';
    return name
        .normalize('NFKD')                   // アクセント記号を分離
        .replace(/[\u0300-\u036f]/g, '')    // 分離したアクセント記号を削除 (combining diacritical marks)
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * カタカナ名・マスター名の正規化
 * - 比較の邪魔になる記号（・、スペース、ハイフン等）をすべて除去
 */
function normalizeSymbolicName(name) {
    if (!name) return '';
    return name
        .toLowerCase()
        .replace(/[\s・\-\－\─\―\/\\]/g, '') // 空白、中点、各種ハイフン、スラッシュを除去
        .trim();
}

/**
 * レーベンシュタイン距離（編集距離）の計算
 */
function getLevenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // 置換
                    Math.min(
                        matrix[i][j - 1] + 1, // 挿入
                        matrix[i - 1][j] + 1  // 削除
                    )
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

/**
 * あいまい一致判定（文字数の30%以内の差異、かつ最大2文字）
 */
function isFuzzyMatch(s1, s2) {
    if (!s1 || !s2) return false;
    const dist = getLevenshteinDistance(s1, s2);
    // 短い名前（2-3文字）なら1文字、長い名前なら2文字まで許容
    const maxAllowed = Math.min(2, Math.floor(Math.max(s1.length, s2.length) * 0.35));
    return dist <= maxAllowed;
}

/**
 * 選手名でマスターデータを照合
 */
export function matchPlayers(extractedPlayers, masterData) {
    const matched = [];
    const unmatched = [];

    console.group('--- Player Matching (English Preference) ---');
    console.log(`Master Data Records: ${masterData.length}`);

    // マスターデータの各種正規化名を事前計算
    const masterEntries = masterData.map(m => {
        const eng = (m['英語選手名'] || '').trim();
        const jp = (m['選手名'] || '').trim();
        const country = (m['国名'] || '').trim();
        return {
            original: m,
            normEng: normalizeEnglishName(eng),
            engWords: normalizeEnglishName(eng).split(' ').filter(w => w.length > 2), // 分かち書き
            normJp: normalizeSymbolicName(jp),
            countryCode: resolveCountryCode(country, []) // 国名もコード化しておく
        };
    });

    for (const player of extractedPlayers) {
        const pRaw = player.PLAYER?.trim() || '';
        if (!pRaw) continue;

        const pStripped = stripPosition(pRaw);
        const pNorm = normalizeEnglishName(pStripped);
        const pWords = pNorm.split(' ').filter(w => w.length > 2);

        console.log(`Matching: "${pRaw}" -> Norm: "${pNorm}"`);

        let found = null;

        // 1. 英語名の正規化完全一致 (最優先)
        found = masterEntries.find(m => m.normEng === pNorm)?.original;
        if (found) console.log('  -> Match (Exact English)');

        // 2. 姓名順序逆転・分かち書きマッチング
        // 例: "Felipe Coragi" vs "Coragi Felipe" -> 両方の単語が含まれていれば一致
        if (!found && pWords.length >= 2) {
            found = masterEntries.find(m => {
                if (m.engWords.length < 2) return false;
                // 全ての抽出単語がマスター単語に含まれているか
                return pWords.every(pw => m.engWords.some(mw => mw === pw || mw.includes(pw) || pw.includes(mw)));
            })?.original;
            if (found) console.log('  -> Match (Word-based / Reversed name)');
        }

        // 3. 部分一致 (英語名)
        if (!found && pNorm.length > 4) {
            found = masterEntries.find(m =>
                m.normEng.length > 4 && (m.normEng.includes(pNorm) || pNorm.includes(m.normEng))
            )?.original;
            if (found) console.log('  -> Match (Partial English)');
        }

        // 4. 日本語名の一致 (フォールバック)
        if (!found) {
            const pSymNorm = normalizeSymbolicName(pRaw);
            found = masterEntries.find(m => m.normJp === pSymNorm)?.original;
            if (found) console.log('  -> Match (Japanese Fallback)');
        }

        if (found) {
            matched.push({
                ...player,
                選手ID: found['選手ID'] || '',
                国名: found['国名'] || '',
                マスター選手名: found['選手名'] || found['英語選手名'] || ''
            });
        } else {
            console.warn(`  !! No match for: ${pRaw}`);
            unmatched.push(pStripped);
            matched.push({ ...player, 選手ID: '', 国名: '', マスター選手名: '' });
        }
    }

    console.groupEnd();
    return { matched, unmatched };
}

/**
 * 国名からファイル番号を特定
 * @param {string} country - 国名
 * @param {Array} matchedPlayers - マッチ済の選手データ
 * @returns {string} 3桁番号（例: '012'）
 */
export function resolveCountryCode(country, matchedPlayers) {
    // 画像から取得した国名を優先
    if (country) {
        for (const [key, code] of Object.entries(COUNTRY_CODES)) {
            if (country.includes(key) || key.includes(country)) {
                return code;
            }
        }
    }

    // マッチした選手の国名から多数決
    const countryCounts = {};
    for (const p of matchedPlayers) {
        if (p.国名) {
            for (const [key, code] of Object.entries(COUNTRY_CODES)) {
                if (p.国名.includes(key) || key.includes(p.国名)) {
                    countryCounts[code] = (countryCounts[code] || 0) + 1;
                    break;
                }
            }
        }
    }
    const sorted = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) return sorted[0][0];

    return '000'; // 特定できない場合
}

/**
 * 投球回(IP)を分割
 * @param {number|string} ip - 投球回の値（例: 6.1）
 * @returns {{ innings: number, thirds: number }}
 */
export function splitIP(ip) {
    const val = parseFloat(ip) || 0;
    const innings = Math.floor(val);
    const decimal = Math.round((val - innings) * 10);
    return { innings, thirds: decimal };
}

/**
 * テンプレートCSVにデータを流し込む
 * @param {string} type - 'batter' | 'pitcher'
 * @param {Array} matchedPlayers - マッチ済選手データ
 * @returns {Promise<{ headers: string[], rows: string[][] }>}
 */
export async function populateTemplate(type, matchedPlayers) {
    const templateName = type === 'batter' ? 'DataBatter000.csv' : 'DataPitcher000.csv';
    const templateFile = await templateDB.get(templateName);
    if (!templateFile) {
        throw new Error(`テンプレート「${templateName}」が登録されていません。サイドバーからアップロードしてください。`);
    }

    const { headers: rawHeaders, rows } = parseCSV(templateFile.content);
    // ヘッダーを正規化（空白除去や表記ゆれ吸収）
    const headers = rawHeaders.map(normalizeHeaderName);

    const columnMap = type === 'batter' ? BATTER_COLUMN_MAP : PITCHER_COLUMN_MAP;
    const idColIndex = headers.findIndex(h => h === '選手ID');

    if (idColIndex === -1) {
        throw new Error('テンプレートCSVに「選手ID」カラムが見つかりません（ヘッダーを確認してください）');
    }

    // 選手IDでインデックスを構築
    const playerById = {};
    for (const player of matchedPlayers) {
        if (player.選手ID) {
            playerById[player.選手ID] = player;
        }
    }

    // 更新済み選手IDを追跡（41行目以降の重複スキップ用）
    const updatedIds = new Set();

    // 各行を更新
    for (let i = 0; i < rows.length; i++) {
        const rowId = (rows[i][idColIndex] || '').trim();
        if (!rowId || !playerById[rowId]) continue;

        // 【追加ルール】41行目以降（i >= 40）で、既に一度更新されたIDならスキップ
        if (i >= 40 && updatedIds.has(rowId)) {
            console.log(`Skipping duplicate ID at row ${i + 2}: ${rowId}`);
            continue;
        }

        const player = playerById[rowId];

        // マッピングに基づいてカラムを更新
        for (const [engKey, jpKey] of Object.entries(columnMap)) {
            const colIdx = headers.findIndex(h => h === jpKey);
            if (colIdx !== -1 && player[engKey] !== undefined) {
                rows[i][colIdx] = String(player[engKey]);
            }
        }

        // 投手の場合、IPの特殊処理
        if (type === 'pitcher' && player.IP !== undefined) {
            const { innings, thirds } = splitIP(player.IP);
            const ipCol = headers.findIndex(h => h === '投球回');
            const ip13Col = headers.findIndex(h => h === '投球回13');
            if (ipCol !== -1) rows[i][ipCol] = String(innings);
            if (ip13Col !== -1) rows[i][ip13Col] = String(thirds);
        }

        // このIDを「更新済み」としてマーク
        updatedIds.add(rowId);
    }

    return { headers, rows };
}

/**
 * CSVをBOM付きUTF-8でダウンロード
 * @param {string} filename
 * @param {string[]} headers
 * @param {string[][]} rows
 */
export function downloadCSV(filename, headers, rows) {
    const csvText = toCSVText(headers, rows);
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
