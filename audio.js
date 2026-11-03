/* Plays the intro song once the intro has finished, fading it in, and reads
   its bass and treble levels every frame. Each level is scaled against the
   loudest recent value of its band, so any song drives the stars at a similar
   strength. */
const FADE_IN = 4;
const VOLUME = 0.08;
const RESTART_DELAY = 4;
const FFT_SIZE = 1024;
const BANDS = { low: [1, 6], high: [90, 230] };
const PEAK_DECAY = 0.995;
const PEAK_FLOOR = 0.01;
const SENSITIVITY = 1.6;
const ATTACK = 0.6;
const RELEASE = 0.22;

export class SongPlayer {
  constructor(url) {
    this.audio = new Audio(url);
    this.audio.preload = 'auto';
    /* When the song ends, it waits a few seconds and then starts again. */
    this.audio.addEventListener('ended', () => {
      setTimeout(() => this.restart(), RESTART_DELAY * 1000);
    });
    this.started = false;
    this.volume = VOLUME;
    this.analyser = null;
    this.gain = null;
    this.data = null;
    this.peak = { low: PEAK_FLOOR, high: PEAK_FLOOR };
    this.level = { low: 0, high: 0 };
  }

  /* Called once, when the intro has finished. */
  start() {
    if (this.started) return;
    this.started = true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.5;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.ctx.createMediaElementSource(this.audio).connect(this.analyser);
    this.analyser.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.data = new Uint8Array(this.analyser.frequencyBinCount);

    /* Browsers may keep audio silent until the first click or key press. */
    const unlock = () => {
      if (this.ctx.state !== 'running') this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.play();
  }

  restart() {
    this.audio.currentTime = 0;
    this.play();
  }

  play() {
    this.audio.play().then(
      () => this.fadeIn(),
      () => this.waitForClick(),
    );
  }

  waitForClick() {
    console.info('Audio bloqueado por el navegador: haz clic en la página para escucharlo.');
    const again = () => this.play();
    window.addEventListener('pointerdown', again, { once: true });
    window.addEventListener('keydown', again, { once: true });
  }

  fadeIn() {
    this.ctx.resume();
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(this.volume, now + FADE_IN);
  }

  /* Takes a value between 0 and 1; before the song starts it is only remembered. */
  setVolume(value) {
    this.volume = value;
    if (!this.gain) return;
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(value, now, 0.05);
  }

  /* Returns the smoothed { low, high } levels, each between 0 and 1. */
  update() {
    if (!this.analyser) return this.level;
    this.analyser.getByteFrequencyData(this.data);
    for (const key of Object.keys(BANDS)) {
      const [from, to] = BANDS[key];
      let sum = 0;
      for (let i = from; i < to; i++) sum += this.data[i];
      this.follow(key, sum / ((to - from) * 255));
    }
    return this.level;
  }

  follow(key, value) {
    this.peak[key] = Math.max(value, this.peak[key] * PEAK_DECAY, PEAK_FLOOR);
    const target = Math.min(1, (SENSITIVITY * value) / this.peak[key]);
    const rate = target > this.level[key] ? ATTACK : RELEASE;
    this.level[key] += (target - this.level[key]) * rate;
  }
}
