/**
 * BRAINIES VOICE ENGINE v4 — Wake-Word Mode
 *
 * HOW IT WORKS:
 * ─────────────────────────────────────────────────
 * Voice is OFF by default on all pages.
 *
 * A lightweight "wake listener" runs silently in the
 * background listening ONLY for the wake phrase.
 * Wake phrases: "hey brainies", "help", "voice on",
 *               "start voice", "listen"
 *
 * When wake word is detected:
 *   1. Wake listener stops
 *   2. A 5-second command session opens (mic turns green)
 *   3. Any command is processed
 *   4. After command (or 5s silence), session closes
 *   5. Wake listener restarts silently
 *
 * Blind mode: always-on as before (no wake word needed).
 * Alt+V: toggle full session manually.
 * Mic button: tap to open/close a session manually.
 */
(function () {
  'use strict';

  const LANG = 'en-IN';

  /* ═══════════════════════════════════════════════════
     TTS — queue-based, stutter-free
  ═══════════════════════════════════════════════════ */
  let _q = [], _busy = false;

  function speak(text, cb) {
    if (!('speechSynthesis' in window)) { if (cb) cb(); return; }
    if (cb) _q = [{ text, cb }];
    else    _q.push({ text, cb: null });
    if (!_busy) _drain();
  }

  function _drain() {
    if (!_q.length) { _busy = false; return; }
    _busy = true;
    const { text, cb } = _q.shift();
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending)
      window.speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG; u.rate = 1.0; u.volume = 1; u.pitch = 1;

    // ── PAUSE ALL MICS while speaking ──────────────────
    u.onstart = () => { _muteMics(); };

    // ── RESUME MICS only after speech fully ends ────────
    u.onend = () => {
      _busy = false;
      _unmuteMics();
      if (cb) cb();
      _drain();
    };
    u.onerror = () => {
      _busy = false;
      _unmuteMics();
      if (cb) cb();
      _drain();
    };

    window.speechSynthesis.speak(u);
    const cap = document.getElementById('caption-text') || document.getElementById('cap-txt');
    if (cap) cap.textContent = text;
  }

  function stopSpeaking() {
    _q = []; _busy = false;
    window.speechSynthesis.cancel();
    _unmuteMics(); // always resume mics when speech is force-stopped
  }

  /* ── MIC MUTE / UNMUTE ────────────────────────────────
     Called by TTS drain so mics are always silent while
     the app is reading. Resumes automatically on onend.
  ─────────────────────────────────────────────────────── */
  let _micMuted = false;

  function _muteMics() {
    if (_micMuted) return;
    _micMuted = true;
    // Pause wake listener
    if (_wakeActive && _wake) { try { _wake.stop(); } catch {} }
    // Pause command session mic
    if (_cmdActive && _cmd)   { try { _cmd.stop();  } catch {} }
    // Pause always-on mic (blind mode)
    if (_aoActive && _ao)     { try { _ao.stop();   } catch {} }
  }

  function _unmuteMics() {
    if (!_micMuted) return;
    _micMuted = false;
    // Restart whatever was running before speech
    if (isBlind()) {
      _scheduleAO(120);       // restart always-on mic
    } else if (_sessionOpen) {
      setTimeout(_startCmd, 120); // restart command session mic
    } else {
      _scheduleWake(200);     // restart silent wake listener
    }
  }

  /* ═══════════════════════════════════════════════════
     BLIND MODE CHECK
  ═══════════════════════════════════════════════════ */
  const isBlind = () =>
    localStorage.getItem('brainies_always_voice') === '1' ||
    localStorage.getItem('brainies_profile') === 'blind';

  /* ═══════════════════════════════════════════════════
     WAKE WORD LISTENER
     Runs silently in background.
     Only listens for wake phrases — ignores everything else.
     Uses minimal resources: single utterance, no continuous stream.
  ═══════════════════════════════════════════════════ */
  const WAKE_PHRASES = ['hey brainies','help','voice on','start voice','listen','okay brainies'];

  let _wake = null, _wakeActive = false, _wakeTimer = null, _wakePaused = false;

  function _startWake() {
    if (_wakeActive || _wakePaused || isBlind()) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    _wake = new SR();
    _wake.lang            = LANG;
    _wake.continuous      = false;
    _wake.interimResults  = false;
    _wake.maxAlternatives = 1;

    _wake.onstart  = () => { _wakeActive = true; };
    _wake.onresult = (e) => {
      const txt = e.results[0][0].transcript.toLowerCase().trim();
      if (WAKE_PHRASES.some(w => txt.includes(w))) {
        _wakeActive = false;
        _openSession(); // wake word heard — open command session
      }
      // Non-wake speech: ignore silently
    };
    _wake.onerror = () => {
      _wakeActive = false;
      if (!_wakePaused) _scheduleWake(500);
    };
    _wake.onend = () => {
      _wakeActive = false;
      // Keep wake listener cycling unless a session is open or paused
      if (!_sessionOpen && !_wakePaused) _scheduleWake(200);
    };

    try { _wake.start(); }
    catch { _scheduleWake(800); }
  }

  function _scheduleWake(ms) {
    clearTimeout(_wakeTimer);
    _wakeTimer = setTimeout(_startWake, ms);
  }

  function _stopWake() {
    _wakePaused = true;
    clearTimeout(_wakeTimer);
    _wakeActive = false;
    if (_wake) { try { _wake.stop(); } catch {} }
  }

  function _resumeWake() {
    _wakePaused = false;
    if (!_sessionOpen && !isBlind()) _scheduleWake(300);
  }

  /* ═══════════════════════════════════════════════════
     COMMAND SESSION
     Opens for 5 seconds, processes one command,
     then closes and hands back to wake listener.
  ═══════════════════════════════════════════════════ */
  let _cmd = null, _cmdActive = false, _sessionOpen = false, _sessionTimer = null;

  const SESSION_MS = 5000; // 5 seconds to speak a command

  function _openSession() {
    if (_sessionOpen) { _extendSession(); return; }
    _sessionOpen = true;
    _stopWake(); // pause wake listener during session

    speak('Listening.', () => {
      _startCmd(); // start mic AFTER "Listening." finishes
    });

    _micUI('session');
    _updateStatus('🎙️ Speak your command…');

    // Auto-close after SESSION_MS of silence
    _sessionTimer = setTimeout(_closeSession, SESSION_MS);
  }

  function _extendSession() {
    clearTimeout(_sessionTimer);
    _sessionTimer = setTimeout(_closeSession, SESSION_MS);
  }

  function _closeSession(silent) {
    clearTimeout(_sessionTimer);
    _sessionOpen = false;
    _cmdActive   = false;
    if (_cmd) { try { _cmd.stop(); } catch {} _cmd = null; }
    _micUI('off');
    _updateStatus('');
    if (!silent) _resumeWake(); // restart background wake listener
  }

  function _startCmd() {
    if (_cmdActive) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    _cmd = new SR();
    _cmd.lang            = LANG;
    _cmd.continuous      = false;
    _cmd.interimResults  = false;
    _cmd.maxAlternatives = 1;

    _cmd.onstart  = () => { _cmdActive = true; _micUI('on'); };
    _cmd.onresult = (e) => {
      const txt = e.results[0][0].transcript.toLowerCase().trim();
      if (!txt) return;
      const heard = document.getElementById('vb-heard');
      if (heard) heard.textContent = txt;
      _extendSession(); // reset timer on each result
      _handleCmd(txt);
    };
    _cmd.onerror = () => {
      _cmdActive = false;
      _micUI('session');
      // Re-open mic within session window
      if (_sessionOpen) setTimeout(_startCmd, 200);
    };
    _cmd.onend = () => {
      _cmdActive = false;
      _micUI('session');
      // Re-open mic within session window to allow multi-command
      if (_sessionOpen) setTimeout(_startCmd, 150);
    };

    try { _cmd.start(); }
    catch { if (_sessionOpen) setTimeout(_startCmd, 500); }
  }

  /* ═══════════════════════════════════════════════════
     ALWAYS-ON ENGINE (blind mode only)
     Unchanged from v3 — blind users need no wake word.
  ═══════════════════════════════════════════════════ */
  let _ao = null, _aoActive = false, _aoTimer = null;

  function _startAlwaysOn() {
    if (_aoActive) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    _ao = new SR();
    _ao.lang            = LANG;
    _ao.continuous      = false;
    _ao.interimResults  = false;
    _ao.maxAlternatives = 1;

    _ao.onstart  = () => { _aoActive = true; _micUI('on'); };
    _ao.onend    = () => { _aoActive = false; _micUI('off'); _scheduleAO(80); };
    _ao.onerror  = (e) => {
      _aoActive = false; _micUI('off');
      _scheduleAO(e.error === 'no-speech' ? 80 : 300);
    };
    _ao.onresult = (e) => {
      const txt = e.results[0][0].transcript.toLowerCase().trim();
      if (!txt) return;
      const heard = document.getElementById('vb-heard');
      if (heard) heard.textContent = txt;
      _handleCmd(txt);
    };

    try { _ao.start(); } catch { _scheduleAO(300); }
  }

  function _scheduleAO(ms) {
    clearTimeout(_aoTimer);
    _aoTimer = setTimeout(() => { if (isBlind() && !_aoActive) _startAlwaysOn(); }, ms);
  }

  /* ═══════════════════════════════════════════════════
     PUBLIC startListening / stopListening
     Used by _intro() and public API
  ═══════════════════════════════════════════════════ */
  function startListening() {
    if (isBlind()) { _startAlwaysOn(); return; }
    _openSession();
  }

  function stopListening() {
    if (isBlind()) { speak('Voice is always on in blind mode. Say help for commands.'); return; }
    _closeSession(true);
    _resumeWake();
  }

  /* ═══════════════════════════════════════════════════
     MIC BUTTON UI
  ═══════════════════════════════════════════════════ */
  let _micBtn = null;

  function _micUI(state) {
    // state: 'on' | 'off' | 'session' | 'wake'
    if (!_micBtn) {
      if (!document.getElementById('_bv_style')) {
        const s = document.createElement('style');
        s.id = '_bv_style';
        s.textContent =
          '#bv-mic{position:fixed;bottom:1.2rem;right:4.5rem;width:44px;height:44px;' +
          'border-radius:50%;font-size:1.1rem;cursor:pointer;z-index:9999;' +
          'display:flex;align-items:center;justify-content:center;' +
          'border:2px solid #333;background:#1a1a1a;color:#555;' +
          'transition:background .15s,border-color .15s,color .15s}' +
          '#bv-mic.on{background:#3ddc84;color:#000;border-color:#3ddc84}' +
          '#bv-mic.session{background:#1a3a1a;color:#3ddc84;border-color:#3ddc84}' +
          '#bv-mic.always{background:#0a1a0a;color:#3ddc84;border-color:#3ddc84}' +
          '#bv-mic-tip{position:fixed;bottom:4.2rem;right:3.5rem;background:#1a1a1a;' +
          'border:1px solid #333;border-radius:6px;padding:.3rem .6rem;' +
          'font-size:.7rem;color:#888;pointer-events:none;white-space:nowrap;' +
          'opacity:0;transition:opacity .2s}' +
          '#bv-mic:hover+#bv-mic-tip,#bv-mic:focus+#bv-mic-tip{opacity:1}';
        document.head.appendChild(s);
      }
      _micBtn = document.createElement('button');
      _micBtn.id = 'bv-mic';
      _micBtn.setAttribute('aria-label', 'Voice commands — say "help" to activate');
      _micBtn.textContent = '🎤';
      _micBtn.onclick = () => {
        if (isBlind()) { speak('Voice always on. Say help for commands.'); return; }
        if (_sessionOpen) { _closeSession(false); speak('Voice off.'); }
        else { _openSession(); }
      };
      document.body.appendChild(_micBtn);

      // Tooltip
      const tip = document.createElement('div');
      tip.id = 'bv-mic-tip';
      tip.textContent = 'Say "help" to activate voice';
      document.body.appendChild(tip);
    }

    if (isBlind()) {
      _micBtn.className   = 'always';
      _micBtn.textContent = '🎙️';
      return;
    }

    switch (state) {
      case 'on':
        _micBtn.className   = 'on';
        _micBtn.textContent = '🎙️';
        break;
      case 'session':
        _micBtn.className   = 'session';
        _micBtn.textContent = '🎙️';
        break;
      case 'off':
      default:
        _micBtn.className   = '';
        _micBtn.textContent = '🎤';
        break;
    }
  }

  function _updateStatus(msg) {
    // Update any status element on the page if it exists
    const el = document.getElementById('msg') ||
               document.getElementById('vmic-status') ||
               document.getElementById('voice-pill-text');
    if (el) el.textContent = msg;
  }

  /* ═══════════════════════════════════════════════════
     PAGE DETECTION
  ═══════════════════════════════════════════════════ */
  function _page() {
    const p = window.location.pathname.toLowerCase();
    if (p.includes('lesson'))    return 'lesson';
    if (p.includes('dashboard')) return 'dashboard';
    if (p.includes('welcome'))   return 'welcome';
    return 'home';
  }

  function _match(t, phrases) {
    return phrases.some(p => t.includes(p));
  }

  /* ═══════════════════════════════════════════════════
     COMMAND ROUTER
  ═══════════════════════════════════════════════════ */
  function _handleCmd(text) {
    const pg = _page();

    // "close" / "stop" / "voice off" — end the session
    if (_match(text, ['voice off','close voice','stop listening','cancel'])) {
      speak('Voice off.'); _closeSession(false); return;
    }
    if (_match(text, ['stop talking','stop','quiet','silence'])) {
      stopSpeaking(); return;
    }

    // Navigation
    if (_match(text, ['go home','open home','home page','main page'])) {
      speak('Going home.'); setTimeout(() => window.location.href = 'index.html', 600); return;
    }
    if (_match(text, ['open lessons','go to lessons','lessons','start learning'])) {
      speak('Opening lessons.'); setTimeout(() => window.location.href = 'lesson.html', 600); return;
    }
    if (_match(text, ['open dashboard','teacher dashboard','dashboard'])) {
      speak('Opening dashboard.'); setTimeout(() => window.location.href = 'dashboard.html', 600); return;
    }

    // Help
    if (_match(text, ['help','what can i say','commands','instructions'])) {
      _speakHelp(); return;
    }

    // Accessibility
    if (_match(text, ['increase text','bigger text','larger text','zoom in'])) {
      _changeFont(2); speak('Text bigger.'); return;
    }
    if (_match(text, ['decrease text','smaller text','zoom out'])) {
      _changeFont(-2); speak('Text smaller.'); return;
    }
    if (_match(text, ['repeat','say again','read again'])) {
      if (pg === 'lesson') {
        const c = document.getElementById('lesson-content');
        if (c) speak(c.innerText.substring(0, 1200));
      }
      return;
    }
    if (_match(text, ['logout','log out','sign out','exit'])) {
      speak('Logging out.');
      setTimeout(() => {
        Object.keys(localStorage).filter(k=>k.startsWith('brainies_')).forEach(k=>localStorage.removeItem(k));
        window.location.href = 'welcome.html';
      }, 600);
      return;
    }

    // Page-specific
    if (pg === 'home')           _homeCmd(text);
    else if (pg === 'lesson')    _lessonCmd(text);
    else if (pg === 'dashboard') _dashCmd(text);
    else if (pg === 'welcome')   _welcomeCmd(text);
  }

  /* ── Welcome ── */
  function _welcomeCmd(text) {
    if (_match(text, ['enter','go','start','continue'])) {
      const inp  = document.getElementById('uname');
      const name = inp ? inp.value.trim() : '';
      if (!name) speak('Please say your name first.');
      else { speak('Entering.'); if (window.enter) window.enter(); }
    }
  }

  /* ── Home ── */
  const PROFILES = {
    blind:    ['blind','visually impaired','cannot see','low vision'],
    dyslexic: ['dyslexic','dyslexia','reading difficulty'],
    adhd:     ['adhd','attention','hyperactive','focus problem'],
    deaf:     ['deaf','hearing impaired','cannot hear','hard of hearing'],
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
        speak(p + ' mode activated.');
        return;
      }
    }
    if (_match(text, ['simplify']))         { _switchTab('simplify');  return; }
    if (_match(text, ['translate']))        { _switchTab('translate'); return; }
    if (_match(text, ['voice','voice demo'])) { _switchTab('voice');   return; }
    if (_match(text, ['ocr','scan']))       { _switchTab('ocr');       return; }
    if (_match(text, ['timer','pomodoro'])) { _switchTab('timer');     return; }
    speak('Say a profile name or feature. Say help for all commands.');
  }

  function _switchTab(name) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    const p = document.getElementById('panel-' + name);
    const t = document.querySelector(`.tab[data-tab="${name}"]`);
    if (p) p.classList.add('active');
    if (t) t.classList.add('active');
    speak(name + ' opened.');
  }

  /* ── Lesson ── */
  function _lessonCmd(text) {
    if (_match(text, ['next','next lesson','continue','complete','done','finish'])) {
      speak('Next lesson.'); if (window.nextLesson) window.nextLesson(); return;
    }
    if (_match(text, ['back','previous','go back','last lesson'])) {
      speak('Previous.'); if (window.prevLesson) window.prevLesson(); return;
    }
    if (_match(text, ['read','read lesson','read this','read aloud','read content'])) {
      const c = document.getElementById('lesson-content');
      if (c) speak(c.innerText.substring(0, 1400));
      return;
    }
    if (_match(text, ['simplify','make it simple','easy language'])) {
      speak('Simplifying.'); if (window.simplifyLesson) window.simplifyLesson(); return;
    }
    if (_match(text, ['restore','original','put it back'])) {
      speak('Restoring.'); if (window.restoreLesson) window.restoreLesson(); return;
    }
    if (_match(text, ['quiz','start quiz','question'])) {
      const q = document.querySelector('.quiz-box');
      if (q) {
        q.scrollIntoView({ behavior: 'instant' });
        const qq = document.querySelector('.quiz-q');
        speak(qq ? 'Quiz. ' + qq.textContent : 'Quiz.');
      }
      return;
    }
    if (_match(text, ['read question','what is the question'])) {
      const qq = document.querySelector('.quiz-q');
      if (qq) speak(qq.textContent); return;
    }
    if (_match(text, ['read options','what are the options','list options','read answers'])) {
      const opts = document.querySelectorAll('.qopt');
      if (opts.length) {
        let m = 'Options: ';
        opts.forEach((o, i) => { m += (i + 1) + ': ' + o.textContent.trim() + '. '; });
        speak(m);
      }
      return;
    }
    const numMap = { one:0, two:1, three:2, four:3, '1':0, '2':1, '3':2, '4':3 };
    const nm = text.match(/(?:option|answer|choice|select|pick)\s*([1-4]|one|two|three|four)/);
    if (nm) {
      const idx = numMap[nm[1]];
      if (idx !== undefined) {
        const btn = document.querySelectorAll('.qopt')[idx];
        if (btn && !btn.disabled) btn.click();
        else if (btn?.disabled) speak('Already answered. Say next to continue.');
        else speak('Option not found.');
      }
      return;
    }
    if (_match(text, ['hindi']))   { speak('Hindi.');   if (window.translateLesson) window.translateLesson('hi'); return; }
    if (_match(text, ['marathi'])) { speak('Marathi.'); if (window.translateLesson) window.translateLesson('mr'); return; }
    if (_match(text, ['tamil']))   { speak('Tamil.');   if (window.translateLesson) window.translateLesson('ta'); return; }
    if (_match(text, ['telugu']))  { speak('Telugu.');  if (window.translateLesson) window.translateLesson('te'); return; }
    if (_match(text, ['stop reading','stop speaking'])) { stopSpeaking(); return; }
    if (_match(text, ['which lesson','where am i'])) {
      const h = document.querySelector('.lesson-title');
      speak(h ? 'You are on: ' + h.textContent : 'Lesson page.'); return;
    }
    if (_match(text, ['scan','ocr','scan image'])) { if (window.openOCR) window.openOCR(); return; }

    speak('Say: read, next, previous, quiz, option 1 to 4, simplify, or help.');
  }

  /* ── Dashboard ── */
  function _dashCmd(text) {
    if (_match(text, ['total students','how many students'])) {
      const e = document.getElementById('s-total');
      speak(e ? e.textContent + ' students total.' : 'Not available.'); return;
    }
    if (_match(text, ['average progress','avg progress'])) {
      const e = document.getElementById('s-avg');
      speak(e ? 'Average progress is ' + e.textContent : 'Not available.'); return;
    }
    if (_match(text, ['need help','alerts','need attention'])) {
      const e = document.getElementById('s-alerts');
      speak(e ? e.textContent + ' students need attention.' : 'Not available.'); return;
    }
    if (_match(text, ['export','download csv'])) { speak('Exporting.'); if (window.exportCSV) window.exportCSV(); return; }
    if (_match(text, ['refresh','reload','update'])) { speak('Refreshing.'); if (window.fetchData) window.fetchData(); return; }
    speak('Say: total students, average progress, need help, export, or refresh.');
  }

  /* ── Help ── */
  function _speakHelp() {
    const pages = {
      welcome:   'Say your name, say your profile, then say enter.',
      home:      'Say blind, dyslexic, ADHD, deaf, motor, or standard. Or say simplify, translate, timer.',
      lesson:    'Say: read lesson, next, previous, quiz, option 1 to 4, simplify, translate Hindi, or complete.',
      dashboard: 'Say: total students, average progress, need help, export, or refresh.'
    };
    speak(
      'Voice commands. ' +
      'Global: go home, open lessons, dashboard, increase text, stop, logout. ' +
      (pages[_page()] || '') +
      ' Say voice off to close.'
    );
  }

  /* ── Font size ── */
  function _changeFont(delta) {
    const root = document.documentElement;
    const cur  = parseInt(getComputedStyle(root).fontSize) || 16;
    root.style.fontSize = Math.max(12, Math.min(26, cur + delta)) + 'px';
  }

  /* ═══════════════════════════════════════════════════
     PAGE INTRO — speaks on load for blind/home only.
     Mic starts AFTER speech ends (callback pattern).
  ═══════════════════════════════════════════════════ */
  function _intro() {
    const pg      = _page();
    const profile = localStorage.getItem('brainies_profile') || 'standard';
    const name    = localStorage.getItem('brainies_name') || '';
    const greet   = name ? 'Welcome back ' + name + '. ' : '';

    if (pg === 'home') {
      speak(
        greet + 'Your profile is ' + profile + '. ' +
        'Say open lessons to start. Say help for voice commands.',
        startListening
      );
    } else if (pg === 'lesson') {
      const h = document.querySelector('.lesson-title');
      speak(
        greet + 'Lesson: ' + (h ? h.textContent.trim() + '. ' : '') +
        'Say read lesson, quiz, or help for voice commands.',
        startListening
      );
    } else if (pg === 'dashboard') {
      speak(
        greet + 'Teacher dashboard. Say help for voice commands.',
        startListening
      );
    } else {
      startListening();
    }
  }

  /* ═══════════════════════════════════════════════════
     BOOT
  ═══════════════════════════════════════════════════ */
  function _boot() {
    const pg      = _page();
    const profile = localStorage.getItem('brainies_profile');

    // Alt+V = manual session toggle
    document.addEventListener('keydown', e => {
      if (e.altKey && e.key === 'v') {
        if (isBlind()) { speak('Voice always on. Say help.'); return; }
        if (_sessionOpen) { _closeSession(false); speak('Voice off.'); }
        else { _openSession(); }
      }
      if (e.key === 'Escape') stopSpeaking();
    });

    if (pg === 'welcome') return; // welcome has its own engine

    if (profile === 'blind') {
      document.body.classList.add('mode-blind');
      const bar = document.getElementById('voice-bar');
      if (bar) bar.className = 'voice-bar show';
    }

    const run = () => setTimeout(() => {
      // Always create the mic button
      _micUI('off');

      if (isBlind()) {
        // Blind: speak intro then start always-on
        _intro();
      } else {
        // Everyone else: start silent wake listener only
        _startWake();
      }
    }, 400);

    if (document.readyState === 'complete') run();
    else window.addEventListener('load', run);
  }

  /* ═══════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════ */
  window.BV = {
    speak,
    stopSpeaking,
    startListening,
    stopListening,
    isAlwaysOn: isBlind,
    openSession: _openSession,
    closeSession: _closeSession
  };

  _boot();
})();
