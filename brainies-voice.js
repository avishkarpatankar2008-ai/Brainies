/**
 * BRAINIES VOICE ENGINE v2
 * ─────────────────────────────────────────────────────────────
 * KEY FEATURE: Always-On Voice for Blind Users
 * — Voice never turns off
 * — Auto-restarts after every utterance ends
 * — Works on ALL pages (welcome, home, lesson, dashboard)
 * — Blind users can control everything by voice alone
 * ─────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  const LANG = 'en-IN';

  /* ═══════════════════════════════════════════════
     SPEECH SYNTHESIS — queued, never overlaps
  ═══════════════════════════════════════════════ */
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
    u.lang = LANG; u.rate = 0.88; u.volume = 1;
    u.onend = u.onerror = () => {
      busy = false;
      if (cb) cb();
      _drain();
    };
    window.speechSynthesis.speak(u);
    _caption(text);
  }

  function stopSpeaking() {
    queue = []; busy = false;
    window.speechSynthesis.cancel();
  }

  function _caption(text) {
    const el = document.getElementById('caption-text') || document.getElementById('cap-txt');
    if (el) el.textContent = text;
  }

  /* ═══════════════════════════════════════════════
     ALWAYS-ON MICROPHONE ENGINE
     — For blind users: restarts automatically
     — For others: starts on demand, stops on demand
  ═══════════════════════════════════════════════ */
  let recog = null, active = false, restartTimer = null;

  // alwaysOn = true means mic restarts itself forever (blind mode)
  const alwaysOn = () => localStorage.getItem('brainies_always_voice') === '1'
                      || localStorage.getItem('brainies_profile') === 'blind';

  function startListening() {
    if (active) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    recog = new SR();
    recog.lang = LANG;
    recog.continuous = true;
    recog.interimResults = false;
    recog.maxAlternatives = 3;

    recog.onstart = () => {
      active = true;
      _micUI(true);
      // Update always-on bar if present
      const bar = document.getElementById('voice-bar');
      if (bar && alwaysOn()) bar.className = 'voice-bar show';
    };

    recog.onend = () => {
      active = false;
      _micUI(false);
      // KEY: auto-restart for blind users — never stops
      if (alwaysOn()) _scheduleRestart(600);
    };

    recog.onerror = (e) => {
      active = false;
      _micUI(false);
      if (e.error === 'not-allowed') {
        speak('Microphone blocked. Please allow microphone access in browser settings.');
        return;
      }
      if (alwaysOn()) _scheduleRestart(e.error === 'no-speech' ? 1000 : 2000);
    };

    recog.onresult = (e) => {
      const parts = [];
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) parts.push(e.results[i][0].transcript);
      }
      const txt = parts.join(' ').toLowerCase().trim();
      if (txt) {
        // Show what was heard in UI
        const heard = document.getElementById('vb-heard');
        if (heard) heard.textContent = txt;
        _handleCmd(txt);
      }
    };

    try { recog.start(); } catch (e) {
      if (alwaysOn()) _scheduleRestart(2000);
    }
  }

  function stopListening() {
    // Only truly stops if NOT in always-on mode
    if (alwaysOn()) {
      speak('Voice is always on for blind mode. I will keep listening.');
      return;
    }
    active = false;
    clearTimeout(restartTimer);
    if (recog) { try { recog.stop(); } catch (e) {} }
    _micUI(false);
  }

  function _scheduleRestart(ms) {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (alwaysOn() && !active) startListening();
    }, ms);
  }

  /* ═══════════════════════════════════════════════
     MIC BUTTON UI
  ═══════════════════════════════════════════════ */
  function _micUI(on) {
    // Update floating mic button if it exists
    let btn = document.getElementById('bv-mic');
    if (!btn && alwaysOn()) {
      // Create floating always-on indicator for blind users
      btn = document.createElement('button');
      btn.id = 'bv-mic';
      btn.setAttribute('aria-label', 'Voice navigation — always on for blind mode');
      btn.style.cssText =
        'position:fixed;bottom:1.25rem;right:1.25rem;width:52px;height:52px;' +
        'border-radius:50%;border:none;font-size:1.3rem;cursor:pointer;z-index:9999;' +
        'display:flex;align-items:center;justify-content:center;transition:all .2s;';
      btn.title = 'Voice — always on for blind mode';
      btn.onclick = () => {
        if (!alwaysOn()) {
          if (active) { stopListening(); speak('Voice off.'); }
          else { speak('Voice on.', startListening); }
        } else {
          speak('Voice is always on in blind mode. Say help for commands.');
        }
      };
      document.body.appendChild(btn);
    }
    if (!btn) return;
    const isBlind = alwaysOn();
    btn.textContent      = on ? '🎙️' : (isBlind ? '🎙️' : '🎤');
    btn.style.background = on ? '#3ddc84' : (isBlind ? '#1a3a1a' : '#252525');
    btn.style.color      = on ? '#000' : (isBlind ? '#3ddc84' : '#888');
    btn.style.boxShadow  = on ? '0 0 0 5px rgba(61,220,132,.35)' : 'none';
    btn.style.border     = isBlind ? '2px solid #3ddc84' : '2px solid #333';
  }

  /* ═══════════════════════════════════════════════
     PAGE DETECTION
  ═══════════════════════════════════════════════ */
  function _page() {
    const p = window.location.pathname.toLowerCase();
    if (p.includes('lesson'))    return 'lesson';
    if (p.includes('dashboard')) return 'dashboard';
    if (p.includes('welcome'))   return 'welcome';
    return 'home';
  }

  function _match(text, phrases) {
    return phrases.some(p => text.includes(p));
  }

  /* ═══════════════════════════════════════════════
     COMMAND ROUTER
  ═══════════════════════════════════════════════ */
  function _handleCmd(text) {
    const pg = _page();

    /* ── GLOBAL COMMANDS (work on every page) ── */
    if (_match(text, ['stop talking','stop','quiet','silence']))       { stopSpeaking(); return; }
    if (_match(text, ['go home','open home','home page','main page'])) { speak('Going home.', () => window.location.href = 'index.html'); return; }
    if (_match(text, ['open lessons','go to lessons','lessons','start learning'])) { speak('Opening lessons.', () => window.location.href = 'lesson.html'); return; }
    if (_match(text, ['open dashboard','teacher dashboard','dashboard'])) { speak('Opening dashboard.', () => window.location.href = 'dashboard.html'); return; }
    if (_match(text, ['help','what can i say','commands','instructions'])) { _speakHelp(); return; }
    if (_match(text, ['increase text','bigger text','larger text','zoom in'])) { _changeFont(2); speak('Text bigger.'); return; }
    if (_match(text, ['decrease text','smaller text','zoom out']))           { _changeFont(-2); speak('Text smaller.'); return; }
    if (_match(text, ['repeat','say again','read again']))                   { if (pg==='lesson') { const c=document.getElementById('lesson-content'); if(c) speak(c.innerText.substring(0,1200)); } return; }
    if (_match(text, ['logout','log out','sign out','exit']))                { speak('Logging out.', () => { localStorage.clear(); window.location.href = 'welcome.html'; }); return; }

    /* ── PAGE SPECIFIC ── */
    if (pg === 'home')      _homeCmd(text);
    else if (pg === 'lesson')    _lessonCmd(text);
    else if (pg === 'dashboard') _dashCmd(text);
    else if (pg === 'welcome')   _welcomeCmd(text);
  }

  /* ─────────────────────────────────────
     WELCOME PAGE COMMANDS
  ───────────────────────────────────── */
  function _welcomeCmd(text) {
    // Handled directly in welcome.html's own voice engine
    // This is just a fallback
    if (_match(text, ['enter','go','start','continue'])) {
      const name = document.getElementById('uname') && document.getElementById('uname').value.trim();
      if (!name) speak('Please say your name first.');
      else speak('Entering now.', () => { if (window.enter) window.enter(); });
    }
  }

  /* ─────────────────────────────────────
     HOME PAGE COMMANDS
  ───────────────────────────────────── */
  const PROFILES = {
    blind:    ['blind','visually impaired','cannot see','low vision'],
    dyslexic: ['dyslexic','dyslexia','reading difficulty'],
    adhd:     ['adhd','attention','hyperactive','focus problem'],
    deaf:     ['deaf','hearing','cannot hear','hard of hearing'],
    motor:    ['motor','physical','cannot use hands'],
    standard: ['standard','normal','none','skip']
  };

  function _homeCmd(text) {
    for (const [p, words] of Object.entries(PROFILES)) {
      if (words.some(w => text.includes(w))) {
        if (window.setProfile) {
          const card = document.querySelector(`.pcard[data-mode="${p}"]`);
          if (card) window.setProfile(p, card);
        }
        speak(p + ' profile activated.');
        return;
      }
    }
    if (_match(text, ['simplify','simplify text']))  { _switchTab('simplify'); return; }
    if (_match(text, ['translate','translation']))   { _switchTab('translate'); return; }
    if (_match(text, ['voice','voice demo']))        { _switchTab('voice'); return; }
    if (_match(text, ['ocr','scanner','scan']))      { _switchTab('ocr'); return; }
    if (_match(text, ['timer','focus timer','pomodoro'])) { _switchTab('timer'); return; }
    speak('Say a profile name or feature. Say help for all commands.');
  }

  function _switchTab(name) {
    const panels = document.querySelectorAll('.panel');
    const tabs   = document.querySelectorAll('.tab');
    if (!panels.length) return;
    panels.forEach(p => p.classList.remove('active'));
    tabs.forEach(b => b.classList.remove('active'));
    const p = document.getElementById('panel-' + name);
    const t = document.querySelector(`.tab[data-tab="${name}"]`);
    if (p) p.classList.add('active');
    if (t) t.classList.add('active');
    speak(name + ' opened.');
  }

  /* ─────────────────────────────────────
     LESSON PAGE COMMANDS
  ───────────────────────────────────── */
  function _lessonCmd(text) {
    if (_match(text, ['next','next lesson','continue','complete','done','finish'])) {
      speak('Next lesson.', () => window.nextLesson && window.nextLesson()); return;
    }
    if (_match(text, ['back','previous','go back','last lesson'])) {
      speak('Previous lesson.', () => window.prevLesson && window.prevLesson()); return;
    }
    if (_match(text, ['read','read lesson','read this','read aloud','read content'])) {
      const c = document.getElementById('lesson-content');
      if (c) speak(c.innerText.substring(0, 1400));
      return;
    }
    if (_match(text, ['simplify','make it simple','easy language'])) {
      speak('Simplifying.', () => window.simplifyLesson && window.simplifyLesson()); return;
    }
    if (_match(text, ['restore','original','put it back'])) {
      speak('Restoring original.', () => window.restoreLesson && window.restoreLesson()); return;
    }
    if (_match(text, ['quiz','start quiz','go to quiz','question'])) {
      const q = document.querySelector('.quiz-box');
      if (q) { q.scrollIntoView({ behavior: 'smooth' }); const qq = document.querySelector('.quiz-q'); speak('Quiz. ' + (qq ? qq.textContent : '')); }
      return;
    }
    if (_match(text, ['read question','what is the question'])) {
      const qq = document.querySelector('.quiz-q'); if (qq) speak(qq.textContent); return;
    }
    if (_match(text, ['read options','what are the options','list options','read answers'])) {
      const opts = document.querySelectorAll('.qopt');
      if (opts.length) { let m='Options are: '; opts.forEach((o,i)=>{m+=(i+1)+': '+o.textContent.trim()+'. ';}); speak(m); }
      return;
    }
    // "option 1", "answer 2", "choice three"
    const numMap = { one:0,two:1,three:2,four:3,'1':0,'2':1,'3':2,'4':3 };
    const nm = text.match(/(?:option|answer|choice|select|pick)\s*([1-4]|one|two|three|four)/);
    if (nm) {
      const idx = numMap[nm[1]];
      if (idx !== undefined) {
        const btn = document.querySelectorAll('.qopt')[idx];
        if (btn && !btn.disabled) btn.click();
        else if (btn && btn.disabled) speak('Already answered. Say next to continue.');
      }
      return;
    }
    if (_match(text, ['translate hindi','in hindi','hindi'])) { speak('Hindi.', () => window.translateLesson && window.translateLesson('hi')); return; }
    if (_match(text, ['translate marathi','marathi']))        { speak('Marathi.', () => window.translateLesson && window.translateLesson('mr')); return; }
    if (_match(text, ['translate tamil','tamil']))            { speak('Tamil.', () => window.translateLesson && window.translateLesson('ta')); return; }
    if (_match(text, ['stop reading','stop speaking']))       { stopSpeaking(); return; }
    if (_match(text, ['which lesson','current lesson','where am i'])) {
      const h = document.querySelector('.lesson-title'); speak(h ? 'You are on: ' + h.textContent : 'Lesson page.'); return;
    }
    if (_match(text, ['scan','ocr','scan image']))  { if (window.openOCR) window.openOCR(); return; }
    speak('Commands: read lesson, next, previous, quiz, option 1 to 4, simplify, translate Hindi, or help.');
  }

  /* ─────────────────────────────────────
     DASHBOARD COMMANDS
  ───────────────────────────────────── */
  function _dashCmd(text) {
    if (_match(text, ['total students','how many students'])) { const e=document.getElementById('s-total'); speak(e?e.textContent+' students total.':'Not available.'); return; }
    if (_match(text, ['average progress','avg progress']))    { const e=document.getElementById('s-avg'); speak(e?'Average progress is '+e.textContent:'Not available.'); return; }
    if (_match(text, ['need help','alerts','need attention'])) { const e=document.getElementById('s-alerts'); speak(e?e.textContent+' students need attention.':'Not available.'); return; }
    if (_match(text, ['export','download csv']))              { speak('Exporting.', () => window.exportCSV && window.exportCSV()); return; }
    if (_match(text, ['refresh','reload','update data']))     { speak('Refreshing.', () => window.fetchData && window.fetchData()); return; }
    speak('Say: total students, average progress, need help, export, or refresh.');
  }

  /* ─────────────────────────────────────
     HELP SPEECH
  ───────────────────────────────────── */
  function _speakHelp() {
    const pg = _page();
    const global = 'Global commands: go home, open lessons, open dashboard, increase text, decrease text, stop, logout, help. ';
    const pages = {
      welcome: 'On welcome: say my name is, your name, then your profile. Example: my name is Priya blind.',
      home:    'On home: say blind, dyslexic, ADHD, deaf, motor, or standard. Or say simplify, translate, timer.',
      lesson:  'On lesson: read lesson, next, previous, quiz, option 1 to 4, simplify, translate Hindi, complete.',
      dashboard: 'On dashboard: total students, average progress, need help, export, refresh.'
    };
    speak(global + (pages[pg] || ''));
  }

  /* ─────────────────────────────────────
     FONT SIZE
  ───────────────────────────────────── */
  function _changeFont(delta) {
    const root = document.documentElement;
    const cur  = parseInt(getComputedStyle(root).fontSize) || 16;
    root.style.fontSize = Math.max(12, Math.min(26, cur + delta)) + 'px';
  }

  /* ═══════════════════════════════════════════════
     PAGE INTRODUCTION (spoken on load)
  ═══════════════════════════════════════════════ */
  function _intro() {
    const pg      = _page();
    const profile = localStorage.getItem('brainies_profile') || 'standard';
    const name    = localStorage.getItem('brainies_name') || '';

    const greeting = name ? 'Welcome back ' + name + '. ' : 'Welcome back. ';

    if (pg === 'home') {
      speak(
        greeting + 'Your profile is ' + profile + '. ' +
        'Say open lessons to start learning. Say help for all commands.',
        startListening
      );
    } else if (pg === 'lesson') {
      const h = document.querySelector('.lesson-title');
      speak(
        greeting +
        'Lesson page. ' + (h ? h.textContent.trim() + '. ' : '') +
        'Say read lesson to hear the content. Say quiz for the quiz. Say help for all commands.',
        startListening
      );
    } else if (pg === 'dashboard') {
      speak(greeting + 'Teacher dashboard. Say total students, refresh, or help.', startListening);
    }
  }

  /* ═══════════════════════════════════════════════
     BOOT — runs on every page
  ═══════════════════════════════════════════════ */
  function _boot() {
    const pg      = _page();
    const profile = localStorage.getItem('brainies_profile');

    // Alt+V toggles voice (non-blind users)
    document.addEventListener('keydown', e => {
      if (e.altKey && e.key === 'v') {
        if (alwaysOn()) {
          speak('Voice is always on in blind mode. Say help for commands.');
        } else {
          if (active) { stopListening(); speak('Voice off.'); }
          else { speak('Voice on.', startListening); }
        }
      }
      if (e.key === 'Escape') stopSpeaking();
    });

    // Skip welcome page — it has its own voice engine
    if (pg === 'welcome') return;

    // Apply blind mode visuals immediately
    if (profile === 'blind') {
      document.body.classList.add('mode-blind');
      // Show always-on bar if present
      const bar = document.getElementById('voice-bar');
      if (bar) bar.className = 'voice-bar show';
    }

    // Auto-start voice for blind users OR on home page
    const shouldAutoStart = (profile === 'blind') || (pg === 'home');
    if (!shouldAutoStart) return;

    if (document.readyState === 'complete') {
      setTimeout(_intro, 700);
    } else {
      window.addEventListener('load', () => setTimeout(_intro, 700));
    }
  }

  /* ═══════════════════════════════════════════════
     PUBLIC API — accessible from any page
  ═══════════════════════════════════════════════ */
  window.BV = {
    speak,
    stopSpeaking,
    startListening,
    stopListening,
    isAlwaysOn: alwaysOn
  };

  _boot();
})();
