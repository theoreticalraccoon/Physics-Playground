// Small synthesised sound set.
//
// Synthesised rather than sampled so the stand carries no audio files: nothing to
// download over the venue wifi, nothing to go missing, and the whole thing stays a
// handful of text files. A fair hall is loud, so these are short, bright and few —
// enough to confirm a tap landed and to make a hit feel like a hit.

const CUES = {
  tick: { freq: 660, to: 660, dur: 0.04, type: 'square', gain: 0.05 },
  launch: { freq: 220, to: 660, dur: 0.16, type: 'triangle', gain: 0.12 },
  hit: { freq: 523.25, to: 1046.5, dur: 0.30, type: 'sine', gain: 0.16, chord: [1, 1.25, 1.5] },
  miss: { freq: 320, to: 150, dur: 0.22, type: 'sine', gain: 0.10 },
  clack: { freq: 900, to: 300, dur: 0.09, type: 'square', gain: 0.09 },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  /**
   * Browsers refuse to start audio until the user has interacted, so the context is
   * created on the first touch rather than at load. Called from every input path.
   */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    } catch {
      // No audio available. The stand is perfectly usable silent.
      this.enabled = false;
    }
  }

  play(name) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const cue = CUES[name];
    if (!cue) return;

    const now = this.ctx.currentTime;
    // A chord for the win sound, a single voice for everything else.
    for (const mult of cue.chord ?? [1]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = cue.type;
      osc.frequency.setValueAtTime(cue.freq * mult, now);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(cue.to * mult, 1), now + cue.dur,
      );

      const level = cue.gain / (cue.chord?.length ?? 1);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(level, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + cue.dur);

      osc.connect(gain).connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + cue.dur + 0.02);
    }
  }

  /** Let whoever is running the stand turn it off if the hall is loud enough. */
  setEnabled(on) {
    this.enabled = on;
  }
}
