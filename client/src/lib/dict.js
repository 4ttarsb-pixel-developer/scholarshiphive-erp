// ═══════════════════════════════════════════════════════════════
//  Translations for the page translator (see i18n.jsx).
//  Phrase lists live in ./dict/*.js as "English | Roman Urdu | اردو" lines.
//  To add a phrase: add one line to the right file — the English text must match
//  the button / label / heading exactly.
// ═══════════════════════════════════════════════════════════════
import A from './dict/a.js';
import B from './dict/b.js';
import C from './dict/c.js';
import D from './dict/d.js';
import E from './dict/e.js';
import F from './dict/f.js';

export const DICT = Object.create(null);

function load(raw) {
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(' | ');
    if (parts.length < 3) continue;
    const [en, roman, ur] = parts.map(s => s.trim());
    if (en && !DICT[en]) DICT[en] = { roman, ur };
  }
}
[A, B, C, D, E, F].forEach(load);

// Template phrases used with tx('…{n}…', { n })
const T = {
  'Step {n}': ['Step {n}', 'مرحلہ {n}'],
  '{n} day(s) before': ['{n} din pehle', '{n} دن پہلے'],
  'Next: {amount} due {date}': ['Agli: {amount} — due {date}', 'اگلی: {amount} — واجب {date}'],
  'Installments add up to {a} but the total is {b}.': ['Installments ka jor {a} hai magar total {b} hai.', 'اقساط کا مجموعہ {a} ہے مگر کل رقم {b} ہے۔'],
  'Installments add up to {a} but the pending amount is {b}.': ['Installments ka jor {a} hai magar baqi raqam {b} hai.', 'اقساط کا مجموعہ {a} ہے مگر بقایا رقم {b} ہے۔'],
  'Difference: {amount}': ['Farq: {amount}', 'فرق: {amount}'],
  'Adds up to {amount} ✓': ['Jor {amount} ✓', 'مجموعہ {amount} ✓'],
  'Commission {pct}% of the total': ['Total ka {pct}% commission', 'کل رقم کا {pct}% کمیشن'],
  'Commission for {name}': ['{name} ka commission', '{name} کا کمیشن'],
  'Pending {amount} in {n} installment(s)': ['Baqi {amount}, {n} installment(s) mein', 'بقایا {amount}، {n} اقساط میں'],
  '{n} installment(s)': ['{n} installment(s)', '{n} اقساط'],
  '{name} is larger than 3 MB.': ['{name} 3 MB se bari hai.', '{name} 3 MB سے بڑی ہے۔'],
  'Sale {inv} saved. Commission and salary update automatically.': ['Sale {inv} save ho gayi. Commission aur salary khud update ho jayegi.', 'سیل {inv} محفوظ ہو گئی۔ کمیشن اور تنخواہ خود اپ ڈیٹ ہو جائیں گی۔'],
  'Collections are {dir} {n}% vs the previous period.': ['Wasooli pichli muddat ke muqable mein {n}% {dir} hai.', 'وصولی پچھلی مدت کے مقابلے میں {n}% {dir} ہے۔'],
  'Outstanding amount is {n}% of booked revenue.': ['Baqi raqam booked revenue ka {n}% hai.', 'بقایا رقم بک شدہ ریونیو کا {n}% ہے۔'],
  'Top service: {name} ({amount}).': ['Sab se bari service: {name} ({amount}).', 'سب سے بڑی سروس: {name} ({amount})۔'],
  '{name} contributed {n}% of revenue.': ['{name} ne revenue ka {n}% diya.', '{name} نے ریونیو کا {n}% دیا۔'],
  '{n} deal(s) are overdue — {amount} still to collect.': ['{n} deal(s) late hain — {amount} abhi wasool karna hai.', '{n} ڈیلز تاخیر کا شکار ہیں — {amount} ابھی وصول کرنا ہے۔'],
  '{n} unread announcement(s)': ['{n} na-parhe announcement(s)', '{n} نہ پڑھے گئے اعلانات'],
  'of {target}': ['{target} mein se', '{target} میں سے'],
  up: ['zyada', 'زیادہ'],
  down: ['kam', 'کم'],
  overdue: ['late', 'تاخیر شدہ'],
  of: ['mein se', 'میں سے'],
  'Collected {a} · refunds {b}': ['Wasool {a} · refunds {b}', 'وصول {a} · ریفنڈ {b}'],
  'Salaries {a}': ['Salaries {a}', 'تنخواہیں {a}'],
  'Margin {a}%': ['Margin {a}%', 'مارجن {a}%'],
  'In {a} · out {b}': ['Andar {a} · bahar {b}', 'آمد {a} · اخراج {b}'],
  '{n} result(s)': ['{n} nateeje', '{n} نتائج'],
  "Next month's collection is expected to be {amount}.": ['Agle mahine {amount} wasool hone ki tawaqqo hai.', 'اگلے مہینے {amount} وصول ہونے کی توقع ہے۔'],
  'A new version of the ERP is available': ['ERP ka naya version aa gaya hai', 'ERP کا نیا ورژن دستیاب ہے'],
  'Please reload to continue.': ['Jari rakhne ke liye page reload karen.', 'جاری رکھنے کے لیے صفحہ دوبارہ لوڈ کریں۔'],
  'Your data is safe. Reload the page; if it happens again, tell admin what you clicked.': ['Aap ka data mehfooz hai. Page reload karen; dobara ho to admin ko batayen ke aap ne kya dabaya tha.', 'آپ کا ڈیٹا محفوظ ہے۔ صفحہ دوبارہ لوڈ کریں؛ دوبارہ ہو تو ایڈمن کو بتائیں کہ آپ نے کیا دبایا تھا۔'],
};
for (const [en, [roman, ur]] of Object.entries(T)) DICT[en] = { roman, ur };

