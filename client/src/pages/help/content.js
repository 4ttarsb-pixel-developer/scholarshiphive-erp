// ═══════════════════════════════════════════════════════════════
//  Help centre content — English · Roman Urdu · اردو
//  Each answer: lines starting with "- " become bullet points, "1. " numbered steps.
// ═══════════════════════════════════════════════════════════════

export const TOPICS = [
  // ───────────────────────── 1. Getting started ─────────────────────────
  {
    id: 'start', icon: 'Rocket',
    title: { en: 'Getting started & login', roman: 'Shuru karna aur login', ur: 'آغاز اور لاگ اِن' },
    items: [
      {
        q: { en: 'What is ScholarshipHive ERP?', roman: 'ScholarshipHive ERP kya hai?', ur: 'اسکالرشپ ہائیو ERP کیا ہے؟' },
        a: {
          en: 'It is the internal staff portal of ScholarshipHive. One place for:\n- Revenue: sales / deals, customers, payments, installments, receipts, refunds and forecast\n- Expenses: constant (monthly) and variable (daily) expenses with approvals\n- Petty cash, salaries with sales commission, assets, liabilities and cash flow\n- Reports (PDF / CSV), announcements and notifications\nEvery page is protected — you only see the pages an admin has given you.',
          roman: 'Ye ScholarshipHive ka andaruni (internal) staff portal hai. Aik hi jagah par:\n- Revenue: sales / deals, customers, payments, installments, receipts, refunds aur forecast\n- Expenses: constant (har mahine wale) aur variable (rozana wale) kharche, approval ke sath\n- Petty cash, commission ke sath salary, assets, liabilities aur cash flow\n- Reports (PDF / CSV), announcements aur notifications\nHar page protected hai — aap sirf wohi pages dekh sakte hain jo admin ne aap ko diye hon.',
          ur: 'یہ اسکالرشپ ہائیو کا اندرونی اسٹاف پورٹل ہے۔ ایک ہی جگہ پر:\n- ریونیو: سیلز / ڈیلز، کسٹمرز، ادائیگیاں، اقساط، رسیدیں، ریفنڈ اور فورکاسٹ\n- اخراجات: مستقل (ماہانہ) اور متغیر (روزانہ) اخراجات، منظوری کے ساتھ\n- پیٹی کیش، کمیشن کے ساتھ تنخواہ، اثاثے، واجبات اور کیش فلو\n- رپورٹس (PDF / CSV)، اعلانات اور نوٹیفکیشنز\nہر صفحہ محفوظ ہے — آپ صرف وہی صفحات دیکھ سکتے ہیں جن کی اجازت ایڈمن نے دی ہو۔',
        },
      },
      {
        q: { en: 'How do I create my account?', roman: 'Main apna account kaise banaun?', ur: 'میں اپنا اکاؤنٹ کیسے بناؤں؟' },
        a: {
          en: '1. On the login page tap "Create an account".\n2. Verify your email with Google (only your name and email are read).\n3. Fill the 5 steps: Email, Personal, Contact, Education & documents, Password.\n4. Submit — your account stays "Pending" until an admin approves it. You get an email when it is approved.',
          roman: '1. Login page par "Create an account" dabayen.\n2. Google ke zariye apni email verify karen (sirf naam aur email li jati hai).\n3. 5 steps bharen: Email, Personal, Contact, Education & documents, Password.\n4. Submit karen — admin ke approve karne tak account "Pending" rehta hai. Approve hone par aap ko email aa jati hai.',
          ur: '1. لاگ اِن صفحے پر "Create an account" دبائیں۔\n2. گوگل کے ذریعے اپنی ای میل کی تصدیق کریں (صرف نام اور ای میل لی جاتی ہے)۔\n3. پانچ مراحل پُر کریں: ای میل، ذاتی معلومات، رابطہ، تعلیم و دستاویزات، پاس ورڈ۔\n4. جمع کروائیں — ایڈمن کی منظوری تک اکاؤنٹ "Pending" رہتا ہے۔ منظوری پر آپ کو ای میل مل جاتی ہے۔',
        },
      },
      {
        q: { en: 'It says "Email or password is incorrect". What should I do?', roman: '"Email or password is incorrect" likha aa raha hai, kya karun?', ur: '"Email or password is incorrect" لکھا آ رہا ہے، کیا کروں؟' },
        a: {
          en: '- Check the email is the same one you registered with (no extra space).\n- Passwords are case-sensitive — check Caps Lock.\n- If you forgot it, tap "Forgot password?" under the password box and follow the email link.\n- If your account is still pending or blocked, the message will say so — ask an admin.\n- After many wrong tries the login is paused for a few minutes for safety. Wait and try again.',
          roman: '- Check karen ke email wohi hai jis se register kiya tha (aage peeche space na ho).\n- Password mein capital/small letters ka farq hota hai — Caps Lock check karen.\n- Agar password bhool gaye hain to password box ke neeche "Forgot password?" dabayen aur email wala link kholen.\n- Agar account abhi pending ya blocked hai to message mein yehi likha aayega — admin se rabta karen.\n- Bohat dafa ghalat password dalne par security ke liye login kuch minute ke liye ruk jata hai. Thora intezar karke dobara koshish karen.',
          ur: '- چیک کریں کہ ای میل وہی ہے جس سے رجسٹر کیا تھا (آگے پیچھے خالی جگہ نہ ہو)۔\n- پاس ورڈ میں بڑے اور چھوٹے حروف کا فرق ہوتا ہے — Caps Lock چیک کریں۔\n- اگر پاس ورڈ بھول گئے ہیں تو پاس ورڈ خانے کے نیچے "Forgot password?" دبائیں اور ای میل والا لنک کھولیں۔\n- اگر اکاؤنٹ ابھی زیرِ التوا یا بلاک ہے تو پیغام میں یہی لکھا آئے گا — ایڈمن سے رابطہ کریں۔\n- بار بار غلط پاس ورڈ ڈالنے پر حفاظت کے لیے لاگ اِن چند منٹ کے لیے رک جاتا ہے۔ کچھ دیر انتظار کر کے دوبارہ کوشش کریں۔',
        },
      },
      {
        q: { en: 'How do I reset a forgotten password?', roman: 'Bhoola hua password kaise reset karun?', ur: 'بھولا ہوا پاس ورڈ کیسے ری سیٹ کروں؟' },
        a: {
          en: '1. On the login page tap "Forgot password?".\n2. Enter your account email and tap "Send reset link". (Or choose "Verify with Google" to reset straight away.)\n3. Open the email (check Spam / Promotions too) and tap the link within 30 minutes. The link works only once.\n4. Choose a new strong password. All old sessions are logged out.\nIf no email arrives, an admin can create a reset link for you: Admin Settings → Users → open your profile → "Send password reset link".',
          roman: '1. Login page par "Forgot password?" dabayen.\n2. Apni account wali email likh kar "Send reset link" dabayen. (Ya "Verify with Google" chun kar foran reset karen.)\n3. Email kholen (Spam / Promotions folder bhi dekhen) aur 30 minute ke andar link dabayen. Link sirf aik dafa chalta hai.\n4. Naya mazboot password rakhen. Purane saare logins khud band ho jate hain.\nAgar email na aaye to admin aap ke liye link bana sakta hai: Admin Settings → Users → aap ki profile → "Send password reset link".',
          ur: '1. لاگ اِن صفحے پر "Forgot password?" دبائیں۔\n2. اپنی اکاؤنٹ والی ای میل لکھ کر "Send reset link" دبائیں۔ (یا "Verify with Google" منتخب کر کے فوراً ری سیٹ کریں۔)\n3. ای میل کھولیں (اسپیم / پروموشنز فولڈر بھی دیکھیں) اور 30 منٹ کے اندر لنک دبائیں۔ لنک صرف ایک بار کام کرتا ہے۔\n4. نیا مضبوط پاس ورڈ رکھیں۔ پرانے تمام لاگ اِن خود بند ہو جاتے ہیں۔\nاگر ای میل نہ آئے تو ایڈمن آپ کے لیے لنک بنا سکتا ہے: Admin Settings ← Users ← آپ کی پروفائل ← "Send password reset link"۔',
        },
      },
      {
        q: { en: 'What are the password rules?', roman: 'Password ke rules kya hain?', ur: 'پاس ورڈ کے اصول کیا ہیں؟' },
        a: {
          en: 'At least 12 characters with one capital letter, one small letter, one number and one symbol (e.g. ! @ # $). Example idea: Hive@Lahore2026. Never share your password — admins can never see it.',
          roman: 'Kam az kam 12 characters, jin mein aik capital letter, aik small letter, aik number aur aik symbol (jaise ! @ # $) ho. Misal: Hive@Lahore2026. Apna password kisi ko na batayen — admin bhi aap ka password nahi dekh sakta.',
          ur: 'کم از کم 12 حروف، جن میں ایک بڑا انگریزی حرف، ایک چھوٹا حرف، ایک عدد اور ایک علامت (جیسے ! @ # $) ہو۔ مثال: Hive@Lahore2026۔ اپنا پاس ورڈ کسی کو نہ بتائیں — ایڈمن بھی آپ کا پاس ورڈ نہیں دیکھ سکتا۔',
        },
      },
      {
        q: { en: 'Why was I logged out automatically?', roman: 'Main khud ba khud logout kyun ho gaya?', ur: 'میں خود بخود لاگ آؤٹ کیوں ہو گیا؟' },
        a: {
          en: 'For security a session ends after 30 minutes without activity, or when an admin changes your access / blocks your account, or after a password reset. Just log in again — nothing you saved is lost. Unsaved New Sale forms are kept as a draft on your device.',
          roman: 'Security ki wajah se 30 minute tak koi kaam na karne par session khatam ho jata hai. Isi tarah admin ke access badalne / account block karne ya password reset ke baad bhi logout hota hai. Dobara login kar len — jo save ho chuka hai woh mehfooz hai. Adhoora "New Sale" form aap ke device par draft ki tarah mehfooz rehta hai.',
          ur: 'حفاظت کی وجہ سے 30 منٹ تک کوئی سرگرمی نہ ہونے پر سیشن ختم ہو جاتا ہے۔ اسی طرح ایڈمن کے رسائی بدلنے، اکاؤنٹ بلاک کرنے یا پاس ورڈ ری سیٹ کے بعد بھی لاگ آؤٹ ہوتا ہے۔ دوبارہ لاگ اِن کر لیں — جو محفوظ ہو چکا ہے وہ ضائع نہیں ہوتا۔ ادھورا "New Sale" فارم آپ کے آلے پر ڈرافٹ کی صورت محفوظ رہتا ہے۔',
        },
      },
      {
        q: { en: 'How do I change the language (English / Roman Urdu / Urdu)?', roman: 'Zuban kaise badlun (English / Roman Urdu / Urdu)?', ur: 'زبان کیسے تبدیل کروں (انگریزی / رومن اردو / اردو)؟' },
        a: {
          en: 'Tap the language button (文A icon) at the top of any page — also on the login page — and choose English, Roman Urdu or اردو. Your choice is saved on your account, so it follows you on every device. You can also change it in My Settings → Appearance. Names, notes and amounts you type are never changed.',
          roman: 'Kisi bhi page ke upar language button (文A icon) dabayen — login page par bhi hai — aur English, Roman Urdu ya اردو chunen. Aap ki pasand account par save hoti hai, is liye har device par wohi zuban aati hai. My Settings → Appearance mein bhi badal sakte hain. Aap ke likhe hue naam, notes aur raqam kabhi nahi badalte.',
          ur: 'کسی بھی صفحے کے اوپر زبان کا بٹن (文A آئیکن) دبائیں — لاگ اِن صفحے پر بھی موجود ہے — اور English، Roman Urdu یا اردو منتخب کریں۔ آپ کا انتخاب اکاؤنٹ پر محفوظ ہوتا ہے، اس لیے ہر آلے پر وہی زبان آتی ہے۔ My Settings ← Appearance میں بھی تبدیل کر سکتے ہیں۔ آپ کے لکھے ہوئے نام، نوٹس اور رقوم کبھی تبدیل نہیں ہوتیں۔',
        },
      },
      {
        q: { en: 'Can I use it on my phone?', roman: 'Kya main ise mobile par chala sakta hun?', ur: 'کیا میں اسے موبائل پر استعمال کر سکتا ہوں؟' },
        a: {
          en: 'Yes. Open the website in Chrome / Safari. The menu opens from the ☰ button, tables scroll sideways and forms fit the screen. Tip: Chrome menu → "Add to Home screen" gives you an app icon.',
          roman: 'Ji haan. Website ko Chrome / Safari mein kholen. Menu ☰ button se khulta hai, tables side par scroll hoti hain aur forms screen ke mutabiq ho jate hain. Tip: Chrome menu → "Add to Home screen" se app jaisa icon ban jata hai.',
          ur: 'جی ہاں۔ ویب سائٹ کو کروم / سفاری میں کھولیں۔ مینو ☰ بٹن سے کھلتا ہے، ٹیبلز دائیں بائیں اسکرول ہوتی ہیں اور فارم اسکرین کے مطابق ہو جاتے ہیں۔ مشورہ: کروم مینو ← "Add to Home screen" سے ایپ جیسا آئیکن بن جاتا ہے۔',
        },
      },
    ],
  },

  // ───────────────────────── 2. Dashboard ─────────────────────────
  {
    id: 'dashboard', icon: 'LayoutDashboard',
    title: { en: 'Dashboard, quick access & notifications', roman: 'Dashboard, quick access aur notifications', ur: 'ڈیش بورڈ، فوری رسائی اور نوٹیفکیشنز' },
    items: [
      {
        q: { en: 'What does the dashboard show?', roman: 'Dashboard par kya nazar aata hai?', ur: 'ڈیش بورڈ پر کیا نظر آتا ہے؟' },
        a: {
          en: 'This month at a glance: revenue collected, expenses, profit, petty cash balance, your own salary and commission, latest announcements and (for admins) everything waiting for approval. Cards only appear for modules you can access.',
          roman: 'Is mahine ka khulasa: wasool shuda revenue, kharche, munafa, petty cash balance, aap ki apni salary aur commission, naye announcements aur (admin ke liye) approval ke intezar wali cheezen. Sirf unhi modules ke cards nazar aate hain jin ka access aap ke paas hai.',
          ur: 'اس مہینے کا خلاصہ: وصول شدہ ریونیو، اخراجات، منافع، پیٹی کیش بیلنس، آپ کی اپنی تنخواہ اور کمیشن، تازہ اعلانات اور (ایڈمن کے لیے) منظوری کی منتظر چیزیں۔ صرف انہی ماڈیولز کے کارڈ نظر آتے ہیں جن تک آپ کی رسائی ہے۔',
        },
      },
      {
        q: { en: 'What is the Quick Access bar?', roman: 'Quick Access bar kya hai?', ur: 'کوئیک ایکسیس بار کیا ہے؟' },
        a: {
          en: 'The small row of round buttons in the sidebar: Home, Quick settings, Help, Privacy policy, Light / dark mode and Logout. When the sidebar is collapsed they stand in a column. The green "New Sale / Deal" button under Revenue opens the sale form in one tap.',
          roman: 'Sidebar mein gol buttons ki chhoti qatar: Home, Quick settings, Help, Privacy policy, Light / dark mode aur Logout. Sidebar band ho to ye column mein aa jate hain. Revenue ke neeche hara "New Sale / Deal" button aik tap mein sale form kholta hai.',
          ur: 'سائیڈ بار میں گول بٹنوں کی چھوٹی قطار: Home، Quick settings، Help، Privacy policy، لائٹ / ڈارک موڈ اور Logout۔ سائیڈ بار بند ہو تو یہ کالم میں آ جاتے ہیں۔ ریونیو کے نیچے سبز "New Sale / Deal" بٹن ایک ٹیپ میں سیل فارم کھولتا ہے۔',
        },
      },
      {
        q: { en: 'How do notifications and payment alarms work?', roman: 'Notifications aur payment alarm kaise kaam karte hain?', ur: 'نوٹیفکیشنز اور ادائیگی کے الارم کیسے کام کرتے ہیں؟' },
        a: {
          en: 'The bell 🔔 at the top shows a red count of unread notifications: installments due soon, overdue payments, new sales under your name, approvals and more. Every morning the system checks all installment plans: when a due date is near (the "alarm" days you chose in the sale) it notifies the sales person and revenue managers, and sends an email if "Email" was ticked. Tap a notification to open the sale. "Mark all read" clears the count.',
          roman: 'Upar ghanti 🔔 par laal number na-parhi notifications batata hai: qareeb aati installments, overdue payments, aap ke naam par nayi sale, approvals waghera. Har subah system tamam installment plans check karta hai: jab due date qareeb ho (sale mein chune gaye "alarm" din) to sales person aur revenue managers ko notification jati hai, aur "Email" tick ho to email bhi. Notification dabane se sale khul jati hai. "Mark all read" se number saaf ho jata hai.',
          ur: 'اوپر گھنٹی 🔔 پر سرخ عدد نہ پڑھی گئی نوٹیفکیشنز بتاتا ہے: قریب آتی اقساط، تاخیر شدہ ادائیگیاں، آپ کے نام پر نئی سیل، منظوریاں وغیرہ۔ ہر صبح سسٹم تمام اقساط کے منصوبے چیک کرتا ہے: جب مقررہ تاریخ قریب ہو (سیل میں منتخب کیے گئے "الارم" کے دن) تو سیلز پرسن اور ریونیو مینیجرز کو نوٹیفکیشن جاتی ہے، اور "Email" منتخب ہو تو ای میل بھی۔ نوٹیفکیشن دبانے سے سیل کھل جاتی ہے۔ "Mark all read" سے عدد صاف ہو جاتا ہے۔',
        },
      },
      {
        q: { en: 'How do I switch between light and dark theme?', roman: 'Light aur dark theme kaise badlun?', ur: 'لائٹ اور ڈارک تھیم کیسے بدلوں؟' },
        a: {
          en: 'Tap the moon / sun icon at the top, or go to My Settings → Appearance (theme and font size).',
          roman: 'Upar chand / suraj wala icon dabayen, ya My Settings → Appearance mein theme aur font size badlen.',
          ur: 'اوپر چاند / سورج والا آئیکن دبائیں، یا My Settings ← Appearance میں تھیم اور فونٹ سائز تبدیل کریں۔',
        },
      },
    ],
  },

  // ───────────────────────── 3. Revenue ─────────────────────────
  {
    id: 'revenue', icon: 'TrendingUp',
    title: { en: 'Revenue, sales & installments', roman: 'Revenue, sales aur installments', ur: 'ریونیو، سیلز اور اقساط' },
    items: [
      {
        q: { en: 'How do I add a new sale / deal?', roman: 'Nayi sale / deal kaise darj karun?', ur: 'نئی سیل / ڈیل کیسے درج کروں؟' },
        a: {
          en: 'Tap "New Sale / Deal" (sidebar under Revenue, or the button on any Revenue page). The form has 5 steps:\n1. Staff & service — sales staff member (commission goes to them), sale date, revenue category, service and package. Choose "Other" to type your own.\n2. Client — student / client name, phone with country code, email (optional) and study destination.\n3. Payment — total package, advance received, number of installments. For non-cash advance the reference / receipt no. is required.\n4. Installments & alarm — the pending amount is split automatically every 30 days; change any date or amount. Pick the alarm (e.g. 3 days before) and how to remind (app, email, WhatsApp).\n5. Documents & notes — passport, transcripts, offer letter, other (PDF / image, max 3 MB each) and a note. Check the summary and tap "Save sale".\nThe receipt opens straight away with a QR code, PDF download and WhatsApp share.',
          roman: '"New Sale / Deal" dabayen (sidebar mein Revenue ke neeche, ya Revenue ke kisi bhi page ka button). Form ke 5 steps hain:\n1. Staff & service — sales staff member (commission isi ko milta hai), sale ki tareekh, revenue category, service aur package. Apna likhne ke liye "Other" chunen.\n2. Client — student / client ka naam, country code ke sath phone, email (optional) aur parhai ka mulk.\n3. Payment — total package, advance jo mila, installments ki tadaad. Cash ke ilawa advance par reference / receipt number zaroori hai.\n4. Installments & alarm — baqi raqam khud ba khud har 30 din par taqseem ho jati hai; koi bhi date ya raqam badal sakte hain. Alarm chunen (jaise 3 din pehle) aur yaad dihani ka tareeqa (app, email, WhatsApp).\n5. Documents & notes — passport, transcripts, offer letter, other (PDF / tasveer, har aik 3 MB tak) aur note. Summary check karke "Save sale" dabayen.\nReceipt foran khul jati hai — QR code, PDF download aur WhatsApp share ke sath.',
          ur: '"New Sale / Deal" دبائیں (سائیڈ بار میں ریونیو کے نیچے، یا ریونیو کے کسی بھی صفحے کا بٹن)۔ فارم کے پانچ مراحل ہیں:\n1. اسٹاف اور سروس — سیلز اسٹاف ممبر (کمیشن اسی کو ملتا ہے)، سیل کی تاریخ، ریونیو کیٹیگری، سروس اور پیکیج۔ اپنا لکھنے کے لیے "Other" منتخب کریں۔\n2. کلائنٹ — طالب علم / کلائنٹ کا نام، کنٹری کوڈ کے ساتھ فون، ای میل (اختیاری) اور تعلیم کا ملک۔\n3. ادائیگی — کل پیکیج، موصول شدہ ایڈوانس، اقساط کی تعداد۔ نقد کے علاوہ ایڈوانس پر ریفرنس / رسید نمبر ضروری ہے۔\n4. اقساط اور الارم — بقایا رقم خود بخود ہر 30 دن پر تقسیم ہو جاتی ہے؛ کوئی بھی تاریخ یا رقم بدل سکتے ہیں۔ الارم منتخب کریں (مثلاً 3 دن پہلے) اور یاد دہانی کا طریقہ (ایپ، ای میل، واٹس ایپ)۔\n5. دستاویزات اور نوٹس — پاسپورٹ، ٹرانسکرپٹس، آفر لیٹر، دیگر (PDF / تصویر، ہر ایک 3 MB تک) اور نوٹ۔ خلاصہ چیک کر کے "Save sale" دبائیں۔\nرسید فوراً کھل جاتی ہے — QR کوڈ، PDF ڈاؤن لوڈ اور واٹس ایپ شیئر کے ساتھ۔',
        },
      },
      {
        q: { en: 'How do I record an installment / payment received?', roman: 'Installment / payment wasool hone par kaise darj karun?', ur: 'قسط / ادائیگی موصول ہونے پر کیسے درج کروں؟' },
        a: {
          en: 'Two ways:\n- Open the sale → Payment plan → choose the method (and reference) → "Mark paid". The next unpaid installment is received in full.\n- For any other amount use "Record payment" (sale receipt, Payments page or Upcoming Payments page). Partial amounts are fine.\nPayments are applied to installments from the oldest first, so the plan, the status (Paid / Partially Paid / Overdue) and the alarms always stay correct. Commission and salary update automatically.',
          roman: 'Do tareeqe:\n- Sale kholen → Payment plan → method (aur reference) chunen → "Mark paid". Agli baqi installment poori wasool ho jati hai.\n- Kisi aur raqam ke liye "Record payment" istemal karen (sale receipt, Payments page ya Upcoming Payments page se). Adhoori raqam bhi darj ho sakti hai.\nPayments sab se purani installment se shuru ho kar lagti hain, is liye plan, status (Paid / Partially Paid / Overdue) aur alarms hamesha durust rehte hain. Commission aur salary khud update hoti hai.',
          ur: 'دو طریقے:\n- سیل کھولیں ← Payment plan ← طریقۂ ادائیگی (اور ریفرنس) منتخب کریں ← "Mark paid"۔ اگلی بقایا قسط پوری وصول ہو جاتی ہے۔\n- کسی اور رقم کے لیے "Record payment" استعمال کریں (سیل کی رسید، Payments صفحہ یا Upcoming Payments صفحہ سے)۔ جزوی رقم بھی درج ہو سکتی ہے۔\nادائیگیاں سب سے پرانی قسط سے شروع ہو کر لگتی ہیں، اس لیے منصوبہ، اسٹیٹس (Paid / Partially Paid / Overdue) اور الارم ہمیشہ درست رہتے ہیں۔ کمیشن اور تنخواہ خود اپ ڈیٹ ہوتی ہیں۔',
        },
      },
      {
        q: { en: 'How do I change the installment plan or due dates?', roman: 'Installment plan ya due dates kaise badlun?', ur: 'اقساط کا منصوبہ یا تاریخیں کیسے بدلوں؟' },
        a: {
          en: 'Open the sale → Payment plan → "Edit plan". Change dates or amounts, add / remove rows or tap "Split remaining equally". The total of all rows must equal the deal total (the screen shows the difference). Rows already covered by money received stay "Paid". You can also change the alarm days and channels here.',
          roman: 'Sale kholen → Payment plan → "Edit plan". Dates ya raqam badlen, rows add / remove karen ya "Split remaining equally" dabayen. Tamam rows ka jor deal ke total ke barabar hona chahiye (screen farq dikhati hai). Jo rows wasool shuda raqam se poori ho chuki hain woh "Paid" rehti hain. Alarm ke din aur tareeqa bhi yahin badal sakte hain.',
          ur: 'سیل کھولیں ← Payment plan ← "Edit plan"۔ تاریخیں یا رقم بدلیں، قطاریں شامل / ختم کریں یا "Split remaining equally" دبائیں۔ تمام قطاروں کا مجموعہ ڈیل کے کل کے برابر ہونا چاہیے (اسکرین فرق دکھاتی ہے)۔ جو قطاریں وصول شدہ رقم سے پوری ہو چکی ہیں وہ "Paid" رہتی ہیں۔ الارم کے دن اور طریقہ بھی یہیں بدل سکتے ہیں۔',
        },
      },
      {
        q: { en: 'What do the statuses mean?', roman: 'Status ka kya matlab hai?', ur: 'اسٹیٹس کا کیا مطلب ہے؟' },
        a: {
          en: '- Paid — the full deal amount is received.\n- Partially Paid — some money received, next installment not late yet.\n- Pending — nothing received yet and nothing late.\n- Overdue — the next installment (or balance due date) has passed. Shown in red.\n- Refunded — the money received has been returned.',
          roman: '- Paid — poori raqam wasool ho chuki.\n- Partially Paid — kuch raqam mili, agli installment abhi late nahi.\n- Pending — abhi kuch nahi mila aur kuch late bhi nahi.\n- Overdue — agli installment (ya balance ki due date) guzar chuki. Laal rang mein.\n- Refunded — wasool shuda raqam wapas kar di gayi.',
          ur: '- Paid — پوری رقم وصول ہو چکی۔\n- Partially Paid — کچھ رقم ملی، اگلی قسط ابھی لیٹ نہیں۔\n- Pending — ابھی کچھ نہیں ملا اور کچھ لیٹ بھی نہیں۔\n- Overdue — اگلی قسط (یا بقایا کی تاریخ) گزر چکی۔ سرخ رنگ میں۔\n- Refunded — وصول شدہ رقم واپس کر دی گئی۔',
        },
      },
      {
        q: { en: 'How do I filter and find sales?', roman: 'Sales ko filter aur talash kaise karun?', ur: 'سیلز کو فلٹر اور تلاش کیسے کروں؟' },
        a: {
          en: 'On Revenue, Sales & Deals and Invoices use the filter bar: search (name, phone, email, invoice no., service), status, payment method, revenue category, package, country, staff and service, plus the date range (This month, Last month, This year, custom or All time). Active filters appear as chips — tap × to remove one. Sorting, paging and totals are done on the server, so it stays fast with thousands of sales.',
          roman: 'Revenue, Sales & Deals aur Invoices par filter bar istemal karen: search (naam, phone, email, invoice no., service), status, payment method, revenue category, package, mulk, staff aur service, aur date range (This month, Last month, This year, custom ya All time). Lage hue filters chips ki shakal mein dikhte hain — hatane ke liye × dabayen. Sorting, paging aur totals server par hote hain, is liye hazaron sales ke sath bhi tez chalta hai.',
          ur: 'ریونیو، Sales & Deals اور Invoices پر فلٹر بار استعمال کریں: تلاش (نام، فون، ای میل، انوائس نمبر، سروس)، اسٹیٹس، طریقۂ ادائیگی، ریونیو کیٹیگری، پیکیج، ملک، اسٹاف اور سروس، اور تاریخ کی حد (This month، Last month، This year، اپنی مرضی کی یا All time)۔ لگے ہوئے فلٹر چِپس کی صورت میں نظر آتے ہیں — ہٹانے کے لیے × دبائیں۔ ترتیب، صفحہ بندی اور مجموعے سرور پر ہوتے ہیں، اس لیے ہزاروں سیلز کے ساتھ بھی تیز چلتا ہے۔',
        },
      },
      {
        q: { en: 'How do I share or download a receipt?', roman: 'Receipt kaise share ya download karun?', ur: 'رسید کیسے شیئر یا ڈاؤن لوڈ کروں؟' },
        a: {
          en: 'Open the sale. At the bottom: "Receipt PDF" downloads a branded receipt with QR code, payment plan and payments. "WhatsApp" opens WhatsApp with a ready message (invoice, total, received, pending, next due) to the client\'s number. Invoices page lists every deal with a PDF button.',
          roman: 'Sale kholen. Neeche: "Receipt PDF" se QR code, payment plan aur payments wali branded receipt download hoti hai. "WhatsApp" client ke number par tayyar message (invoice, total, wasool, baqi, agli due) ke sath WhatsApp khol deta hai. Invoices page par har deal ke sath PDF button hai.',
          ur: 'سیل کھولیں۔ نیچے: "Receipt PDF" سے QR کوڈ، اقساط کے منصوبے اور ادائیگیوں والی برانڈڈ رسید ڈاؤن لوڈ ہوتی ہے۔ "WhatsApp" کلائنٹ کے نمبر پر تیار پیغام (انوائس، کل، وصول، بقایا، اگلی تاریخ) کے ساتھ واٹس ایپ کھول دیتا ہے۔ Invoices صفحے پر ہر ڈیل کے ساتھ PDF بٹن ہے۔',
        },
      },
      {
        q: { en: 'How do I attach documents (passport, transcripts, offer letter)?', roman: 'Documents (passport, transcripts, offer letter) kaise lagaun?', ur: 'دستاویزات (پاسپورٹ، ٹرانسکرپٹس، آفر لیٹر) کیسے لگاؤں؟' },
        a: {
          en: 'In step 5 of the New Sale form, or later: open the sale → Documents → choose the type → choose file → "Attach". PDF, JPG, PNG, WEBP or DOCX up to 3 MB each (photos are compressed automatically). Up to 20 documents per sale. If the same file was already uploaded somewhere, it is marked "Duplicate file".',
          roman: 'New Sale form ke step 5 mein, ya baad mein: sale kholen → Documents → type chunen → file chunen → "Attach". PDF, JPG, PNG, WEBP ya DOCX, har aik 3 MB tak (photos khud chhoti ho jati hain). Aik sale par 20 documents tak. Agar yehi file pehle kahin upload ho chuki ho to "Duplicate file" ka nishan lag jata hai.',
          ur: 'New Sale فارم کے پانچویں مرحلے میں، یا بعد میں: سیل کھولیں ← Documents ← قسم منتخب کریں ← فائل منتخب کریں ← "Attach"۔ PDF، JPG، PNG، WEBP یا DOCX، ہر ایک 3 MB تک (تصاویر خود چھوٹی ہو جاتی ہیں)۔ ایک سیل پر 20 دستاویزات تک۔ اگر یہی فائل پہلے کہیں اپ لوڈ ہو چکی ہو تو "Duplicate file" کا نشان لگ جاتا ہے۔',
        },
      },
      {
        q: { en: 'How do refunds work?', roman: 'Refund kaise hota hai?', ur: 'ریفنڈ کیسے ہوتا ہے؟' },
        a: {
          en: 'Open the sale → "Refund", or Revenue → Refunds → "Add refund". Enter amount, date and reason (a refund cannot be more than the money received). Refunds reduce net revenue, profit and the commission base of that month. A fully refunded sale shows "Refunded".',
          roman: 'Sale kholen → "Refund", ya Revenue → Refunds → "Add refund". Raqam, tareekh aur wajah likhen (refund wasool shuda raqam se zyada nahi ho sakta). Refund se net revenue, munafa aur us mahine ka commission kam hota hai. Poora refund hone par sale "Refunded" dikhati hai.',
          ur: 'سیل کھولیں ← "Refund"، یا Revenue ← Refunds ← "Add refund"۔ رقم، تاریخ اور وجہ لکھیں (ریفنڈ وصول شدہ رقم سے زیادہ نہیں ہو سکتا)۔ ریفنڈ سے خالص ریونیو، منافع اور اس مہینے کا کمیشن کم ہوتا ہے۔ پورا ریفنڈ ہونے پر سیل "Refunded" دکھاتی ہے۔',
        },
      },
      {
        q: { en: 'What are Customers, Upcoming Payments and Forecast?', roman: 'Customers, Upcoming Payments aur Forecast kya hain?', ur: 'Customers، Upcoming Payments اور Forecast کیا ہیں؟' },
        a: {
          en: '- Customers: every student / client with number of deals, total, received and outstanding balance.\n- Upcoming Payments: all unpaid balances sorted by next due date, overdue first — call these clients.\n- Forecast: expected collections for the next months from the installment plans plus a trend from the last 6 months, and the open pipeline.',
          roman: '- Customers: har student / client, deals ki tadaad, total, wasool aur baqi balance ke sath.\n- Upcoming Payments: tamam baqi raqam agli due date ke hisab se, overdue sab se upar — in clients ko call karen.\n- Forecast: installment plans aur pichle 6 mahine ke trend se aane wale mahinon ki mutawaqqa wasooli, aur khuli pipeline.',
          ur: '- Customers: ہر طالب علم / کلائنٹ، ڈیلز کی تعداد، کل، وصول اور بقایا بیلنس کے ساتھ۔\n- Upcoming Payments: تمام بقایا رقوم اگلی تاریخ کے حساب سے، تاخیر والی سب سے اوپر — ان کلائنٹس کو کال کریں۔\n- Forecast: اقساط کے منصوبوں اور پچھلے 6 مہینوں کے رجحان سے آنے والے مہینوں کی متوقع وصولی، اور کھلی پائپ لائن۔',
        },
      },
      {
        q: { en: 'How are monthly targets set?', roman: 'Monthly targets kaise set hote hain?', ur: 'ماہانہ اہداف کیسے مقرر ہوتے ہیں؟' },
        a: {
          en: 'Admins tap "Set targets" on the Revenue overview and enter a company target and a target for each staff member. Progress bars show sales booked this month against each target.',
          roman: 'Admin Revenue overview par "Set targets" daba kar company ka target aur har staff member ka target likhte hain. Progress bars is mahine ki sales ko target ke muqable mein dikhate hain.',
          ur: 'ایڈمن ریونیو اوورویو پر "Set targets" دبا کر کمپنی کا ہدف اور ہر اسٹاف ممبر کا ہدف لکھتے ہیں۔ پروگریس بارز اس مہینے کی سیلز کو ہدف کے مقابلے میں دکھاتی ہیں۔',
        },
      },
      {
        q: { en: 'Can I edit or delete a sale?', roman: 'Kya main sale edit ya delete kar sakta hun?', ur: 'کیا میں سیل میں ترمیم یا اسے حذف کر سکتا ہوں؟' },
        a: {
          en: 'With Revenue "edit" access: open the sale → "Edit" (client, category, service, package, country, total, date, staff, notes). If the total changes, unpaid installments are re-split automatically. "Delete" removes the sale with its payments, refunds, plan and documents — every change is kept in History and the activity log. Approved (locked) salaries do not change.',
          roman: 'Revenue ka "edit" access ho to: sale kholen → "Edit" (client, category, service, package, mulk, total, tareekh, staff, notes). Total badalne par baqi installments khud dobara taqseem ho jati hain. "Delete" sale ko us ki payments, refunds, plan aur documents samet hata deta hai — har tabdeeli History aur activity log mein mehfooz rehti hai. Approved (locked) salaries nahi badaltin.',
          ur: 'ریونیو کی "edit" رسائی ہو تو: سیل کھولیں ← "Edit" (کلائنٹ، کیٹیگری، سروس، پیکیج، ملک، کل رقم، تاریخ، اسٹاف، نوٹس)۔ کل رقم بدلنے پر بقایا اقساط خود دوبارہ تقسیم ہو جاتی ہیں۔ "Delete" سیل کو اس کی ادائیگیوں، ریفنڈز، منصوبے اور دستاویزات سمیت ہٹا دیتا ہے — ہر تبدیلی History اور ایکٹیویٹی لاگ میں محفوظ رہتی ہے۔ منظور شدہ (لاک) تنخواہیں نہیں بدلتیں۔',
        },
      },
    ],
  },

  // ───────────────────────── 4. Expenses ─────────────────────────
  {
    id: 'expenses', icon: 'Receipt',
    title: { en: 'Expenses & approvals', roman: 'Expenses aur approvals', ur: 'اخراجات اور منظوری' },
    items: [
      {
        q: { en: 'What is the difference between Constant and Variable expenses?', roman: 'Constant aur Variable expenses mein kya farq hai?', ur: 'مستقل اور متغیر اخراجات میں کیا فرق ہے؟' },
        a: {
          en: '- Constant: fixed monthly costs (rent, internet, software subscriptions, salaries of contractors…). Enter once as "recurring" with an amount and start month — a new cycle appears every month for approval.\n- Variable: daily or one-time spending (repairs, printing, travel, events…). Enter each time with its receipt.\nBoth have tabs to show Approved or Not approved items.',
          roman: '- Constant: har mahine ke muqarrar kharche (kiraya, internet, software subscriptions, contractors…). Aik dafa "recurring" ki tarah raqam aur shuru ka mahina likhen — har mahine nayi cycle approval ke liye aa jati hai.\n- Variable: rozana ya aik dafa ke kharche (repair, printing, safar, events…). Har dafa receipt ke sath darj karen.\nDono mein Approved ya Not approved dikhane ke tabs hain.',
          ur: '- مستقل (Constant): ہر مہینے کے مقررہ اخراجات (کرایہ، انٹرنیٹ، سافٹ ویئر سبسکرپشنز، کنٹریکٹرز…)۔ ایک بار "recurring" کے طور پر رقم اور آغاز کا مہینہ لکھیں — ہر مہینے نیا سائیکل منظوری کے لیے آ جاتا ہے۔\n- متغیر (Variable): روزانہ یا ایک بار کے اخراجات (مرمت، پرنٹنگ، سفر، تقریبات…)۔ ہر بار رسید کے ساتھ درج کریں۔\nدونوں میں Approved یا Not approved دکھانے کے ٹیبز ہیں۔',
        },
      },
      {
        q: { en: 'How do I add an expense?', roman: 'Expense kaise add karun?', ur: 'خرچ کیسے شامل کروں؟' },
        a: {
          en: '1. Open Expenses and tap "Add constant expense" (monthly) or "Add variable expense" (daily / one-time).\n2. For constant: enter the amount and start month once — every month is created for you.\n3. Pick the category (Office & Utilities, Salaries & HR, Software & Tech Subscriptions, Legal & Compliance, Others) — the item list changes with the category. Choose "Other" to type a new item.\n4. Enter amount, date, payment method, vendor and attach the receipt (photo or PDF).\n5. Save — it waits as "Not approved" until an approver approves it.',
          roman: '1. Expenses kholen aur "Add constant expense" (mahana) ya "Add variable expense" (rozana / aik dafa) dabayen.\n2. Constant ke liye raqam aur shuru ka mahina aik dafa likhen — har mahina khud ban jata hai.\n3. Category chunen (Office & Utilities, Salaries & HR, Software & Tech Subscriptions, Legal & Compliance, Others) — category ke sath item list badalti hai. Naya item likhne ke liye "Other" chunen.\n4. Raqam, tareekh, payment method, vendor likhen aur receipt lagayen (photo ya PDF).\n5. Save karen — approver ke approve karne tak "Not approved" rehta hai.',
          ur: '1. Expenses کھولیں اور "Add constant expense" (ماہانہ) یا "Add variable expense" (روزانہ / ایک بار) دبائیں۔\n2. مستقل خرچ کے لیے رقم اور آغاز کا مہینہ ایک بار لکھیں — ہر مہینہ خود بن جاتا ہے۔\n3. کیٹیگری منتخب کریں (Office & Utilities، Salaries & HR، Software & Tech Subscriptions، Legal & Compliance، Others) — کیٹیگری کے ساتھ آئٹم کی فہرست بدلتی ہے۔ نیا آئٹم لکھنے کے لیے "Other" منتخب کریں۔\n4. رقم، تاریخ، طریقۂ ادائیگی، وینڈر لکھیں اور رسید لگائیں (تصویر یا PDF)۔\n5. محفوظ کریں — منظوری تک "Not approved" رہتا ہے۔',
        },
      },
      {
        q: { en: 'Who approves expenses and how?', roman: 'Expenses kaun approve karta hai aur kaise?', ur: 'اخراجات کون منظور کرتا ہے اور کیسے؟' },
        a: {
          en: 'Admins and staff with "Expense Approvals (Manager)" edit access. Go to Expenses → Approvals: everything waiting is in one queue. Approve or reject one by one, or tick several and use "Approve selected" / "Reject selected". Rejecting needs a reason, which the person can see. Only approved expenses count in totals, profit and reports.',
          roman: 'Admin aur woh staff jin ke paas "Expense Approvals (Manager)" ka edit access ho. Expenses → Approvals par jayen: intezar wali har cheez aik queue mein hai. Aik aik karke approve / reject karen, ya kai select karke "Approve selected" / "Reject selected". Reject karne ke liye wajah likhna zaroori hai jo bande ko nazar aati hai. Sirf approved expenses totals, munafa aur reports mein gine jate hain.',
          ur: 'ایڈمن اور وہ اسٹاف جن کے پاس "Expense Approvals (Manager)" کی ترمیمی رسائی ہو۔ Expenses ← Approvals پر جائیں: منتظر ہر چیز ایک قطار میں ہے۔ ایک ایک کر کے منظور / مسترد کریں، یا کئی منتخب کر کے "Approve selected" / "Reject selected"۔ مسترد کرنے کے لیے وجہ لکھنا ضروری ہے جو متعلقہ شخص کو نظر آتی ہے۔ صرف منظور شدہ اخراجات مجموعوں، منافع اور رپورٹس میں شمار ہوتے ہیں۔',
        },
      },
      {
        q: { en: 'How do I manage expense categories?', roman: 'Expense categories kaise manage karun?', ur: 'اخراجات کی کیٹیگریز کیسے منظم کروں؟' },
        a: {
          en: 'Expenses → Categories (admins / approvers). Add, rename, hide or reorder categories and their items. Use "Add item" for items people often type under "Other". Hidden items stay on old records.',
          roman: 'Expenses → Categories (admin / approver). Categories aur un ke items add, rename, chhupa ya tarteeb de sakte hain. Jo items log aksar "Other" mein likhte hain unhen "Add item" se list mein daal den. Chhupaye gaye items purane records par qaim rehte hain.',
          ur: 'Expenses ← Categories (ایڈمن / منظور کنندہ)۔ کیٹیگریز اور ان کے آئٹمز شامل، نام تبدیل، چھپا یا ترتیب دے سکتے ہیں۔ جو آئٹمز لوگ اکثر "Other" میں لکھتے ہیں انہیں "Add item" سے فہرست میں شامل کریں۔ چھپائے گئے آئٹمز پرانے ریکارڈ پر برقرار رہتے ہیں۔',
        },
      },
      {
        q: { en: 'Where are salaries and loans in expenses?', roman: 'Expenses mein salaries aur loans kahan hain?', ur: 'اخراجات میں تنخواہیں اور قرض کہاں ہیں؟' },
        a: {
          en: 'Expenses → Salary expense register shows approved and paid salaries from Salary & Workforce. Expenses → Loans shows loans from Liabilities — repayments and interest count as expenses. You do not enter them twice.',
          roman: 'Expenses → Salary expense register mein Salary & Workforce se approved aur paid salaries nazar aati hain. Expenses → Loans mein Liabilities wale qarze — wapsi ki qistain aur sood kharche mein gine jate hain. Inhen dobara darj karne ki zaroorat nahi.',
          ur: 'Expenses ← Salary expense register میں Salary & Workforce سے منظور شدہ اور ادا شدہ تنخواہیں نظر آتی ہیں۔ Expenses ← Loans میں Liabilities والے قرضے — واپسی کی اقساط اور سود اخراجات میں شمار ہوتے ہیں۔ انہیں دوبارہ درج کرنے کی ضرورت نہیں۔',
        },
      },
      {
        q: { en: 'How do Marketing Analyzer expenses appear in Expenses and Cash Flow?', roman: 'Marketing Analyzer ke kharche Expenses aur Cash Flow mein kaise aate hain?', ur: 'Marketing Analyzer کے اخراجات Expenses اور Cash Flow میں کیسے آتے ہیں؟' },
        a: {
          en: 'Marketing Analyzer expenses marked Approved are included in the main Expenses overview, marketing category totals and Cash Flow actuals. Pending or In Review marketing entries are not treated as paid expenses. Use the Marketing Analyzer permission in Admin Settings → Users & Roles to grant access separately from general Expenses access.',
          roman: 'Marketing Analyzer ke Approved kharche main Expenses overview, marketing totals aur Cash Flow actuals mein shamil hote hain. Pending ya In Review entries ko paid expense nahi samjha jata. Admin Settings → Users & Roles mein Marketing Analyzer ka alag permission de kar access grant karen.',
          ur: 'Marketing Analyzer کے Approved اخراجات مرکزی Expenses overview، marketing totals اور Cash Flow actuals میں شامل ہوتے ہیں۔ Pending یا In Review اندراجات کو ادا شدہ خرچ نہیں سمجھا جاتا۔ Admin Settings → Users & Roles میں Marketing Analyzer کی الگ اجازت دے کر رسائی دیں۔'
        }
      },
      {
        q: { en: 'Why can I not open a sidebar page?', roman: 'Sidebar ka page kyun nahi khul raha?', ur: 'سائیڈبار کا صفحہ کیوں نہیں کھل رہا؟' },
        a: {
          en: 'A locked page means your account does not have the required permission. Ask an administrator to open Admin Settings → Users & Roles, select your account, enable the relevant module as View or Edit, and save access. Marketing Analyzer now has its own permission. If the sidebar is collapsed, use the arrow button to expand it; on a phone, use the menu button in the top bar.',
          roman: 'Locked page ka matlab hai account ke paas zaroori permission nahi. Admin se kahen Admin Settings → Users & Roles mein aap ka account khol kar relevant module ko View ya Edit de aur Save access kare. Marketing Analyzer ka alag permission hai. Sidebar band ho to arrow se kholen; mobile par top bar ka menu button dabayen.',
          ur: 'Locked صفحے کا مطلب ہے کہ آپ کے اکاؤنٹ میں مطلوبہ اجازت نہیں۔ ایڈمن سے کہیں Admin Settings → Users & Roles میں آپ کا اکاؤنٹ کھول کر متعلقہ ماڈیول کو View یا Edit دے اور Save access کرے۔ Marketing Analyzer کی الگ اجازت ہے۔ سائیڈبار بند ہو تو تیر والے بٹن سے کھولیں؛ موبائل پر اوپر مینو بٹن دبائیں۔'
        }
      },
      {
        q: { en: 'What should I do if totals do not match?', roman: 'Agar totals match na karen to kya karun?', ur: 'اگر مجموعے برابر نہ ہوں تو کیا کروں؟' },
        a: {
          en: 'First set the same date range and currency context on both pages. Only approved expenses are included in actual expense and cash-flow totals; rejected entries are excluded and pending entries remain separate. Salary records are pulled from Salary & Workforce automatically, so do not enter payroll again as a manual expense. Marketing Analyzer approved spend is included automatically. Refresh the page after a status change.',
          roman: 'Pehle dono pages par date range aik jaisi rakhen. Actual expenses aur cash-flow totals mein sirf Approved kharche shamil hote hain; rejected nikal diye jate hain aur pending alag rehte hain. Salary & Workforce ke records khud aate hain, payroll ko manual expense ke taur par dobara na dalen. Marketing Analyzer ka approved spend bhi khud shamil hota hai. Status badalne ke baad page refresh karen.',
          ur: 'پہلے دونوں صفحات پر تاریخ کی حد ایک جیسی رکھیں۔ اصل اخراجات اور کیش فلو کے مجموعوں میں صرف Approved اخراجات شامل ہوتے ہیں؛ مسترد اندراجات خارج اور زیرِ منظوری اندراجات الگ رہتے ہیں۔ Salary & Workforce کے ریکارڈ خود آتے ہیں، اس لیے پے رول دوبارہ دستی خرچ کے طور پر درج نہ کریں۔ Marketing Analyzer کا منظور شدہ خرچ بھی خود شامل ہوتا ہے۔ اسٹیٹس بدلنے کے بعد صفحہ ریفریش کریں۔'
        }
      },
    ],
  },

  // ───────────────────────── 5. Petty cash ─────────────────────────
  {
    id: 'petty', icon: 'Wallet',
    title: { en: 'Petty cash', roman: 'Petty cash', ur: 'پیٹی کیش' },
    items: [
      {
        q: { en: 'How does petty cash work?', roman: 'Petty cash kaise kaam karta hai?', ur: 'پیٹی کیش کیسے کام کرتا ہے؟' },
        a: {
          en: 'A top-up adds cash to the petty cash balance; every purchase (entry) is subtracted. The Overview shows the current balance, spending by category, top buyers and a trend chart. The Petty Cash Book shows a running balance line by line.',
          roman: 'Top-up se petty cash balance mein raqam barhti hai; har khareedari (entry) minus hoti hai. Overview mein mojooda balance, category ke hisab se kharch, sab se zyada khareedne wale aur trend chart hai. Petty Cash Book mein har line ke sath chalta hua balance hai.',
          ur: 'ٹاپ اپ سے پیٹی کیش بیلنس میں رقم بڑھتی ہے؛ ہر خریداری (اندراج) منہا ہوتی ہے۔ اوورویو میں موجودہ بیلنس، کیٹیگری کے حساب سے خرچ، سب سے زیادہ خریدنے والے اور رجحان کا چارٹ ہے۔ Petty Cash Book میں ہر سطر کے ساتھ چلتا ہوا بیلنس ہے۔',
        },
      },
      {
        q: { en: 'How do I add a petty cash entry?', roman: 'Petty cash entry kaise add karun?', ur: 'پیٹی کیش اندراج کیسے شامل کروں؟' },
        a: {
          en: 'Open Petty Cash and tap "Add purchase" (a top-up must exist first). Fill date, category and item, amount, who bought it, vendor, paid with (cash / card / wallet), what it was for, and attach the receipt. A voucher number is given automatically. Approvers then verify the receipt.',
          roman: 'Petty Cash kholen aur "Add purchase" dabayen (pehle top-up hona zaroori hai). Tareekh, category aur item, raqam, kis ne khareeda, vendor, kis se payment ki (cash / card / wallet), kis kaam ke liye, aur receipt lagayen. Voucher number khud mil jata hai. Phir approver receipt verify karta hai.',
          ur: 'Petty Cash کھولیں اور "Add purchase" دبائیں (پہلے ٹاپ اپ ہونا ضروری ہے)۔ تاریخ، کیٹیگری اور آئٹم، رقم، کس نے خریدا، وینڈر، کس سے ادائیگی کی (نقد / کارڈ / والٹ)، کس کام کے لیے، اور رسید لگائیں۔ واؤچر نمبر خود مل جاتا ہے۔ پھر منظور کنندہ رسید کی تصدیق کرتا ہے۔',
        },
      },
      {
        q: { en: 'Who can see petty cash?', roman: 'Petty cash kaun dekh sakta hai?', ur: 'پیٹی کیش کون دیکھ سکتا ہے؟' },
        a: {
          en: 'Petty cash has its own access ("Petty Cash"), separate from Expenses, so a cashier can be given only this page. Top-ups and receipt verification need "Expense Approvals (Manager)" edit access.',
          roman: 'Petty cash ka apna alag access ("Petty Cash") hai, Expenses se alag, taa ke cashier ko sirf yehi page diya ja sake. Top-ups aur receipt verify karne ke liye "Expense Approvals (Manager)" ka edit access chahiye.',
          ur: 'پیٹی کیش کی اپنی الگ رسائی ("Petty Cash") ہے، اخراجات سے الگ، تاکہ کیشیئر کو صرف یہی صفحہ دیا جا سکے۔ ٹاپ اپ اور رسید کی تصدیق کے لیے "Expense Approvals (Manager)" کی ترمیمی رسائی چاہیے۔',
        },
      },
    ],
  },

  // ───────────────────────── v5. Cash Flow Manager & budgets ─────────────────────────
  {
    id: 'cashflow', icon: 'Landmark',
    title: { en: 'Cash Flow Manager & budgets', roman: 'Cash Flow Manager aur budgets', ur: 'کیش فلو مینیجر اور بجٹ' },
    items: [
      {
        q: { en: 'What do Cash Runway, Forecast and Timing show?', roman: 'Cash Runway, Forecast aur Timing kya dikhate hain?', ur: 'کیش رن وے، فورکاسٹ اور ٹائمنگ کیا دکھاتے ہیں؟' },
        a: {
          en: 'Cash Runway = how many months today\'s cash lasts at the average burn. Cash Forecast = the cash budget: student installments, new sales (with seasonality), planned receipts in; salaries, rent, bills, tax, loans, average variable spending out — month by month with surplus / deficit. Inflow vs Outflow Timing = the same, day by day, with the lowest point. Set the opening cash and other numbers in "Assumptions".',
          roman: 'Cash Runway = aaj ka cash ausat kharch par kitne mahine chalega. Cash Forecast = cash budget: students ki qistain, nayi sales (seasonality ke sath), planned receipts aamad mein; tankhwah, kiraya, bills, tax, qarz, ausat variable kharch — har mahine surplus / deficit ke sath. Inflow vs Outflow = yehi roz ba roz, sab se kam point ke sath. Opening cash aur baqi numbers "Assumptions" mein set karein.',
          ur: 'کیش رن وے = آج کا کیش اوسط خرچ پر کتنے مہینے چلے گا۔ کیش فورکاسٹ = کیش بجٹ: طلبہ کی قسطیں، نئی سیلز، منصوبہ بند وصولیاں آمد میں؛ تنخواہ، کرایہ، بلز، ٹیکس، قرض، اوسط متغیر خرچ اخراج میں — ہر مہینے زائد / کمی کے ساتھ۔ "Assumptions" میں ابتدائی کیش اور باقی اعداد مقرر کریں۔',
        },
      },
      {
        q: { en: 'Budget allotment vs Expenses access — what is the difference?', roman: 'Budget allotment aur Expenses access mein kya farq hai?', ur: 'بجٹ کی تقسیم اور اخراجات کی رسائی میں کیا فرق ہے؟' },
        a: {
          en: 'A budget (Cash Flow Manager → Budget Allotment) gives an employee a fixed amount and a "My Budget" page: only variable expenses, only up to the balance, and they see only their own entries. It ends when you close it or on its "valid until" date; the unspent cash is recorded as returned. Expenses access (Admin Settings → Users & Roles) is full module access: all employees\' expenses, and with Edit they can add and correct anyone\'s not-approved entries. It stays until admin removes it.',
          roman: 'Budget (Cash Flow Manager → Budget Allotment) employee ko fixed raqam aur "My Budget" page deta hai: sirf variable kharche, sirf balance tak, aur woh sirf apni entries dekhta hai. Budget band karne ya "valid until" date par khatam hota hai; bacha cash wapis likha jata hai. Expenses access (Admin Settings → Users & Roles) poora module access hai: tamam employees ke kharche, aur Edit ke sath kisi ki bhi not-approved entry add / theek kar sakta hai. Yeh tab tak rehta hai jab tak admin wapis na le.',
          ur: 'بجٹ ملازم کو مقررہ رقم اور "My Budget" صفحہ دیتا ہے: صرف متغیر اخراجات، صرف بیلنس تک، اور وہ صرف اپنے اندراجات دیکھتا ہے۔ اخراجات کی رسائی مکمل ماڈیول رسائی ہے جو ایڈمن کے واپس لینے تک رہتی ہے۔',
        },
      },
      {
        q: { en: 'Where did petty cash top-ups go? How do I hold a payment?', roman: 'Petty cash top-ups kahan gaye? Payment hold kaise karun?', ur: 'پیٹی کیش ٹاپ اپ کہاں گئے؟ ادائیگی کیسے روکوں؟' },
        a: {
          en: 'Top-ups are now added in Cash Flow Manager → Budget Allotment ("Petty cash top-up"), next to employee budgets, and approved there. In Payment Control filter constant (or variable) expenses by month, category, amount or search, tick rows (or use "… all filtered") and Approve, Hold (with a reason and an optional "hold until" date), Release or Reject. Held payments move to their hold date in the forecast.',
          roman: 'Top-ups ab Cash Flow Manager → Budget Allotment ("Petty cash top-up") mein add aur approve hote hain. Payment Control mein constant (ya variable) kharche month, category, amount ya search se filter karein, rows tick karein (ya "… all filtered") aur Approve, Hold (wajah aur "hold until" date), Release ya Reject karein. Hold payments forecast mein hold date par chali jati hain.',
          ur: 'ٹاپ اپ اب کیش فلو مینیجر → بجٹ کی تقسیم میں شامل اور منظور ہوتے ہیں۔ ادائیگی کنٹرول میں اخراجات فلٹر کریں، قطاریں منتخب کریں (یا "تمام فلٹر شدہ") اور منظور، روکیں، جاری یا مسترد کریں۔',
        },
      },
    ],
  },

  // ───────────────────────── 6. Salary ─────────────────────────
  {
    id: 'salary', icon: 'BadgeDollarSign',
    title: { en: 'Salary & commission', roman: 'Salary aur commission', ur: 'تنخواہ اور کمیشن' },
    items: [
      {
        q: { en: 'How is my salary calculated?', roman: 'Meri salary kaise calculate hoti hai?', ur: 'میری تنخواہ کیسے حساب ہوتی ہے؟' },
        a: {
          en: 'Net salary = base salary + commission + bonus − deductions. Commission = your commission % × your sales for the month (less refunds). Base salary and commission % are set by the Salary & Workforce in your salary terms. My Salary shows the live figures for this month and your history.',
          roman: 'Net salary = base salary + commission + bonus − deductions. Commission = aap ka commission % × is mahine ki aap ki sales (refunds minus). Base salary aur commission % Salary & Workforce aap ki salary terms mein set karta hai. My Salary mein is mahine ke live figures aur purani history hai.',
          ur: 'خالص تنخواہ = بنیادی تنخواہ + کمیشن + بونس − کٹوتیاں۔ کمیشن = آپ کا کمیشن فیصد × اس مہینے کی آپ کی سیلز (ریفنڈ منہا)۔ بنیادی تنخواہ اور کمیشن فیصد Salary & Workforce میں مقرر کیے جاتے ہیں۔ My Salary میں اس مہینے کے تازہ اعداد اور پرانی تاریخ ہے۔',
        },
      },
      {
        q: { en: 'What are Draft, In Process, Approved and Paid?', roman: 'Draft, In Process, Approved aur Paid kya hain?', ur: 'Draft، In Process، Approved اور Paid کیا ہیں؟' },
        a: {
          en: '- Draft: calculated live from sales — changes as sales come in.\n- In Process: being checked by the Salary & Workforce.\n- Approved: the amount is saved and locked, a salary slip is created and you get an email.\n- Paid: the salary has been paid (method and date are saved).\nSales added after approval do not change a locked salary unless it is re-opened.',
          roman: '- Draft: sales se live calculate hoti hai — nayi sales ke sath badalti hai.\n- In Process: Salary & Workforce check kar raha hai.\n- Approved: raqam save aur lock ho jati hai, salary slip banti hai aur aap ko email aati hai.\n- Paid: salary ada ho chuki (tareeqa aur tareekh save hoti hai).\nApproval ke baad aane wali sales locked salary ko nahi badaltin jab tak use dobara khola na jaye.',
          ur: '- Draft: سیلز سے براہِ راست حساب ہوتی ہے — نئی سیلز کے ساتھ بدلتی ہے۔\n- In Process: Salary & Workforce جانچ رہا ہے۔\n- Approved: رقم محفوظ اور لاک ہو جاتی ہے، تنخواہ کی سلپ بنتی ہے اور آپ کو ای میل آتی ہے۔\n- Paid: تنخواہ ادا ہو چکی (طریقہ اور تاریخ محفوظ ہوتی ہے)۔\nمنظوری کے بعد آنے والی سیلز لاک شدہ تنخواہ کو نہیں بدلتیں جب تک اسے دوبارہ نہ کھولا جائے۔',
        },
      },
      {
        q: { en: 'Where do I download my salary slip?', roman: 'Salary slip kahan se download karun?', ur: 'تنخواہ کی سلپ کہاں سے ڈاؤن لوڈ کروں؟' },
        a: {
          en: 'My Salary → "Download salary slip (PDF)" for this month, or the PDF button in the history table (available after the salary is approved). Reports → Me → "My salary history" gives all months as PDF / CSV.',
          roman: 'My Salary → is mahine ke liye "Download salary slip (PDF)", ya history table mein PDF button (salary approve hone ke baad milti hai). Reports → Me → "My salary history" se tamam mahine PDF / CSV mein milte hain.',
          ur: 'My Salary ← اس مہینے کے لیے "Download salary slip (PDF)"، یا ہسٹری ٹیبل میں PDF بٹن (تنخواہ منظور ہونے کے بعد ملتی ہے)۔ Reports ← Me ← "My salary history" سے تمام مہینے PDF / CSV میں ملتے ہیں۔',
        },
      },
    ],
  },

  // ───────────────────────── 7. Accounts ─────────────────────────
  {
    id: 'accounts', icon: 'Landmark',
    title: { en: 'Assets, liabilities & cash flow', roman: 'Assets, liabilities aur cash flow', ur: 'اثاثے، واجبات اور کیش فلو' },
    items: [
      {
        q: { en: 'What goes in Assets?', roman: 'Assets mein kya darj hota hai?', ur: 'اثاثوں میں کیا درج ہوتا ہے؟' },
        a: {
          en: 'Things the company owns: laptops, furniture, vehicles, equipment. Enter purchase date, cost and current value. Purchases appear as cash out in Cash Flow; the current value counts in the company\'s net worth.',
          roman: 'Company ki milkiyat wali cheezen: laptops, furniture, gaariyan, equipment. Khareed ki tareekh, qeemat aur mojooda value likhen. Khareedari Cash Flow mein cash out ki tarah aati hai; mojooda value company ki net worth mein gini jati hai.',
          ur: 'کمپنی کی ملکیت والی چیزیں: لیپ ٹاپ، فرنیچر، گاڑیاں، آلات۔ خریداری کی تاریخ، قیمت اور موجودہ مالیت لکھیں۔ خریداری کیش فلو میں کیش آؤٹ کے طور پر آتی ہے؛ موجودہ مالیت کمپنی کی خالص مالیت میں شمار ہوتی ہے۔',
        },
      },
      {
        q: { en: 'How do I add a loan and its repayments?', roman: 'Loan aur us ki wapsi kaise darj karun?', ur: 'قرض اور اس کی واپسی کیسے درج کروں؟' },
        a: {
          en: 'Liabilities → "Add liability / loan": lender, principal, start date, interest (none / flat / reducing) and monthly installment. Then record each repayment. The page shows outstanding balance, next due date and interest paid.',
          roman: 'Liabilities → "Add liability / loan": qarz dene wala, asal raqam, shuru ki tareekh, sood (none / flat / reducing) aur mahana qist. Phir har wapsi darj karen. Page baqi raqam, agli due date aur ada shuda sood dikhata hai.',
          ur: 'Liabilities ← "Add liability / loan": قرض دینے والا، اصل رقم، آغاز کی تاریخ، سود (none / flat / reducing) اور ماہانہ قسط۔ پھر ہر واپسی درج کریں۔ صفحہ بقایا رقم، اگلی تاریخ اور ادا شدہ سود دکھاتا ہے۔',
        },
      },
      {
        q: { en: 'What does the Cash Flow Manager show?', roman: 'Cash Flow Manager kya dikhata hai?', ur: 'کیش فلو مینیجر کیا دکھاتا ہے؟' },
        a: {
          en: 'For any date range: net revenue, total expenses, net profit / loss and margin, cash in and cash out by type, a 12-month chart, and the company position (assets, liabilities, capital, net worth). Owner investment and drawings are entered under Capital.',
          roman: 'Kisi bhi date range ke liye: net revenue, kul kharche, net munafa / nuqsan aur margin, qisam ke hisab se cash in aur cash out, 12 mahine ka chart, aur company ki position (assets, liabilities, capital, net worth). Malik ki investment aur drawings Capital mein darj hoti hain.',
          ur: 'کسی بھی تاریخ کی حد کے لیے: خالص ریونیو، کل اخراجات، خالص منافع / نقصان اور مارجن، قسم کے حساب سے آمدِ نقد اور اخراجِ نقد، 12 مہینوں کا چارٹ، اور کمپنی کی پوزیشن (اثاثے، واجبات، سرمایہ، خالص مالیت)۔ مالک کی سرمایہ کاری اور نکاسی Capital میں درج ہوتی ہے۔',
        },
      },
    ],
  },

  // ───────────────────────── 8. Reports ─────────────────────────
  {
    id: 'reports', icon: 'BarChart3',
    title: { en: 'Reports & exports', roman: 'Reports aur exports', ur: 'رپورٹس اور ایکسپورٹ' },
    items: [
      {
        q: { en: 'How do I download a report?', roman: 'Report kaise download karun?', ur: 'رپورٹ کیسے ڈاؤن لوڈ کروں؟' },
        a: {
          en: 'Open Reports in the sidebar, choose the date range and tap PDF or CSV next to any report. Most pages also have PDF / CSV buttons that use the filters you have applied. PDFs use the ScholarshipHive branded layout with totals; CSV opens in Excel or Google Sheets.',
          roman: 'Sidebar mein Reports kholen, date range chunen aur kisi bhi report ke sath PDF ya CSV dabayen. Aksar pages par bhi PDF / CSV buttons hain jo aap ke lagaye filters ke mutabiq file banate hain. PDF ScholarshipHive ke branded design mein totals ke sath hoti hai; CSV Excel ya Google Sheets mein khulti hai.',
          ur: 'سائیڈ بار میں Reports کھولیں، تاریخ کی حد منتخب کریں اور کسی بھی رپورٹ کے ساتھ PDF یا CSV دبائیں۔ اکثر صفحات پر بھی PDF / CSV بٹن ہیں جو آپ کے لگائے گئے فلٹرز کے مطابق فائل بناتے ہیں۔ PDF اسکالرشپ ہائیو کے برانڈڈ ڈیزائن میں مجموعوں کے ساتھ ہوتی ہے؛ CSV ایکسل یا گوگل شیٹس میں کھلتی ہے۔',
        },
      },
      {
        q: { en: 'The PDF says "first 3,000 rows". Why?', roman: 'PDF mein "first 3,000 rows" kyun likha hai?', ur: 'PDF میں "first 3,000 rows" کیوں لکھا ہے؟' },
        a: {
          en: 'Very large PDFs are slow and can fail on a phone, so a PDF holds at most 3,000 rows. Use a smaller date range or filters, or download CSV — CSV has every row.',
          roman: 'Bohat bari PDF slow hoti hai aur mobile par fail ho sakti hai, is liye aik PDF mein zyada se zyada 3,000 rows hoti hain. Chhoti date range ya filters lagayen, ya CSV download karen — CSV mein har row hoti hai.',
          ur: 'بہت بڑی PDF سست ہوتی ہے اور موبائل پر ناکام ہو سکتی ہے، اس لیے ایک PDF میں زیادہ سے زیادہ 3,000 قطاریں ہوتی ہیں۔ چھوٹی تاریخ کی حد یا فلٹر لگائیں، یا CSV ڈاؤن لوڈ کریں — CSV میں ہر قطار ہوتی ہے۔',
        },
      },
    ],
  },

  // ───────────────────────── 9. Users & access ─────────────────────────
  {
    id: 'access', icon: 'ShieldCheck',
    title: { en: 'Users, access & admin', roman: 'Users, access aur admin', ur: 'صارفین، رسائی اور ایڈمن' },
    items: [
      {
        q: { en: 'A page says "You don\'t have access". How do I get it?', roman: 'Page par "You don\'t have access" aa raha hai, access kaise milega?', ur: 'صفحے پر "You don\'t have access" آ رہا ہے، رسائی کیسے ملے گی؟' },
        a: {
          en: 'Tap "Request access" on that page, choose View or View + Edit and add a short message. Admins get the request in Admin Settings → Requests and you get an email when it is approved or declined. You can follow your requests in My Settings → Requests.',
          roman: 'Usi page par "Request access" dabayen, View ya View + Edit chunen aur chhota sa message likhen. Admin ko request Admin Settings → Requests mein milti hai aur approve ya decline hone par aap ko email aati hai. Apni requests My Settings → Requests mein dekh sakte hain.',
          ur: 'اسی صفحے پر "Request access" دبائیں، View یا View + Edit منتخب کریں اور مختصر پیغام لکھیں۔ ایڈمن کو درخواست Admin Settings ← Requests میں ملتی ہے اور منظور یا مسترد ہونے پر آپ کو ای میل آتی ہے۔ اپنی درخواستیں My Settings ← Requests میں دیکھ سکتے ہیں۔',
        },
      },
      {
        q: { en: 'How does an admin approve a new employee and give access?', roman: 'Admin naye employee ko kaise approve kare aur access de?', ur: 'ایڈمن نئے ملازم کو کیسے منظور کرے اور رسائی دے؟' },
        a: {
          en: 'Admin Settings → Users → filter "Pending" → open the person. Check details and documents, then "Approve". Under Page access tick each module with View or Edit (Revenue, Expenses, Petty Cash, Expense Approvals, Salary & Workforce, Assets, Liabilities, Cash Flow, Announcements, User Management). Changes apply immediately. The list is paged on the server so it stays fast with many employees.',
          roman: 'Admin Settings → Users → "Pending" filter → bande ki profile kholen. Details aur documents check karke "Approve" karen. Page access mein har module ke liye View ya Edit tick karen (Revenue, Expenses, Petty Cash, Expense Approvals, Salary & Workforce, Assets, Liabilities, Cash Flow, Announcements, User Management). Tabdeeli foran lagu hoti hai. List server par pages mein aati hai is liye zyada employees ke sath bhi tez rehti hai.',
          ur: 'Admin Settings ← Users ← "Pending" فلٹر ← متعلقہ شخص کی پروفائل کھولیں۔ تفصیلات اور دستاویزات چیک کر کے "Approve" کریں۔ Page access میں ہر ماڈیول کے لیے View یا Edit منتخب کریں (Revenue، Expenses، Petty Cash، Expense Approvals، Salary & Workforce، Assets، Liabilities، Cash Flow، Announcements، User Management)۔ تبدیلی فوراً لاگو ہوتی ہے۔ فہرست سرور پر صفحوں میں آتی ہے اس لیے زیادہ ملازمین کے ساتھ بھی تیز رہتی ہے۔',
        },
      },
      {
        q: { en: 'How many admins can there be?', roman: 'Kitne admin ho sakte hain?', ur: 'کتنے ایڈمن ہو سکتے ہیں؟' },
        a: {
          en: 'At most three, including the Super Admin (the first account created on /setup). Only the Super Admin can add or remove admins (Admin Settings → Admins). Admins see everything; employees only see what they are given.',
          roman: 'Zyada se zyada teen, Super Admin samet (jo /setup par sab se pehla account bana). Sirf Super Admin admin add ya remove kar sakta hai (Admin Settings → Admins). Admin sab kuch dekhte hain; employees sirf wohi jo unhen diya jaye.',
          ur: 'زیادہ سے زیادہ تین، سپر ایڈمن سمیت (جو /setup پر سب سے پہلا اکاؤنٹ بنا)۔ صرف سپر ایڈمن ایڈمن شامل یا ختم کر سکتا ہے (Admin Settings ← Admins)۔ ایڈمن سب کچھ دیکھتے ہیں؛ ملازمین صرف وہی جو انہیں دیا جائے۔',
        },
      },
      {
        q: { en: 'Where can I see who changed what?', roman: 'Kis ne kya badla, ye kahan dekhun?', ur: 'کس نے کیا بدلا، یہ کہاں دیکھوں؟' },
        a: {
          en: 'Every sale, expense and petty cash record has a History section. Admins see the full Activity log in Admin Settings → Activity (time, user, action, IP) and can download it from Reports → Admin.',
          roman: 'Har sale, expense aur petty cash record mein History section hai. Admin poora Activity log Admin Settings → Activity mein dekhte hain (waqt, user, kaam, IP) aur Reports → Admin se download kar sakte hain.',
          ur: 'ہر سیل، خرچ اور پیٹی کیش ریکارڈ میں History کا حصہ ہے۔ ایڈمن مکمل ایکٹیویٹی لاگ Admin Settings ← Activity میں دیکھتے ہیں (وقت، صارف، عمل، IP) اور Reports ← Admin سے ڈاؤن لوڈ کر سکتے ہیں۔',
        },
      },
    ],
  },

  // ───────────────────────── 10. Security & privacy ─────────────────────────
  {
    id: 'security', icon: 'Lock',
    title: { en: 'Security & privacy', roman: 'Security aur privacy', ur: 'حفاظت اور رازداری' },
    items: [
      {
        q: { en: 'How is my data protected?', roman: 'Mera data kaise mehfooz hai?', ur: 'میرا ڈیٹا کیسے محفوظ ہے؟' },
        a: {
          en: '- Passwords are stored only as a secure hash — nobody can read them.\n- Login uses secure cookies, automatic logout after inactivity and limits on repeated wrong tries.\n- Every page and every API checks your access on the server.\n- Uploaded files are checked by type and size and are only shown to people allowed to see them.\n- The database is hosted on Neon (PostgreSQL) with encrypted connections.\nRead the full Privacy Policy from the shield icon.',
          roman: '- Password sirf mehfooz hash ki shakal mein save hota hai — koi parh nahi sakta.\n- Login mein secure cookies, ghair-faal hone par khud logout aur bar bar ghalat koshish par pabandi hai.\n- Har page aur har API server par aap ka access check karti hai.\n- Upload files ki type aur size check hoti hai aur sirf ijazat walon ko dikhti hain.\n- Database Neon (PostgreSQL) par encrypted connection ke sath hai.\nPoori Privacy Policy shield icon se parhen.',
          ur: '- پاس ورڈ صرف محفوظ ہیش کی صورت میں رکھا جاتا ہے — کوئی اسے پڑھ نہیں سکتا۔\n- لاگ اِن میں محفوظ کوکیز، غیر فعالی پر خودکار لاگ آؤٹ اور بار بار غلط کوشش پر پابندی ہے۔\n- ہر صفحہ اور ہر API سرور پر آپ کی رسائی چیک کرتی ہے۔\n- اپ لوڈ فائلوں کی قسم اور سائز چیک ہوتا ہے اور صرف اجازت والوں کو نظر آتی ہیں۔\n- ڈیٹا بیس Neon (PostgreSQL) پر انکرپٹڈ کنکشن کے ساتھ ہے۔\nمکمل پرائیویسی پالیسی شیلڈ آئیکن سے پڑھیں۔',
        },
      },
      {
        q: { en: 'How do I change my password or log out of other devices?', roman: 'Password kaise badlun ya doosre devices se logout karun?', ur: 'پاس ورڈ کیسے بدلوں یا دوسرے آلات سے لاگ آؤٹ کروں؟' },
        a: {
          en: 'My Settings → Security: change your password (you need the current one) — other devices are logged out automatically.',
          roman: 'My Settings → Security: password badlen (mojooda password chahiye) — doosre devices khud logout ho jate hain.',
          ur: 'My Settings ← Security: پاس ورڈ تبدیل کریں (موجودہ پاس ورڈ درکار ہے) — دوسرے آلات خود لاگ آؤٹ ہو جاتے ہیں۔',
        },
      },
    ],
  },

  // ───────────────────────── 11. Troubleshooting ─────────────────────────
  {
    id: 'problems', icon: 'Wrench',
    title: { en: 'Problems & fixes', roman: 'Masail aur un ka hal', ur: 'مسائل اور ان کا حل' },
    items: [
      {
        q: { en: '"Cannot reach the server" or the page keeps loading', roman: '"Cannot reach the server" ya page load hi hota rehta hai', ur: '"Cannot reach the server" یا صفحہ لوڈ ہی ہوتا رہتا ہے' },
        a: {
          en: '- Check your internet (open any other website).\n- The free database sleeps when nobody uses it; the first request can take a few seconds. Wait 10 seconds and tap Refresh.\n- If it still fails, tell an admin — they can check https://<your-site>/api/health which shows whether the database is connected.',
          roman: '- Internet check karen (koi aur website khol kar dekhen).\n- Free database istemal na hone par so jata hai; pehli request mein kuch second lag sakte hain. 10 second ruk kar Refresh dabayen.\n- Phir bhi masla ho to admin ko batayen — woh https://<your-site>/api/health khol kar dekh sakte hain ke database connected hai ya nahi.',
          ur: '- انٹرنیٹ چیک کریں (کوئی اور ویب سائٹ کھول کر دیکھیں)۔\n- مفت ڈیٹا بیس استعمال نہ ہونے پر سو جاتا ہے؛ پہلی درخواست میں چند سیکنڈ لگ سکتے ہیں۔ 10 سیکنڈ رک کر Refresh دبائیں۔\n- پھر بھی مسئلہ ہو تو ایڈمن کو بتائیں — وہ https://<your-site>/api/health کھول کر دیکھ سکتے ہیں کہ ڈیٹا بیس منسلک ہے یا نہیں۔',
        },
      },
      {
        q: { en: '"Something went wrong on this page"', roman: '"Something went wrong on this page" aa gaya', ur: '"Something went wrong on this page" آ گیا' },
        a: {
          en: 'Only that page stopped — the rest of the app keeps working and nothing saved is lost. Tap "Reload page" or "Go to dashboard". The error is recorded in the server log automatically. If it happens every time, tell an admin what you clicked.',
          roman: 'Sirf woh page ruka hai — baqi app chalti rehti hai aur save shuda kuch zaya nahi hota. "Reload page" ya "Go to dashboard" dabayen. Error khud server log mein record ho jata hai. Agar har dafa ho to admin ko batayen ke aap ne kya dabaya tha.',
          ur: 'صرف وہ صفحہ رکا ہے — باقی ایپ چلتی رہتی ہے اور محفوظ شدہ کچھ ضائع نہیں ہوتا۔ "Reload page" یا "Go to dashboard" دبائیں۔ خرابی خود سرور لاگ میں درج ہو جاتی ہے۔ اگر ہر بار ہو تو ایڈمن کو بتائیں کہ آپ نے کیا دبایا تھا۔',
        },
      },
      {
        q: { en: '"Upload is too large" or a file does not upload', roman: '"Upload is too large" ya file upload nahi ho rahi', ur: '"Upload is too large" یا فائل اپ لوڈ نہیں ہو رہی' },
        a: {
          en: 'Each file can be up to 3 MB (photos are shrunk automatically). Allowed: PDF, JPG, PNG, WEBP, DOCX. For a large PDF, scan at lower quality or split it. Upload documents one at a time on slow mobile data.',
          roman: 'Har file 3 MB tak ho sakti hai (photos khud chhoti ho jati hain). Ijazat: PDF, JPG, PNG, WEBP, DOCX. Bari PDF ko kam quality mein scan karen ya tor len. Slow mobile data par aik aik document upload karen.',
          ur: 'ہر فائل 3 MB تک ہو سکتی ہے (تصاویر خود چھوٹی ہو جاتی ہیں)۔ اجازت: PDF، JPG، PNG، WEBP، DOCX۔ بڑی PDF کو کم کوالٹی میں اسکین کریں یا تقسیم کریں۔ سست موبائل ڈیٹا پر ایک ایک دستاویز اپ لوڈ کریں۔',
        },
      },
      {
        q: { en: 'The reset / approval email did not arrive', roman: 'Reset / approval wali email nahi aayi', ur: 'ری سیٹ / منظوری والی ای میل نہیں آئی' },
        a: {
          en: 'Check Spam, Promotions and Updates folders and search for "ScholarshipHive". Emails can take a few minutes. If emails never arrive, the admin should check Admin Settings → Email (SMTP) and send a test email. An admin can also create a reset link for you directly.',
          roman: 'Spam, Promotions aur Updates folders check karen aur "ScholarshipHive" search karen. Email aane mein kuch minute lag sakte hain. Agar email kabhi na aaye to admin Admin Settings → Email (SMTP) check karke test email bheje. Admin aap ke liye seedha reset link bhi bana sakta hai.',
          ur: 'اسپیم، پروموشنز اور اپ ڈیٹس فولڈر چیک کریں اور "ScholarshipHive" تلاش کریں۔ ای میل آنے میں چند منٹ لگ سکتے ہیں۔ اگر ای میل کبھی نہ آئے تو ایڈمن Admin Settings ← Email (SMTP) چیک کر کے ٹیسٹ ای میل بھیجے۔ ایڈمن آپ کے لیے براہِ راست ری سیٹ لنک بھی بنا سکتا ہے۔',
        },
      },
      {
        q: { en: 'Payment alarms / reminders are not coming', roman: 'Payment alarm / reminders nahi aa rahe', ur: 'ادائیگی کے الارم / یاد دہانیاں نہیں آ رہیں' },
        a: {
          en: 'Reminders are checked once a day (and when someone opens the app). Check the sale has a payment plan with a future due date and that the alarm days are set. Email reminders also need working SMTP. Admins can run the check now from Admin Settings → Email → "Run daily reminders now".',
          roman: 'Reminders din mein aik dafa check hote hain (aur jab koi app kholta hai). Check karen ke sale ka payment plan hai, us mein aage ki due date hai aur alarm ke din set hain. Email reminders ke liye SMTP chalna zaroori hai. Admin Admin Settings → Email → "Run daily reminders now" se abhi check chala sakte hain.',
          ur: 'یاد دہانیاں دن میں ایک بار چیک ہوتی ہیں (اور جب کوئی ایپ کھولتا ہے)۔ چیک کریں کہ سیل کا اقساط کا منصوبہ ہے، اس میں آئندہ تاریخ ہے اور الارم کے دن مقرر ہیں۔ ای میل یاد دہانی کے لیے SMTP کا چلنا ضروری ہے۔ ایڈمن Admin Settings ← Email ← "Run daily reminders now" سے ابھی چیک چلا سکتے ہیں۔',
        },
      },
      {
        q: { en: 'Numbers look different from what I expected', roman: 'Numbers meri tawaqqo se mukhtalif hain', ur: 'اعداد میری توقع سے مختلف ہیں' },
        a: {
          en: '- Check the date range at the top (This month vs All time).\n- Check filters chips — a status or staff filter may be on.\n- Only approved expenses count in totals.\n- Revenue "collected" counts money received in the period; "sales booked" counts deal value by sale date.',
          roman: '- Upar date range check karen (This month ya All time).\n- Filter chips dekhen — koi status ya staff filter laga ho sakta hai.\n- Totals mein sirf approved expenses gine jate hain.\n- Revenue "collected" us muddat mein wasool shuda raqam hai; "sales booked" sale ki tareekh ke hisab se deal ki value hai.',
          ur: '- اوپر تاریخ کی حد چیک کریں (This month یا All time)۔\n- فلٹر چِپس دیکھیں — کوئی اسٹیٹس یا اسٹاف فلٹر لگا ہو سکتا ہے۔\n- مجموعوں میں صرف منظور شدہ اخراجات شمار ہوتے ہیں۔\n- ریونیو "collected" اس مدت میں وصول شدہ رقم ہے؛ "sales booked" سیل کی تاریخ کے حساب سے ڈیل کی مالیت ہے۔',
        },
      },
    ],
  },
];
