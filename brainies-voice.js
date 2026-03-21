/**
 * BRAINIES VOICE ENGINE
 * One file used by all pages.
 * Auto-starts on home page so blind users hear the app immediately.
 */
(function () {
  'use strict';

  const LANG = 'en-IN';

  /* ── SPEAK (queued so messages never overlap) ─────────────────── */
  let queue = [], busy = false;

  function speak(text, cb) {
    if (!('speechSynthesis' in window)) { if (cb) cb(); return; }
    queue.push({ text, cb });
    if (!busy) _drain();
  }

  function _drain() {
    if (!queue.length) { busy = false; return; }
    busy = true;
    const { text, cb } = queue.shift();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG; u.rate = 0.9; u.volume = 1;
    u.onend = u.onerror = () => { busy = false; if (cb) cb(); _drain(); };
    window.speechSynthesis.speak(u);
    // Update deaf caption on every page
    _caption(text);
  }

  function stopSpeaking() {
    queue = []; busy = false;
    window.speechSynthesis.cancel();
  }

  function _caption(text) {
    // Try both IDs used across pages
    const el = document.getElementById('caption-text') ||
               document.getElementById('cap-txt');
    if (el) el.textContent = text;
  }

  /* ── MIC ─────────────────────────────────────────────────────── */
  let recog = null, active = false, restartTimer = null;

  function startListening() {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) return;
    if (active) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recog = new SR();
    recog.lang = LANG;
    recog.continuous = true;
    recog.interimResults = false;
    recog.maxAlternatives = 3;

    recog.onstart  = () => { active = true;  _micUI(true);  };
    recog.onend    = () => { active = false; _micUI(false); _restart(800); };
    recog.onerror  = (e) => {
      active = false; _micUI(false);
      if (e.error === 'not-allowed') {
        speak('Microphone blocked. Please allow microphone in browser settings.');
        return;
      }
      _restart(e.error === 'no-speech' ? 1500 : 2000);
    };
    recog.onresult = (e) => {
      const parts = [];
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) parts.push(e.results[i][0].transcript);
      }
      const txt = parts.join(' ').toLowerCase().trim();
      if (txt) _handleCmd(txt);
    };
    try { recog.start(); } catch (e) { _restart(2000); }
  }

  function stopListening() {
    clearTimeout(restartTimer); active = false;
    if (recog) { try { recog.stop(); } catch (e) {} }
    _micUI(false);
  }

  function _restart(ms) {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => { if (!busy) startListening(); }, ms);
  }

  /* ── MIC INDICATOR ───────────────────────────────────────────── */
  function _micUI(on) {
    let btn = document.getElementById('bv-mic');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'bv-mic';
      btn.setAttribute('aria-label', 'Voice navigation');
      btn.style.cssText =
        'position:fixed;bottom:1.25rem;right:1.25rem;width:46px;height:46px;' +
        'border-radius:50%;border:none;font-size:1.2rem;cursor:pointer;z-index:9999;' +
        'display:flex;align-items:center;justify-content:center;transition:all .2s;';
      btn.title = 'Voice — click to toggle';
      btn.onclick = () => {
        if (active) { stopListening(); speak('Voice off.'); }
        else { speak('Voice on.'); startListening(); }
      };
      document.body.appendChild(btn);
    }
    btn.textContent      = on ? '🎙️' : '🎤';
    btn.style.background = on ? '#4ade80' : '#252525';
    btn.style.color      = on ? '#000' : '#888';
    btn.style.boxShadow  = on ? '0 0 0 4px rgba(74,222,128,.3)' : 'none';
  }

  /* ── PAGE DETECTION ──────────────────────────────────────────── */
  function _page() {
    const p = window.location.pathname.toLowerCase();
    if (p.includes('lesson'))    return 'lesson';
    if (p.includes('dashboard')) return 'dashboard';
    return 'home';
  }

  function _match(text, phrases) {
    return phrases.some(p => text.includes(p));
  }

  /* ── COMMAND ROUTER ──────────────────────────────────────────── */
  function _handleCmd(text) {
    const pg = _page();

    /* GLOBAL — work on every page */
    if (_match(text, ['stop','quiet','stop talking']))          { stopSpeaking(); return; }
    if (_match(text, ['go home','open home','main page']))       { speak('Going home.',       () => { window.location.href = 'index.html'; }); return; }
    if (_match(text, ['open lessons','go to lessons','lessons'])){ speak('Opening lessons.',  () => { window.location.href = 'lesson.html'; }); return; }
    if (_match(text, ['open dashboard','teacher','dashboard']))  { speak('Opening dashboard.',() => { window.location.href = 'dashboard.html'; }); return; }
    if (_match(text, ['help','what can i say','commands']))      { _speakHelp(); return; }
    if (_match(text, ['increase text','bigger text','larger']))  { _changeFont(2);  speak('Text size increased.'); return; }
    if (_match(text, ['decrease text','smaller text','smaller'])){ _changeFont(-2); speak('Text size decreased.'); return; }

    /* PAGE-SPECIFIC */
    if (pg === 'home')      _homeCmd(text);
    else if (pg === 'lesson')    _lessonCmd(text);
    else if (pg === 'dashboard') _dashCmd(text);
  }

  /* ── HOME COMMANDS ───────────────────────────────────────────── */
  const PROFILES = {
    blind:    ['blind','visually impaired','cannot see','low vision'],
    dyslexic: ['dyslexic','dyslexia','reading difficulty','reading'],
    adhd:     ['adhd','a d h d','attention','hyperactive','focus'],
    deaf:     ['deaf','hearing','cannot hear','hard of hearing'],
    motor:    ['motor','physical','cannot use hands'],
    standard: ['standard','normal','none','skip']
  };

  function _homeCmd(text) {
    for (const [p, words] of Object.entries(PROFILES)) {
      if (words.some(w => text.includes(w))) {
        // Use the page's setProfile function (exposed via window.setProfile)
        if (window.setProfile) {
          const card = document.querySelector(`.pcard[data-mode="${p}"]`);
          if (card) window.setProfile(p, card);
        }
        speak(p + ' profile activated.');
        return;
      }
    }
    // Tab switching on home page
    if (_match(text, ['simplify','simplify text']))   { _switchTab('simplify');   return; }
    if (_match(text, ['translate','translation']))     { _switchTab('translate');  return; }
    if (_match(text, ['voice demo','voice tab']))      { _switchTab('voice');      return; }
    if (_match(text, ['ocr','scanner','scan']))        { _switchTab('ocr');        return; }
    if (_match(text, ['timer','focus timer']))         { _switchTab('timer');      return; }
    speak('Say a profile name: blind, dyslexic, ADHD, deaf, motor, or standard.');
  }

  function _switchTab(name) {
    // Works even when called from voice engine context
    const panels = document.querySelectorAll('.panel');
    const tabs   = document.querySelectorAll('.tab');
    if (!panels.length) return;
    panels.forEach(p => p.classList.remove('active'));
    tabs.forEach(b => b.classList.remove('active'));
    const p = document.getElementById('panel-' + name);
    const t = document.querySelector(`.tab[data-tab="${name}"]`);
    if (p) p.classList.add('active');
    if (t) t.classList.add('active');
    speak(name + ' tab opened.');
  }

  /* ── LESSON COMMANDS ─────────────────────────────────────────── */
  function _lessonCmd(text) {
    if (_match(text, ['next','next lesson','continue']))               { speak('Next lesson.',    () => window.nextLesson     && window.nextLesson()); return; }
    if (_match(text, ['previous','go back','prev lesson','back']))     { speak('Previous.',       () => window.prevLesson     && window.prevLesson()); return; }
    if (_match(text, ['read','read lesson','read this','read aloud'])) { const c=document.getElementById('lesson-content'); if(c)speak(c.innerText.substring(0,1400)); return; }
    if (_match(text, ['simplify','simplify lesson','make it simple'])) { speak('Simplifying.',   () => window.simplifyLesson && window.simplifyLesson()); return; }
    if (_match(text, ['translate hindi','in hindi','hindi']))          { speak('Hindi.',          () => window.translateLesson && window.translateLesson('hi')); return; }
    if (_match(text, ['translate marathi','marathi']))                 { speak('Marathi.',        () => window.translateLesson && window.translateLesson('mr')); return; }
    if (_match(text, ['translate tamil','tamil']))                     { speak('Tamil.',          () => window.translateLesson && window.translateLesson('ta')); return; }
    if (_match(text, ['quiz','start quiz','go to quiz']))              {
      const q = document.querySelector('.quiz-box');
      if (q) { q.scrollIntoView({ behavior: 'smooth' }); const qq = document.querySelector('.quiz-q'); speak('Quiz. ' + (qq ? qq.textContent : '')); }
      return;
    }
    if (_match(text, ['read options','what are the options','list options'])) {
      const opts = document.querySelectorAll('.qopt');
      if (opts.length) { let m = 'The options are: '; opts.forEach((o,i) => { m += (i+1) + ': ' + o.textContent.trim() + '. '; }); speak(m); }
      return;
    }
    // Option selection: "option 1", "answer two", "choice 3"
    const nm = text.match(/(?:option|answer|choice)\s*([1-4]|one|two|three|four)/);
    if (nm) {
      const map = { one:0,two:1,three:2,four:3,'1':0,'2':1,'3':2,'4':3 };
      const idx = map[nm[1]];
      if (idx !== undefined) {
        const btn = document.querySelectorAll('.qopt')[idx];
        if (btn && !btn.disabled) btn.click();
        else if (btn && btn.disabled) speak('Already answered. Go to next lesson or retry.');
      }
      return;
    }
    if (_match(text, ['complete','finish','done','mark done'])) { if(window.nextLesson) window.nextLesson(); return; }
    if (_match(text, ['which lesson','current lesson','what lesson'])) {
      const h = document.querySelector('.lesson-title'); speak(h ? 'You are on: ' + h.textContent : 'Lesson page.'); return;
    }
    speak('Say: read lesson, next, previous, quiz, simplify, or option 1 to 4.');
  }

  /* ── DASHBOARD COMMANDS ──────────────────────────────────────── */
  function _dashCmd(text) {
    if (_match(text, ['total students','how many students'])) { const e=document.getElementById('s-total');  speak(e?e.textContent+' students total.':'Not available.'); return; }
    if (_match(text, ['average progress','avg progress']))    { const e=document.getElementById('s-avg');    speak(e?'Average progress is '+e.textContent:'Not available.'); return; }
    if (_match(text, ['need help','need attention']))         { const e=document.getElementById('s-alerts'); speak(e?e.textContent+' students need attention.':'Not available.'); return; }
    if (_match(text, ['export','download','csv']))            { speak('Exporting CSV.',  () => window.exportCSV  && window.exportCSV()); return; }
    if (_match(text, ['refresh','reload','update']))          { speak('Refreshing.',     () => window.fetchData  && window.fetchData()); return; }
    if (_match(text, ['send alert','notify','parents']))      { speak('Sending alerts.', () => window.sendAlerts && window.sendAlerts()); return; }
    speak('Say: total students, average progress, need help, export, or refresh.');
  }

  /* ── HELP ────────────────────────────────────────────────────── */
  function _speakHelp() {
    const pg = _page();
    const global = 'Global commands: go home, open lessons, open dashboard, increase text, decrease text, stop, help. ';
    const home   = 'On home page: say your profile name — blind, dyslexic, ADHD, deaf, motor, or standard. ';
    const lesson = 'On lesson page: read lesson, next lesson, previous lesson, simplify, translate Hindi, quiz, option 1 to 4, complete. ';
    const dash   = 'On dashboard: total students, average progress, need help, export, refresh, send alerts. ';
    speak(global + (pg==='home' ? home : pg==='lesson' ? lesson : dash));
  }

  /* ── FONT SIZE ───────────────────────────────────────────────── */
  function _changeFont(delta) {
    const root = document.documentElement;
    const cur  = parseInt(getComputedStyle(root).fontSize) || 16;
    root.style.fontSize = Math.max(12, Math.min(26, cur + delta)) + 'px';
  }

  /* ── PAGE INTRO ──────────────────────────────────────────────── */
  function _intro() {
    const pg   = _page();
    const prof = localStorage.getItem('brainies_profile');
    const name = localStorage.getItem('brainies_name') || '';

    if (pg === 'home') {
      if (!prof) {
        speak(
          'Welcome to Brainies. Standard profile is selected. ' +
          'Say your condition to change it: blind, dyslexic, ADHD, deaf, or motor. I am listening.',
          startListening
        );
      } else {
        speak(
          (name ? 'Welcome back ' + name + '. ' : 'Welcome back. ') +
          'Your profile is ' + prof + '. Say open lessons to start, or say help for all commands.',
          startListening
        );
      }
    } else if (pg === 'lesson') {
      const h = document.querySelector('.lesson-title');
      speak(
        'Lesson page. ' + (h ? h.textContent.trim() : '') +
        '. Say read lesson to hear content, quiz for the quiz, or help for all commands.',
        startListening
      );
    } else if (pg === 'dashboard') {
      speak('Teacher dashboard. Say total students, refresh, or help.', startListening);
    }
  }

  /* ── BOOT ────────────────────────────────────────────────────── */
  function _boot() {
    const pg   = _page();
    const prof = localStorage.getItem('brainies_profile');

    // Alt+V toggles voice for all users
    document.addEventListener('keydown', e => {
      if (e.altKey && e.key === 'v') {
        if (active) { stopListening(); speak('Voice off.'); }
        else { speak('Voice on.'); startListening(); }
      }
      if (e.key === 'Escape') stopSpeaking();
    });

    // Auto-start: always on home page, or if profile is blind
    const shouldAutoStart = (pg === 'home') || (prof === 'blind');
    if (!shouldAutoStart) return;

    // Apply blind body class if needed
    if (prof === 'blind') {
      document.body.classList.add('mode-blind');
    }

    if (document.readyState === 'complete') {
      setTimeout(_intro, 700);
    } else {
      window.addEventListener('load', () => setTimeout(_intro, 700));
    }
  }

  /* ── PUBLIC API ──────────────────────────────────────────────── */
  window.BV = { speak, stopSpeaking, startListening, stopListening };

  _boot();
})();
