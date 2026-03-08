/**
 * IndexedDB ラッパーモジュール
 * マスターデータ（プールCSV）とテンプレートCSVの永続保存・取得・削除を管理
 */

const DB_NAME = 'WBCDataExtractor';
const DB_VERSION = 1;

const STORES = {
    POOL: 'poolFiles',       // プールA〜D.csv
    TEMPLATE: 'templateFiles' // DataBatter000.csv, DataPitcher000.csv
};

let dbInstance = null;

/**
 * IndexedDBを初期化
 */
function openDB() {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORES.POOL)) {
                db.createObjectStore(STORES.POOL, { keyPath: 'name' });
            }
            if (!db.objectStoreNames.contains(STORES.TEMPLATE)) {
                db.createObjectStore(STORES.TEMPLATE, { keyPath: 'name' });
            }
        };
        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };
        request.onerror = (event) => {
            reject(new Error('IndexedDB open failed: ' + event.target.error));
        };
    });
}

/**
 * ファイルを保存
 * @param {string} storeName - ストア名
 * @param {string} name - ファイル名
 * @param {string} content - ファイル内容（テキスト）
 */
async function saveFile(storeName, name, content) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put({ name, content, uploadedAt: new Date().toISOString() });
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => reject(new Error('Save failed: ' + event.target.error));
    });
}

/**
 * ファイルを取得
 * @param {string} storeName - ストア名
 * @param {string} name - ファイル名
 * @returns {Promise<{name: string, content: string, uploadedAt: string}|null>}
 */
async function getFile(storeName, name) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.get(name);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = (event) => reject(new Error('Get failed: ' + event.target.error));
    });
}

/**
 * 全ファイルを取得
 * @param {string} storeName - ストア名
 * @returns {Promise<Array<{name: string, content: string, uploadedAt: string}>>}
 */
async function getAllFiles(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (event) => reject(new Error('GetAll failed: ' + event.target.error));
    });
}

/**
 * ファイルを削除
 * @param {string} storeName - ストア名
 * @param {string} name - ファイル名
 */
async function deleteFile(storeName, name) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.delete(name);
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => reject(new Error('Delete failed: ' + event.target.error));
    });
}

// 公開 API
export const poolDB = {
    save: (name, content) => saveFile(STORES.POOL, name, content),
    get: (name) => getFile(STORES.POOL, name),
    getAll: () => getAllFiles(STORES.POOL),
    delete: (name) => deleteFile(STORES.POOL, name)
};

export const templateDB = {
    save: (name, content) => saveFile(STORES.TEMPLATE, name, content),
    get: (name) => getFile(STORES.TEMPLATE, name),
    getAll: () => getAllFiles(STORES.TEMPLATE),
    delete: (name) => deleteFile(STORES.TEMPLATE, name)
};
