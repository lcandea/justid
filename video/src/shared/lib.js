// Shared motion helpers for the JustID demo scenes (window.JV). Every helper adds tweens to a paused GSAP
// timeline at an explicit time, so each frame is a pure function of timeline time (HyperFrames seeks frames).
// No timers, no Date, no randomness. Use fromTo everywhere (scenes are re-seeked).
(function () {
  const JV = {};

  /** Per-word entrance: blur 8px→0 and opacity 0→1, words `gap` s apart. Returns the end time. */
  JV.wordsIn = function (tl, scope, selector, at, gap = 0.07, dur = 0.16) {
    const els = scope.querySelectorAll(selector);
    els.forEach((el, i) => {
      tl.fromTo(el, { opacity: 0, filter: 'blur(8px)', y: 18 }, { opacity: 1, filter: 'blur(0px)', y: 0, duration: dur, ease: 'power4.out' }, at + i * gap);
    });
    return at + (els.length - 1) * gap + dur;
  };

  /** Exit: quick blur-out of the given elements together. */
  JV.blurOut = function (tl, targets, at, dur = 0.18) {
    tl.fromTo(targets, { opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(8px)', duration: dur, ease: 'power3.in', immediateRender: false }, at);
    return at + dur;
  };

  /**
   * Tap indicator: travel to (x, y) in the scene's px, press, release. The element must be a .tap.
   * Returns the press time (when the UI should react).
   */
  JV.tap = function (tl, tapEl, from, to, at, travel = 0.45) {
    tl.fromTo(tapEl, { x: from.x, y: from.y, opacity: 0, scale: 1.25 }, { x: to.x, y: to.y, opacity: 1, scale: 1, duration: travel, ease: 'power3.out', immediateRender: false }, at);
    const press = at + travel + 0.05;
    tl.to(tapEl, { scale: 0.78, backgroundColor: 'rgba(215,255,58,.55)', borderColor: 'rgba(215,255,58,1)', duration: 0.08, ease: 'power2.out' }, press);
    tl.to(tapEl, { scale: 1, backgroundColor: 'rgba(243,241,236,.28)', borderColor: 'rgba(243,241,236,.9)', duration: 0.18, ease: 'power2.out' }, press + 0.1);
    return press;
  };

  /** Typewriter: reveal `text` into `el` at `cps` characters per second, starting at `at`. Returns the end time. */
  JV.type = function (tl, el, text, at, cps = 22) {
    const state = { n: 0 };
    const dur = text.length / cps;
    tl.fromTo(state, { n: 0 }, {
      n: text.length, duration: dur, ease: 'none', immediateRender: false,
      onUpdate: () => { el.textContent = text.slice(0, Math.round(state.n)); },
    }, at);
    tl.set(el, { textContent: '' }, 0); // empty before typing starts, also on seek-back
    return at + dur;
  };

  /**
   * Camera move on a wrapper: scale + translate so the box {x, y, w, h} (wrapper-local px, before scaling)
   * is centred on (cx, cy) of the scene at the given zoom. One move = one tween, ease both ways.
   */
  JV.camera = function (tl, wrapper, box, zoom, cx, cy, at, dur = 0.55, ease = 'power2.inOut') {
    const x = cx - (box.x + box.w / 2) * zoom;
    const y = cy - (box.y + box.h / 2) * zoom;
    tl.to(wrapper, { x, y, scale: zoom, duration: dur, ease, transformOrigin: '0 0' }, at);
    return at + dur;
  };

  /** Brand wipe: a redaction bar sweeps across the frame (left→right), covering it; returns the covered time. */
  JV.barWipe = function (tl, barEl, at, dur = 0.32) {
    tl.set(barEl, { xPercent: -110 }, 0); // off-screen until the wipe starts, also on seek-back
    tl.fromTo(barEl, { xPercent: -110 }, { xPercent: 0, duration: dur, ease: 'power3.in', immediateRender: false }, at);
    return at + dur;
  };

  window.JV = JV;
})();
