/**
 * Simple Web Audio ringtone for incoming softphone calls.
 * Works without external audio files; stops cleanly when the call ends.
 */

let audioCtx: AudioContext | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let active = false

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!audioCtx) audioCtx = new AC()
  return audioCtx
}

function beepOnce(ctx: AudioContext, freq: number, durationMs: number) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = "sine"
  osc.frequency.value = freq
  gain.gain.value = 0.0001
  osc.connect(gain)
  gain.connect(ctx.destination)

  const now = ctx.currentTime
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000)

  osc.start(now)
  osc.stop(now + durationMs / 1000 + 0.05)
}

/** Dual-tone ring pattern roughly every 2 seconds */
export function startIncomingRingtone(): void {
  if (active) return
  const ctx = getCtx()
  if (!ctx) return
  active = true

  void ctx.resume().catch(() => {})

  const ring = () => {
    if (!active || !audioCtx) return
    beepOnce(audioCtx, 440, 350)
    setTimeout(() => {
      if (active && audioCtx) beepOnce(audioCtx, 480, 350)
    }, 400)
  }

  ring()
  intervalId = setInterval(ring, 2000)
}

export function stopIncomingRingtone(): void {
  active = false
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}
