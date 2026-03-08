/**
 * Gemini API 連携モジュール
 * 画像からの成績データ抽出をGemini Vision APIで実行
 */
import { DEFAULT_API_KEY, GEMINI_MODEL, GEMINI_ENDPOINT } from './constants.js';

const MAX_RETRIES = 3;

/**
 * APIキーを取得（localStorageから、なければデフォルト）
 */
export function getApiKey() {
    return localStorage.getItem('gemini_api_key') || DEFAULT_API_KEY;
}

/**
 * APIキーを保存
 */
export function setApiKey(key) {
    localStorage.setItem('gemini_api_key', key);
}

/**
 * 選択中のモデルを取得
 */
export function getSelectedModel() {
    return localStorage.getItem('gemini_model') || GEMINI_MODEL;
}

/**
 * モデルを保存
 */
export function setSelectedModel(model) {
    localStorage.setItem('gemini_model', model);
}

/**
 * 画像ファイルをBase64エンコード
 * @param {File} file
 * @returns {Promise<{base64: string, mimeType: string}>}
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve({ base64, mimeType: file.type });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * 指定秒数待機
 */
function sleep(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * Gemini APIに画像を送信してデータを抽出
 * @param {File} imageFile - 成績表画像ファイル
 * @param {function} onLog - ステータスログ用コールバック
 * @returns {Promise<Object>} 抽出されたデータ
 */
export async function extractDataFromImage(imageFile, onLog = () => { }) {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('APIキーが設定されていません');
    }

    const model = getSelectedModel();
    onLog(`画像をエンコード中... (モデル: ${model})`);
    const { base64, mimeType } = await fileToBase64(imageFile);

    const prompt = `あなたはプロ野球データの抽出スペシャリストです。
この成績表の画像を解析し、以下の情報をJSON形式で返してください。

【手順】
1. 表のヘッダー（列名）を読み取り、打者か投手かを判別してください。
   - 打者の判定基準：ヘッダーに「AB」「HR」「AVG」などが含まれる場合
   - 投手の判定基準：ヘッダーに「IP」「ERA」「SV」などが含まれる場合

2. 画像内に国名や国旗、チーム名が記載されていれば、それも読み取ってください。

3. すべての選手のデータを行ごとに抽出してください。

4. 各選手の英語名を日本語（カタカナ）に変換してください。
   - 選手名が英語表記の場合、発音に基づいてカタカナに変換してください
   - 日本人選手の場合は漢字表記も併記してください（例: "大谷翔平"）
   - WBC等の国際大会に出場するプロ野球選手の一般的な日本語表記を使ってください
   - 名前の後ろにポジション略称（C, P, 1B, SS, DH等）が付いている場合は、ポジションを除いた名前部分のみを変換対象としてください

【出力フォーマット】
必ず以下のJSON形式で出力してください。JSON以外のテキストは一切含めないでください。

打者の場合:
{
  "type": "batter",
  "country": "国名（画像から判別できた場合）",
  "headers": ["列ヘッダー1", "列ヘッダー2", ...],
  "players": [
    {
      "PLAYER": "画像の原文そのまま",
      "PLAYER_KANA": "カタカナまたは漢字での日本語表記",
      "G": 数値,
      "AB": 数値,
      "H": 数値,
      "HR": 数値,
      "RBI": 数値,
      "SB": 数値,
      "CS": 数値,
      "AVG": 数値(小数)
    }
  ]
}

投手の場合:
{
  "type": "pitcher",
  "country": "国名（画像から判別できた場合）",
  "headers": ["列ヘッダー1", "列ヘッダー2", ...],
  "players": [
    {
      "PLAYER": "画像の原文そのまま",
      "PLAYER_KANA": "カタカナまたは漢字での日本語表記",
      "G": 数値,
      "W": 数値,
      "L": 数値,
      "SV": 数値,
      "IP": 数値(小数),
      "SO": 数値,
      "ERA": 数値(小数),
      "ER": 数値
    }
  ]
}

重要：
- 数値は文字列ではなく数値型で返してください（打率や防御率は小数）
- PLAYERには画像に表示されている原文をそのまま入れてください
- PLAYER_KANAには必ずカタカナまたは漢字で日本語表記を入れてください（照合に使用します）
- 画像に表示されているデータ列で、上記のフォーマットに該当しないものは無視してOKです
- 画像にある全選手のデータを漏れなく抽出してください
- 回答はJSON部分のみ返してください（説明文不要）`;

    const url = `${GEMINI_ENDPOINT}/${model}:generateContent?key=${apiKey}`;

    const requestBody = {
        contents: [{
            parts: [
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: base64
                    }
                },
                {
                    text: prompt
                }
            ]
        }],
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192
        }
    };

    // リトライロジック
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        onLog(`Gemini APIにリクエスト送信中... (試行 ${attempt}/${MAX_RETRIES})`);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (response.status === 429) {
                // レート制限エラー → リトライ待機時間を取得
                const errorData = await response.json();
                const retryInfo = errorData.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
                let waitSeconds = 60; // デフォルト60秒
                if (retryInfo?.retryDelay) {
                    const match = retryInfo.retryDelay.match(/(\d+)/);
                    if (match) waitSeconds = parseInt(match[1]) + 5; // 余裕を持たせる
                }

                if (attempt < MAX_RETRIES) {
                    onLog(`⏳ レート制限に達しました。${waitSeconds}秒後にリトライします... (${attempt}/${MAX_RETRIES})`);
                    // カウントダウン表示
                    for (let s = waitSeconds; s > 0; s--) {
                        onLog(`⏳ リトライまで残り ${s}秒...`);
                        await sleep(1);
                    }
                    continue;
                } else {
                    throw new Error(
                        `APIレート制限超過（${MAX_RETRIES}回リトライ済み）。\n` +
                        `対処法:\n` +
                        `1. 数分待ってから再試行してください\n` +
                        `2. サイドバーでモデルを変更してみてください（例: Gemini 1.5 Flash）\n` +
                        `3. APIの有料プランへのアップグレードをご検討ください`
                    );
                }
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Gemini API Error (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            onLog('APIレスポンス受信、データ解析中...');

            // レスポンスからテキストを抽出
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) {
                throw new Error('APIからの応答にテキストが含まれていません');
            }

            // JSONを抽出（コードブロックで囲まれている場合も対応）
            let jsonStr = text;
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1].trim();
            } else {
                // 先頭・末尾の余計なテキストを除去
                const startIdx = text.indexOf('{');
                const endIdx = text.lastIndexOf('}');
                if (startIdx !== -1 && endIdx !== -1) {
                    jsonStr = text.substring(startIdx, endIdx + 1);
                }
            }

            try {
                const result = JSON.parse(jsonStr);
                onLog(`データ抽出完了: ${result.type === 'batter' ? '打者' : '投手'} ${result.players?.length || 0}名`);
                return result;
            } catch (e) {
                throw new Error('APIレスポンスのJSON解析に失敗: ' + e.message + '\n受信テキスト: ' + text.substring(0, 500));
            }

        } catch (error) {
            lastError = error;
            // 429以外のエラーはリトライしない
            if (!error.message?.includes('レート制限')) {
                throw error;
            }
        }
    }

    throw lastError;
}
