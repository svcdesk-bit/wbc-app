// 国名 → ファイル番号マッピング
export const COUNTRY_CODES = {
  'プエルトリコ': '001', 'Puerto Rico': '001', 'PUR': '001',
  'キューバ': '002', 'Cuba': '002', 'CUB': '002',
  'カナダ': '003', 'Canada': '003', 'CAN': '003',
  'パナマ': '004', 'Panama': '004', 'PAN': '004',
  'コロンビア': '005', 'Colombia': '005', 'COL': '005',
  'アメリカ': '006', 'United States': '006', 'USA': '006', 'US': '006',
  'メキシコ': '007', 'Mexico': '007', 'MEX': '007',
  'イタリア': '008', 'Italy': '008', 'ITA': '008',
  'イギリス': '009', 'Great Britain': '009', 'GBR': '009', 'United Kingdom': '009', 'UK': '009',
  'ブラジル': '010', 'Brazil': '010', 'BRA': '010',
  '日本': '011', 'Japan': '011', 'JPN': '011',
  'オーストラリア': '012', 'Australia': '012', 'AUS': '012',
  '韓国': '013', 'Korea': '013', 'KOR': '013', 'South Korea': '013',
  'チェコ': '014', 'Czech Republic': '014', 'CZE': '014', 'Czechia': '014',
  'チャイニーズ・タイペイ': '015', 'Chinese Taipei': '015', 'TPE': '015',
  'ベネズエラ': '016', 'Venezuela': '016', 'VEN': '016',
  'ドミニカ共和国': '017', 'Dominican Republic': '017', 'DOM': '017',
  'オランダ': '018', 'Netherlands': '018', 'NED': '018', 'Holland': '018',
  'イスラエル': '019', 'Israel': '019', 'ISR': '019',
  'ニカラグア': '020', 'Nicaragua': '020', 'NCA': '020', 'NIC': '020'
};

// 打者判定キーワード（ヘッダーに含まれていれば打者）
export const BATTER_KEYWORDS = ['AB', 'HR', 'AVG', 'RBI', 'H', 'SB', 'OBP', 'SLG', 'OPS', 'PA'];

// 投手判定キーワード（ヘッダーに含まれていれば投手）
export const PITCHER_KEYWORDS = ['IP', 'ERA', 'SV', 'SO', 'BB', 'WHIP', 'ER', 'W', 'L'];

// 打者のカラムマッピング（英語 → 日本語テンプレートカラム）
export const BATTER_COLUMN_MAP = {
  'G': '試合数',
  'AB': '打数',
  'H': '安打',
  'HR': '本塁打',
  'RBI': '打点',
  'SB': '盗塁',
  'CS': '盗塁死',
  'AVG': '打率'
};

// 投手のカラムマッピング（英語 → 日本語テンプレートカラム）
export const PITCHER_COLUMN_MAP = {
  'G': '試合数',
  'W': '勝数',
  'L': '敗数',
  'SV': 'セーブ',
  'SO': '奪三振',
  'ERA': '防御率',
  'ER': '自責点'
  // IP は特殊処理のため別途扱う → 投球回, 投球回13
};

// Gemini APIのデフォルトキー
export const DEFAULT_API_KEY = 'AIzaSyAw809H1yqTGIoVR7yTf6Lul9xjXUr14Nk';

// GoogleスプレッドシートのデフォルトID（共有用）
export const DEFAULT_SHEET_ID = 'https://docs.google.com/spreadsheets/d/1x9cN_GuYLxAj1hmsRl8L3saoFM9FugveNtgViPXhpM4/edit?gid=0#gid=0';

// 自動登録するデフォルトテンプレートのリスト
export const DEFAULT_TEMPLATES = [
  'DataBatter000.csv',
  'DataPitcher000.csv'
];

// Gemini APIのデフォルトモデル名
export const GEMINI_MODEL = 'gemini-2.5-flash';

// 利用可能なモデル一覧
export const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash（最新・推奨）' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite（軽量）' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite' },
];

// Gemini APIのエンドポイント
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
