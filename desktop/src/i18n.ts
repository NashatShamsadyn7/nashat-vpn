export type Lang = 'en' | 'ar' | 'ckb';

export const LANGS: { code: Lang; label: string; dir: 'ltr' | 'rtl' }[] = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'ar', label: 'العربية', dir: 'rtl' },
  { code: 'ckb', label: 'کوردی', dir: 'rtl' },
];

const dict = {
  en: {
    appName: 'Nashat VPN',
    chooseServer: 'Choose a location',
    connect: 'Connect',
    disconnect: 'Disconnect',
    connected: 'Protected',
    disconnected: 'Not protected',
    connecting: 'Connecting…',
    noLocations: 'No locations yet — pull down to refresh, or add a server manually in Settings.',
    myServers: 'My servers',
    premium: 'Free · unlimited · no account',
    ms: 'ms',
    settings: 'Settings',
    language: 'Language',
    advanced: 'Add server manually',
    importPlaceholder: 'Paste vless:// vmess:// trojan:// ss:// hysteria2:// link or subscription',
    importBtn: 'Import',
    imported: (n: number) => `Imported ${n} server${n === 1 ? '' : 's'}`,
    importFailed: 'No valid links found',
    refreshDir: 'Refresh locations',
    refreshing: 'Refreshing…',
    active: 'Selected',
    remove: 'Remove',
    errorEngine: 'Engine missing — reinstall the app',
    errorNoServers: 'This location has no server yet — pick another or add one in Settings.',
    failed: 'Connection failed',
    close: 'Close',
  },
  ar: {
    appName: 'نشت في بي إن',
    chooseServer: 'اختر الموقع',
    connect: 'اتصال',
    disconnect: 'قطع الاتصال',
    connected: 'محمي',
    disconnected: 'غير محمي',
    connecting: 'جارٍ الاتصال…',
    noLocations: 'لا توجد مواقع بعد — حدّث القائمة أو أضف خادماً يدوياً من الإعدادات.',
    myServers: 'خوادمي',
    premium: 'مجاني · بلا حدود · بلا حساب',
    ms: 'م.ث',
    settings: 'الإعدادات',
    language: 'اللغة',
    advanced: 'إضافة خادم يدوياً',
    importPlaceholder: 'ألصق رابط vless:// أو vmess:// أو trojan:// أو ss:// أو hysteria2:// أو اشتراكاً',
    importBtn: 'استيراد',
    imported: (n: number) => `تم استيراد ${n} خادم`,
    importFailed: 'لم يتم العثور على روابط صالحة',
    refreshDir: 'تحديث المواقع',
    refreshing: 'جارٍ التحديث…',
    active: 'المختار',
    remove: 'حذف',
    errorEngine: 'المحرك مفقود — أعد تثبيت التطبيق',
    errorNoServers: 'هذا الموقع بلا خادم بعد — اختر موقعاً آخر أو أضف خادماً من الإعدادات.',
    failed: 'فشل الاتصال',
    close: 'إغلاق',
  },
  ckb: {
    appName: 'نەشات ڤی پی ئێن',
    chooseServer: 'شوێن هەڵبژێرە',
    connect: 'پەیوەندی',
    disconnect: 'پچڕاندن',
    connected: 'پارێزراو',
    disconnected: 'بێ پارێزگاری',
    connecting: 'پەیوەندی دەکرێت…',
    noLocations: 'هێشتا هیچ شوێنێک نییە — نوێ بکەوە یان لە ڕێکخستنەوە سێرڤەر زیاد بکە.',
    myServers: 'سێرڤەرەکانم',
    premium: 'بەخۆڕایی · بێ سنوور · بەبێ هەژمار',
    ms: 'م.چ',
    settings: 'ڕێکخستن',
    language: 'زمان',
    advanced: 'زیادکردنی دەستی سێرڤەر',
    importPlaceholder: 'لینکی vless:// یان vmess:// یان trojan:// یان ss:// یان hysteria2:// بلکێنە',
    importBtn: 'هاوردن',
    imported: (n: number) => `${n} سێرڤەر هێنران`,
    importFailed: 'هیچ لینکی دروست نەدۆزرایەوە',
    refreshDir: 'نوێکردنەوەی شوێنەکان',
    refreshing: 'نوێ دەکرێتەوە…',
    active: 'هەڵبژاردە',
    remove: 'سڕینەوە',
    errorEngine: 'بزوێنەر نەدۆزرایەوە — دووبارە دامەزرێنە',
    errorNoServers: 'ئەم شوێنە هێشتا سێرڤەری نییە — شوێنێکی تر هەڵبژێرە.',
    failed: 'پەیوەندی سەرکەوتوو نەبوو',
    close: 'داخستن',
  },
} as const;

export function t(lang: Lang) {
  return dict[lang] ?? dict.en;
}

export function dirOf(lang: Lang): 'ltr' | 'rtl' {
  return lang === 'ar' || lang === 'ckb' ? 'rtl' : 'ltr';
}

/** Pick localized country name. */
export function countryName(loc: any, lang: Lang): string {
  if (!loc) return '';
  if (lang === 'ar') return loc.countryAr || loc.country;
  if (lang === 'ckb') return loc.countryKu || loc.country;
  return loc.country;
}
