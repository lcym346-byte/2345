// ===== 多語系核心模組 =====
// 用法：
//   import { initI18n, t, setLang, getLang, applyI18n } from './js/core/i18n.js';
//   await initI18n();        // 啟動時呼叫
//   t('login.title')          // 取得翻譯字串
//   setLang('en')             // 切換語言
//   applyI18n()               // 重新套用所有 data-i18n 元素

const SUPPORTED_LANGS = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'vi', 'th', 'id'];
const DEFAULT_LANG = 'zh-TW';
const STORAGE_KEY = 'app_lang';

let currentLang = DEFAULT_LANG;
let translations = {};   // 當前語言的字典
let fallbackTranslations = {}; // 預設語言（繁中）字典，當缺翻譯時 fallback
let observers = [];      // 語言變更回呼

// 從 localStorage 讀偏好，沒有就用瀏覽器語言
function detectLang() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  
  const browser = (navigator.language || 'zh-TW');
  // 完全比對
  if (SUPPORTED_LANGS.includes(browser)) return browser;
  // 語言代碼比對（en-US → en）
  const base = browser.split('-')[0];
  const found = SUPPORTED_LANGS.find(l => l.startsWith(base));
  return found || DEFAULT_LANG;
}

// 載入指定語言的 json 檔
async function loadLangFile(lang) {
  try {
    const res = await fetch(`./locales/${lang}.json?v=${Date.now()}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    console.warn(`載入語言檔失敗：${lang}`, e);
    return {};
  }
}

// 啟動時呼叫
export async function initI18n() {
  currentLang = detectLang();
  
  // 同時載入當前語言與 fallback（zh-TW）
  if (currentLang === DEFAULT_LANG) {
    translations = await loadLangFile(DEFAULT_LANG);
    fallbackTranslations = translations;
  } else {
    const [cur, fb] = await Promise.all([
      loadLangFile(currentLang),
      loadLangFile(DEFAULT_LANG),
    ]);
    translations = cur;
    fallbackTranslations = fb;
  }
  
  // 設定 html lang 屬性
  document.documentElement.lang = currentLang;
  applyI18n();
}

// 取得翻譯字串（支援 dot notation：'login.title'）
export function t(key, vars) {
  let val = getNested(translations, key);
  if (val === undefined) val = getNested(fallbackTranslations, key);
  if (val === undefined) return key; // 找不到就回 key 本身
  
  // 變數替換：t('hello', { name: '小明' }) → 對應 "你好 {name}" → "你好 小明"
  if (vars && typeof val === 'string') {
    val = val.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
  }
  return val;
}

function getNested(obj, path) {
  if (!obj) return undefined;
  return path.split('.').reduce((cur, k) => (cur && cur[k] !== undefined) ? cur[k] : undefined, obj);
}

// 切換語言
export async function setLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) {
    console.warn('不支援的語言：' + lang);
    return;
  }
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  
  if (lang === DEFAULT_LANG) {
    translations = fallbackTranslations.title !== undefined ? fallbackTranslations : await loadLangFile(DEFAULT_LANG);
  } else {
    translations = await loadLangFile(lang);
  }
  document.documentElement.lang = lang;
  applyI18n();
  observers.forEach(fn => { try { fn(lang); } catch {} });
}

export function getLang() { return currentLang; }
export function getSupportedLangs() { return SUPPORTED_LANGS.slice(); }

// 註冊語言切換回呼（給需要重新渲染的頁面用）
export function onLangChange(fn) { observers.push(fn); }

// 套用所有 data-i18n 元素
export function applyI18n() {
  // 文字內容：<span data-i18n="login.title"></span>
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  // 屬性翻譯：<input data-i18n-placeholder="login.email_ph">
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.setAttribute('placeholder', t(key));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.setAttribute('title', t(key));
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria-label');
    el.setAttribute('aria-label', t(key));
  });
}

// 語言名稱對照（顯示在切換器）
export const LANG_NAMES = {
  'zh-TW': '繁體中文',
  'zh-CN': '简体中文',
  'en': 'English',
  'ja': '日本語',
  'ko': '한국어',
  'vi': 'Tiếng Việt',
  'th': 'ไทย',
  'id': 'Bahasa Indonesia',
};