// Text built from several pieces (numbers inside) — matched with a pattern.
const num = '([\\d,.]+)';
export const PATTERNS = [
  { re: /^(\d+) min ago$/, roman: n => `${n} minute pehle`, ur: n => `${n} منٹ پہلے` },
  { re: /^(\d+) h ago$/, roman: n => `${n} ghante pehle`, ur: n => `${n} گھنٹے پہلے` },
  { re: /^(\d+) d ago$/, roman: n => `${n} din pehle`, ur: n => `${n} دن پہلے` },
  { re: new RegExp(`^${num} result\\(s\\)$`), roman: n => `${n} nateeje`, ur: n => `${n} نتائج` },
  { re: new RegExp(`^Showing ${num}–${num} of ${num}$`), roman: (a, b, c) => `${c} mein se ${a}–${b}`, ur: (a, b, c) => `${c} میں سے ${a}–${b}` },
  { re: new RegExp(`^Page ${num} / ${num}$`), roman: (a, b) => `Page ${a} / ${b}`, ur: (a, b) => `صفحہ ${a} / ${b}` },
  { re: /^(\d+) day\(s\) before$/, roman: n => `${n} din pehle`, ur: n => `${n} دن پہلے` },
  { re: /^Step (\d+)$/, roman: n => `Step ${n}`, ur: n => `مرحلہ ${n}` },
  { re: /^Received so far: (PKR .+)$/, roman: a => `Ab tak wasool: ${a}`, ur: a => `اب تک وصول: ${a}` },
  { re: /^Total (PKR .+) · received (PKR .+)$/, roman: (a, b) => `Total ${a} · wasool ${b}`, ur: (a, b) => `کل ${a} · وصول ${b}` },
  { re: /^Payment plan · (INV-\d+)$/, roman: a => `Payment plan · ${a}`, ur: a => `ادائیگی کا منصوبہ · ${a}` },
  { re: /^Balance due (.+)\.$/, roman: a => `Baqi raqam ki due date ${a}.`, ur: a => `بقایا کی تاریخ ${a}۔` },
  { re: /^No installment plan\. ?(.*)$/, roman: a => `Koi installment plan nahi. ${a}`.trim(), ur: a => `اقساط کا کوئی منصوبہ نہیں۔ ${a}`.trim() },
  { re: /^(\d+) not approved yet$/, roman: n => `${n} abhi approve nahi`, ur: n => `${n} ابھی منظور نہیں` },
  { re: /^(\d+) waiting approval$/, roman: n => `${n} approval ke intezar mein`, ur: n => `${n} منظوری کے انتظار میں` },
];
