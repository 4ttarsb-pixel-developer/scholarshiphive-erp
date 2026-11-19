// Applies the saved theme before React loads, so the page never flashes the wrong colours.
(function () {
  try {
    var t = localStorage.getItem('sh_theme');
    var f = localStorage.getItem('sh_font');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    if (f) document.documentElement.setAttribute('data-font', f);
    var l = localStorage.getItem('sh_lang');
    if (l === 'ur' || l === 'roman') {
      document.documentElement.setAttribute('data-lang', l);
      if (l === 'ur') { document.documentElement.setAttribute('dir', 'rtl'); document.documentElement.setAttribute('lang', 'ur'); }
    }
  } catch (e) { /* storage blocked */ }
})();
