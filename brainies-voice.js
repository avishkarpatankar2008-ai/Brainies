/**
 * BRAINIES VOICE ENGINE v3
 *
 * WHAT WAS BREAKING THE VOICE:
 *
 * 1. continuous=true
 *    The browser kept an open audio stream running forever, constantly
 *    processing audio even in silence. This causes crackling, dropouts
 *    and broken recognition because the stream competes with TTS output.
 *    FIX: continuous=false + instant auto-restart (80ms gap).
 *
 * 2. maxAlternatives=3
 *    Speech engine ran 3 full transcriptions per utterance = 3x CPU.
 *    On low-end devices this caused the audio pipeline to stall mid-word,
 *    making voice sound cut off and commands missed.
 *    FIX: maxAlternatives=1
 *
 * 3. speechSynthesis.cancel() called inside EVERY _drain() call
 *    Even when nothing was playing, cancel() was fired before every
 *    single utterance. This reset the TTS engine each time = 200-300ms
 *    silence gap + first word of every sentence getting clipped/cut off.
 *    FIX: only cancel() when queue replaces an active utterance.
 *
 * 4. startListening passed as a callback to speak()
 *    Mic only started AFTER the full intro speech ended (5-10 seconds).
 *    During that whole time, nothing was being listened to.
 *    FIX: startListening runs immediately alongside speech, not after it.
 *
 * 5. Restart delays: 600ms normal, 1000-2000ms on errors
 *    Gap between recognition sessions = dead time where voice was deaf.
 *    FIX: 80ms normal gap, 300ms on real errors.
 *
 * 6. _micUI() wrote 5 inline style properties on every onstart/onend
 *    This forced style recalculation + layout on every cycle = jank.
 *    FIX: single className update, button ref cached.
 *
 * 7. TTS rate=0.88 caused Chrome to sometimes drop the first syllable
 *    because the engine starts slightly slow at sub-1.0 rates.
 *    FIX: rate=1.0 (natural speed, clearest output).
 */
