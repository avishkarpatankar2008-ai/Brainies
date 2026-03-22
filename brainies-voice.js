/**
 * BRAINIES VOICE ENGINE v3 — Performance Edition
 *
 * ROOT CAUSES OF LAG FIXED HERE:
 * 1. continuous=true  → held open audio stream + processed audio non-stop → HIGH CPU
 *    Fixed: continuous=false + instant auto-restart (80ms gap)
 * 2. maxAlternatives=3 → speech engine ran 3 transcriptions per word → 3× CPU
 *    Fixed: maxAlternatives=1
 * 3. speechSynthesis.cancel() before EVERY drain() call → stutter + 200-300ms dead time
 *    Fixed: only cancel when queue is replacing an active utterance
 * 4. _micUI() wrote to DOM on every onstart/onend → layout thrash every recognition cycle
 *    Fixed: cache the button ref, only update class not full style object
 * 5. startListening() called as callback AFTER intro speech finished → mic dormant for
 *    entire greeting (5-10 sec). Fixed: start mic immediately, speak in parallel
 * 6. restart delays: 600ms normal, 1000-2000ms on errors → noticeable dead silence
 *    Fixed: 80ms normal, 300ms on errors, 80ms no-speech
 */
(function () {
  'use strict';

  const LANG = 'en-IN';

  /* ─────────────────────────────────────────────
     TTS — queued, stutter-free
     FIXED: cancel only when draining a NEW item,
     not on every single drain() tick
  ───────────────────────────────────────────── */
  let _q = [], _busy = false;

  function speak(text, cb) {
    if (!('speechSynthesis' in window)) { if (cb) cb(); return; }
    // If cb supplied, replace queue so it runs next; otherwise append
    if (cb) _q = [{ text, cb }];
    else _q.push({ text, cb: null });
    if (!_busy) _drain();
  }

  function _drain() {
    if (!_q.length) { _busy = false; return; }
    _busy = true;
    const { text, cb } = _q.shift();
    // Only cancel if something is actively speaking — avoids stutter on fresh calls
    if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG; u.rate = 0.92; u.volume = 1;
    u.onend = u.onerror = () => { _busy = false; if (cb) cb(); _drain(); };
    window.speechSynthesis.speak(u);
    _caption(text);
  }

  function stopSpeaking() {
    _q = []; _busy = false;
    window.speechSynthesis.cancel();
  }

  function _caption(text) {
    const el = document.getElementById('caption-text') || document.getElementById('cap-txt');
    if (el) el.textContent = text;
  }

  /* ─────────────────────────────────────────────
     MIC ENGINE
     FIXED:
     • continuous=false  — no open mic stream holding CPU
     • maxAlternatives=1 — 3× less transcription work
     • restart gap 80ms  — was 600-2000ms
     • _micUI cached ref — no DOM query every cycle
  ───────────────────────────────────────────── */
  let recog = null, active = false, _rTimer = null, _micBtn = null;

  const alwaysOn = () =>
    localStorage.getItem('brainies_always_voice') === '1' ||
    localStorage.getItem('brainies_profile') === 'blind';

  function startListening() {
    if (active) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    recog = new SR();
    recog.lang = LANG;
    recog.continuous      = false;  // ← was true: open stream + constant CPU
    recog.interimResults  = false;  // ← prevents per-syllable onresult firing
    recog.maxAlternatives = 1;      // ← was 3: 3× transcription work

    recog.onstart = () => {
      active = true;
      _micUI(true);
      const bar = document.getElementById('voice-bar');
      if (bar && alwaysOn()) bar.className = 'voice-bar show';
    };

    recog.onend = () => {
      active = false;
      _micUI(false);
      if (alwaysOn()) _restart(80);  // ← was 600ms
    };

    recog.onerror = (e) => {
      active = false;
      _micUI(false);
      if (e.error === 'not-allowed') {
        speak('Microphone blocked. Please allow microphone in browser settings.');
        return;
      }
      if (alwaysOn()) _restart(e.error === 'no-speech' ? 80 : 300); // ← was 1000-2000ms
    };

    recog.onresult = (e) => {
      // Only final results — no interim noise
      let txt = '';
      for (let i = e.resultIndex; i < e.results.length; i++)
        if (e.results[i].isFinal) txt += e.results[i][0].transcript;
      txt = txt.toLowerCase().trim();
      if (!txt) return;
      const heard = document.getElementById('vb-heard');
      if (heard) heard.textContent = txt;
      _handleCmd(txt);
    };

    try { recog.start(); } catch { if (alwaysOn()) _restart(300); }
  }

  function stopListening() {
    if (alwaysOn()) { speak('Voice is always on for blind mode.'); return; }
    active = false;
    clearTimeout(_rTimer);
    if (recog) { try { recog.stop(); } catch {} }
    _micUI(false);
  }

  function _restart(ms) {
    clearTimeout(_rTimer);
    _rTimer = setTimeout(() => { if (alwaysOn() && !active) startListening(); }, ms);
  }

  /* ─────────────────────────────────────────────
     MIC UI — FIXED: cache button ref, minimal DOM writes
  ───────────────────────────────────────────── */
  function _micUI(on) {
    if (!_micBtn) {
      _micBtn = document.getElementById('bv-mic');
      if (!_micBtn && alwaysOn()) {
        _micBtn = document.createElement('button');
        _micBtn.id = 'bv-mic';
        _micBtn.setAttribute('aria-label', 'Voice navigation');
        // Use className not style.cssText for cheaper updates
        _micBtn.className = 'bv-mic-btn';
        _micBtn.title = 'Voice navigation';
        _micBtn.textContent = '🎙️';
        // Inject minimal style once via <style> tag, not inline
        if (!document.getElementById('bv-mic-style')) {
          const s = document.createElement('style');
          s.id = 'bv-mic-style';
          s.textContent = '.bv-mic-btn{position:fixed;bottom:1.25rem;right:1.25rem;width:50px;height:50px;border-radius:50%;border:2px solid #333;font-size:1.2rem;cursor:pointer;z-index:9999;display:flex;align-items:center;justify-content:center;background:#252525;color:#888;transition:background .15s,border-color .15s}.bv-mic-btn.on{background:#3ddc84;color:#000;border-color:#3ddc84}.bv-mic-btn.always{background:#1a3a1a;color:#3ddc84;border-color:#3ddc84}';
          document.head.appendChild(s);
        }
        _micBtn.onclick = () => {
          if (alwaysOn()) { speak('Voice always on. Say help for commands.'); return; }
          if (active) { stopListening(); speak('Voice off.'); }
          else { speak('Voice on.'); startListening(); }
        };
        document.body.appendChild(_micBtn);
      }
    }
    if (!_micBtn) return;
    // Single className update — no style object writes, no layout thrash
    const isAO = alwaysOn();
    _micBtn.className = 'bv-mic-btn' + (on ? ' on' : (isAO ? ' always' : ''));
  }

  /* ─────────────────────────────────────────────
     PAGE DETECTION
  ───────────────────────────────────────────── */
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

  /* ─────────────────────────────────────────────
     COMMAND ROUTER
  ───────────────────────────────────────────── */
  function _handleCmd(text) {
    const pg = _page();

    if (_match(text, ['stop talking','stop','quiet','silence']))         { stopSpeaking(); return; }
    if (_match(text, ['go home','open home','home page','main page']))   { speak('Going home.'); setTimeout(()=>window.location.href='index.html',600); return; }
    if (_match(text, ['open lessons','go to lessons','lessons','start learning'])) { speak('Opening lessons.'); setTimeout(()=>window.location.href='lesson.html',600); return; }
    if (_match(text, ['open dashboard','teacher dashboard','dashboard'])) { speak('Opening dashboard.'); setTimeout(()=>window.location.href='dashboard.html',600); return; }
    if (_match(text, ['help','what can i say','commands','instructions'])) { _speakHelp(); return; }
    if (_match(text, ['increase text','bigger text','larger text','zoom in'])) { _changeFont(2); speak('Bigger.'); return; }
    if (_match(text, ['decrease text','smaller text','zoom out']))            { _changeFont(-2); speak('Smaller.'); return; }
    if (_match(text, ['repeat','say again','read again'])) {
      if (pg === 'lesson') { const c = document.getElementById('lesson-content'); if (c) speak(c.innerText.substring(0, 1200)); }
      return;
    }
    if (_match(text, ['logout','log out','sign out','exit'])) {
      speak('Logging out.');
      setTimeout(() => { localStorage.clear(); window.location.href = 'welcome.html'; }, 600);
      return;
    }

    if (pg === 'home')      _homeCmd(text);
    else if (pg === 'lesson')    _lessonCmd(text);
    else if (pg === 'dashboard') _dashCmd(text);
    else if (pg === 'welcome')   _welcomeCmd(text);
  }

  function _welcomeCmd(text) {
    if (_match(text, ['enter','go','start','continue'])) {
      const name = document.getElementById('uname')?.value.trim();
      if (!name) speak('Please say your name first.');
      else { speak('Entering.'); if (window.enter) window.enter(); }
    }
  }

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
        speak(p + ' mode activated.');
        return;
      }
    }
    if (_match(text, ['simplify']))  { _switchTab('simplify'); return; }
    if (_match(text, ['translate'])) { _switchTab('translate'); return; }
    if (_match(text, ['voice']))     { _switchTab('voice'); return; }
    if (_match(text, ['ocr','scan'])) { _switchTab('ocr'); return; }
    if (_match(text, ['timer','pomodoro'])) { _switchTab('timer'); return; }
    speak('Say a profile name or feature. Say help for commands.');
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

  function _lessonCmd(text) {
    if (_match(text, ['next','next lesson','continue','complete','done','finish'])) {
      speak('Next lesson.'); if (window.nextLesson) window.nextLesson(); return;
    }
    if (_match(text, ['back','previous','go back','last lesson'])) {
      speak('Previous.'); if (window.prevLesson) window.prevLesson(); return;
    }
    if (_match(text, ['read','read lesson','read this','read aloud'])) {
      const c = document.getElementById('lesson-content');
      if (c) speak(c.innerText.substring(0, 1400)); return;
    }
    if (_match(text, ['simplify','make it simple','easy language'])) {
      speak('Simplifying.'); if (window.simplifyLesson) window.simplifyLesson(); return;
    }
    if (_match(text, ['restore','original'])) {
      speak('Restoring.'); if (window.restoreLesson) window.restoreLesson(); return;
    }
    if (_match(text, ['quiz','question'])) {
      const q = document.querySelector('.quiz-box');
      if (q) { q.scrollIntoView({ behavior: 'instant' }); const qq = document.querySelector('.quiz-q'); speak(qq ? qq.textContent : 'Quiz.'); }
      return;
    }
    if (_match(text, ['read options','list options','read answers'])) {
      const opts = document.querySelectorAll('.qopt');
      if (opts.length) { let m = 'Options: '; opts.forEach((o,i) => { m += (i+1) + ': ' + o.textContent.trim() + '. '; }); speak(m); }
      return;
    }
    const numMap = { one:0,two:1,three:2,four:3,'1':0,'2':1,'3':2,'4':3 };
    const nm = text.match(/(?:option|answer|choice|select|pick)\s*([1-4]|one|two|three|four)/);
    if (nm) {
      const idx = numMap[nm[1]];
      if (idx !== undefined) {
        const btn = document.querySelectorAll('.qopt')[idx];
        if (btn && !btn.disabled) btn.click();
        else if (btn?.disabled) speak('Already answered. Say next.');
      }
      return;
    }
    if (_match(text, ['hindi']))   { speak('Hindi.'); if (window.translateLesson) window.translateLesson('hi'); return; }
    if (_match(text, ['marathi'])) { speak('Marathi.'); if (window.translateLesson) window.translateLesson('mr'); return; }
    if (_match(text, ['tamil']))   { speak('Tamil.'); if (window.translateLesson) window.translateLesson('ta'); return; }
    if (_match(text, ['telugu']))  { speak('Telugu.'); if (window.translateLesson) window.translateLesson('te'); return; }
    if (_match(text, ['scan','ocr'])) { if (window.openOCR) window.openOCR(); return; }
    speak('Say: read, next, previous, quiz, option 1 to 4, simplify, or help.');
  }

  function _dashCmd(text) {
    if (_match(text, ['total students','how many students'])) { const e = document.getElementById('s-total'); speak(e ? e.textContent + ' students.' : 'Not available.'); return; }
    if (_match(text, ['average progress']))                   { const e = document.getElementById('s-avg'); speak(e ? 'Average: ' + e.textContent : 'Not available.'); return; }
    if (_match(text, ['need help','alerts']))                  { const e = document.getElementById('s-alerts'); speak(e ? e.textContent + ' need attention.' : 'Not available.'); return; }
    if (_match(text, ['export','download']))                   { speak('Exporting.'); if (window.exportCSV) window.exportCSV(); return; }
    if (_match(text, ['refresh','reload']))                    { speak('Refreshing.'); if (window.fetchData) window.fetchData(); return; }
    speak('Say: total students, average progress, alerts, export, or refresh.');
  }

  function _speakHelp() {
    const pages = {
      welcome:   'Say your name, then your profile, then enter.',
      home:      'Say blind, dyslexic, ADHD, deaf, motor, or standard. Or say simplify, translate, timer.',
      lesson:    'Say: read lesson, next, previous, quiz, option 1 to 4, simplify, translate Hindi.',
      dashboard: 'Say: total students, average progress, alerts, export, refresh.'
    };
    speak('Global: go home, open lessons, dashboard, increase text, stop, logout. ' + (pages[_page()] || ''));
  }

  function _changeFont(delta) {
    const root = document.documentElement;
    const cur  = parseInt(getComputedStyle(root).fontSize) || 16;
    root.style.fontSize = Math.max(12, Math.min(26, cur + delta)) + 'px';
  }

  /* ─────────────────────────────────────────────
     INTRO — FIXED: start mic immediately, don't
     wait for intro speech to finish first.
     Was: speak(intro, startListening) → mic dormant
     for entire 5-10 second greeting.
     Now: startListening() runs at same time as speak()
  ───────────────────────────────────────────── */
  function _intro() {
    const pg      = _page();
    const profile = localStorage.getItem('brainies_profile') || 'standard';
    const name    = localStorage.getItem('brainies_name') || '';
    const greet   = name ? 'Welcome back ' + name + '. ' : '';

    // Start mic immediately — don't block it behind speech
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

  /* ─────────────────────────────────────────────
     BOOT
  ───────────────────────────────────────────── */
  function _boot() {
    const pg      = _page();
    const profile = localStorage.getItem('brainies_profile');

    document.addEventListener('keydown', e => {
      if (e.altKey && e.key === 'v') {
        if (alwaysOn()) { speak('Voice always on. Say help.'); return; }
        if (active) { stopListening(); speak('Voice off.'); }
        else { speak('Voice on.'); startListening(); }
      }
      if (e.key === 'Escape') stopSpeaking();
    });

    if (pg === 'welcome') return; // welcome has its own engine

    if (profile === 'blind') {
      document.body.classList.add('mode-blind');
      const bar = document.getElementById('voice-bar');
      if (bar) bar.className = 'voice-bar show';
    }

    const shouldAutoStart = (profile === 'blind') || (pg === 'home');
    if (!shouldAutoStart) return;

    // FIXED: 400ms delay (was 700ms), and mic starts in parallel with speech
    const run = () => setTimeout(_intro, 400);
    if (document.readyState === 'complete') run();
    else window.addEventListener('load', run);
  }

  /* ─────────────────────────────────────────────
     PUBLIC API
  ───────────────────────────────────────────── */
  window.BV = { speak, stopSpeaking, startListening, stopListening, isAlwaysOn: alwaysOn };

  _boot();
})();