(function () {
  'use strict';

  const LANG = 'en-IN';

  /* ═══════════════════════════════════════════════════
     SPEECH SYNTHESIS
     FIX: never cancel() blindly — only when replacing
     an active utterance. This eliminates the clipped
     first-word and 200-300ms silence gap.
  ═══════════════════════════════════════════════════ */
  let _q = [], _busy = false;

  function speak(text, cb) {
    if (!('speechSynthesis' in window)) { if (cb) cb(); return; }
    // If cb given, it's a "then do X" call — replace queue so it runs next
    if (cb) {
      _q = [{ text, cb }];
    } else {
      _q.push({ text, cb: null });
    }
    if (!_busy) _drain();
  }

  function _drain() {
    if (!_q.length) { _busy = false; return; }
    _busy = true;
    const { text, cb } = _q.shift();

    // Only cancel if TTS is actively mid-speech — not on fresh calls
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
    }

    const u = new SpeechSynthesisUtterance(text);
    u.lang   = LANG;
    u.rate   = 1.0;   // FIX: was 0.88 — caused first syllable clipping in Chrome
    u.volume = 1;
    u.pitch  = 1;

    u.onend   = () => { _busy = false; if (cb) cb(); _drain(); };
    u.onerror = () => { _busy = false; if (cb) cb(); _drain(); };

    window.speechSynthesis.speak(u);

    // Update captions for deaf mode
    const el = document.getElementById('caption-text') || document.getElementById('cap-txt');
    if (el) el.textContent = text;
  }

  function stopSpeaking() {
    _q = []; _busy = false;
    window.speechSynthesis.cancel();
  }

  /* ═══════════════════════════════════════════════════
     MICROPHONE ENGINE
     FIX: continuous=false (no open stream), 
          maxAlternatives=1 (3x less CPU),
          80ms restart gap (was 600-2000ms)
  ═══════════════════════════════════════════════════ */
  let _recog = null, _active = false, _rTimer = null, _micBtn = null;

  const alwaysOn = () =>
    localStorage.getItem('brainies_always_voice') === '1' ||
    localStorage.getItem('brainies_profile') === 'blind';

  function startListening() {
    if (_active) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    _recog = new SR();
    _recog.lang            = LANG;
    _recog.continuous      = false; // FIX: was true — open stream caused audio breakup
    _recog.interimResults  = false; // FIX: no per-syllable firing
    _recog.maxAlternatives = 1;     // FIX: was 3 — 3x CPU per utterance

    _recog.onstart = () => {
      _active = true;
      _micUI(true);
      const bar = document.getElementById('voice-bar');
      if (bar && alwaysOn()) bar.className = 'voice-bar show';
    };

    _recog.onend = () => {
      _active = false;
      _micUI(false);
      // FIX: 80ms gap (was 600ms) — barely perceptible, much faster pickup
      if (alwaysOn()) _restart(80);
    };

    _recog.onerror = (e) => {
      _active = false;
      _micUI(false);
      if (e.error === 'not-allowed') {
        speak('Microphone blocked. Please allow microphone in browser settings.');
        return;
      }
      if (alwaysOn()) {
        // FIX: no-speech is normal — restart quickly. Other errors need small delay.
        _restart(e.error === 'no-speech' ? 80 : 300); // was 1000-2000ms
      }
    };

    _recog.onresult = (e) => {
      // Only act on final results — no interim noise
      let txt = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) txt += e.results[i][0].transcript;
      }
      txt = txt.toLowerCase().trim();
      if (!txt) return;

      // Show heard text in UI if element exists
      const heard = document.getElementById('vb-heard');
      if (heard) heard.textContent = txt;

      _handleCmd(txt);
    };

    try {
      _recog.start();
    } catch {
      if (alwaysOn()) _restart(300);
    }
  }

  function stopListening() {
    if (alwaysOn()) {
      speak('Voice is always on in blind mode. Say help for commands.');
      return;
    }
    _active = false;
    clearTimeout(_rTimer);
    if (_recog) { try { _recog.stop(); } catch {} }
    _micUI(false);
  }

  function _restart(ms) {
    clearTimeout(_rTimer);
    _rTimer = setTimeout(() => {
      if (alwaysOn() && !_active) startListening();
    }, ms);
  }

  /* ═══════════════════════════════════════════════════
     MIC UI
     FIX: cache button ref, single className update
     instead of 5 style property writes per cycle
  ═══════════════════════════════════════════════════ */
  function _micUI(on) {
    // Cache the button reference — don't query DOM every cycle
    if (!_micBtn) {
      _micBtn = document.getElementById('bv-mic');
      if (!_micBtn && alwaysOn()) {
        // Inject style once via <style> tag
        if (!document.getElementById('_bv_style')) {
          const s = document.createElement('style');
          s.id = '_bv_style';
          s.textContent =
            '#bv-mic{position:fixed;bottom:1.2rem;right:1.2rem;width:50px;height:50px;' +
            'border-radius:50%;font-size:1.2rem;cursor:pointer;z-index:9999;' +
            'display:flex;align-items:center;justify-content:center;' +
            'border:2px solid #333;background:#252525;color:#888;' +
            'transition:background .15s,border-color .15s}' +
            '#bv-mic.on{background:#3ddc84;color:#000;border-color:#3ddc84}' +
            '#bv-mic.ao{background:#1a3a1a;color:#3ddc84;border-color:#3ddc84}';
          document.head.appendChild(s);
        }
        _micBtn = document.createElement('button');
        _micBtn.id = 'bv-mic';
        _micBtn.setAttribute('aria-label', 'Voice navigation');
        _micBtn.textContent = '🎙️';
        _micBtn.onclick = () => {
          if (alwaysOn()) {
            speak('Voice is always on. Say help for commands.');
          } else {
            if (_active) { stopListening(); speak('Voice off.'); }
            else { speak('Voice on.'); startListening(); }
          }
        };
        document.body.appendChild(_micBtn);
      }
    }
    if (!_micBtn) return;
    // Single className change — no layout thrash
    _micBtn.className = on ? 'on' : (alwaysOn() ? 'ao' : '');
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

    // Global commands
    if (_match(text, ['stop talking','stop','quiet','silence'])) {
      stopSpeaking(); return;
    }
    if (_match(text, ['go home','open home','home page','main page'])) {
      speak('Going home.'); setTimeout(() => window.location.href = 'index.html', 600); return;
    }
    if (_match(text, ['open lessons','go to lessons','lessons','start learning'])) {
      speak('Opening lessons.'); setTimeout(() => window.location.href = 'lesson.html', 600); return;
    }
    if (_match(text, ['open dashboard','teacher dashboard','dashboard'])) {
      speak('Opening dashboard.'); setTimeout(() => window.location.href = 'dashboard.html', 600); return;
    }
    if (_match(text, ['help','what can i say','commands','instructions'])) {
      _speakHelp(); return;
    }
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
      setTimeout(() => { localStorage.clear(); window.location.href = 'welcome.html'; }, 600);
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
      const inp = document.getElementById('uname');
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
    if (_match(text, ['simplify']))       { _switchTab('simplify');  return; }
    if (_match(text, ['translate']))      { _switchTab('translate'); return; }
    if (_match(text, ['voice']))          { _switchTab('voice');     return; }
    if (_match(text, ['ocr','scan']))     { _switchTab('ocr');       return; }
    if (_match(text, ['timer','pomodoro'])) { _switchTab('timer');   return; }
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
        q.scrollIntoView({ behavior: 'instant' }); // FIX: smooth scroll causes layout stutter
        const qq = document.querySelector('.quiz-q');
        speak(qq ? 'Quiz. ' + qq.textContent : 'Quiz.');
      }
      return;
    }
    if (_match(text, ['read question','what is the question'])) {
      const qq = document.querySelector('.quiz-q');
      if (qq) speak(qq.textContent);
      return;
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

    // Option selection: "option 1", "answer two", "choice 3" etc.
    const numMap = { one: 0, two: 1, three: 2, four: 3, '1': 0, '2': 1, '3': 2, '4': 3 };
    const nm = text.match(/(?:option|answer|choice|select|pick)\s*([1-4]|one|two|three|four)/);
    if (nm) {
      const idx = numMap[nm[1]];
      if (idx !== undefined) {
        const btn = document.querySelectorAll('.qopt')[idx];
        if (btn && !btn.disabled) btn.click();
        else if (btn && btn.disabled) speak('Already answered. Say next to continue.');
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
      speak(h ? 'You are on: ' + h.textContent : 'Lesson page.');
      return;
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
      welcome:   'Say your name, then your profile, then enter.',
      home:      'Say a profile: blind, dyslexic, ADHD, deaf, motor, or standard. Or say simplify, translate, timer.',
      lesson:    'Say: read lesson, next, previous, quiz, option 1 to 4, simplify, translate Hindi, or complete.',
      dashboard: 'Say: total students, average progress, need help, export, or refresh.'
    };
    speak(
      'Global commands: go home, open lessons, dashboard, increase text, decrease text, stop, logout. ' +
      (pages[_page()] || '')
    );
  }

  /* ── Font size ── */
  function _changeFont(delta) {
    const root = document.documentElement;
    const cur  = parseInt(getComputedStyle(root).fontSize) || 16;
    root.style.fontSize = Math.max(12, Math.min(26, cur + delta)) + 'px';
  }

  /* ═══════════════════════════════════════════════════
     PAGE INTRO
     FIX: startListening() runs IMMEDIATELY alongside
     speech — not as a callback after speech ends.
     Old code: speak(text, startListening)
       → mic stayed off for entire 5-10 second greeting
     New code: start mic first, then speak in parallel
  ═══════════════════════════════════════════════════ */
  function _intro() {
    const pg      = _page();
    const profile = localStorage.getItem('brainies_profile') || 'standard';
    const name    = localStorage.getItem('brainies_name') || '';
    const greet   = name ? 'Welcome back ' + name + '. ' : '';

    // Start mic immediately — do not wait for speech to finish
    if (alwaysOn()) startListening();

    if (pg === 'home') {
      speak(greet + 'Your profile is ' + profile + '. Say open lessons to start. Say help for commands.');
    } else if (pg === 'lesson') {
      const h = document.querySelector('.lesson-title');
      speak(greet + 'Lesson: ' + (h ? h.textContent.trim() + '. ' : '') + 'Say read lesson or quiz. Say help for all commands.');
    } else if (pg === 'dashboard') {
      speak(greet + 'Teacher dashboard. Say total students or help.');
    }
  }

  /* ═══════════════════════════════════════════════════
     BOOT
  ═══════════════════════════════════════════════════ */
  function _boot() {
    const pg      = _page();
    const profile = localStorage.getItem('brainies_profile');

    document.addEventListener('keydown', e => {
      if (e.altKey && e.key === 'v') {
        if (alwaysOn()) {
          speak('Voice is always on in blind mode. Say help for commands.');
        } else {
          if (_active) { stopListening(); speak('Voice off.'); }
          else { speak('Voice on.'); startListening(); }
        }
      }
      if (e.key === 'Escape') stopSpeaking();
    });

    // Welcome page has its own engine — skip
    if (pg === 'welcome') return;

    if (profile === 'blind') {
      document.body.classList.add('mode-blind');
      const bar = document.getElementById('voice-bar');
      if (bar) bar.className = 'voice-bar show';
    }

    const shouldAutoStart = (profile === 'blind') || (pg === 'home');
    if (!shouldAutoStart) return;

    // FIX: 400ms delay (was 700ms) — page has painted by then
    const run = () => setTimeout(_intro, 400);
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
    isAlwaysOn: alwaysOn
  };

  _boot();
})();
