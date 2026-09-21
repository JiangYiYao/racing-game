export type GhostSample = {
  t: number
  p: [number, number, number]
  q: [number, number, number, number]
}

export type GhostRun = {
  time: number
  samples: GhostSample[]
}

export const GHOST_STORAGE_KEY = 'pmndrs.racing-game.ghost-best'

const STORAGE_VERSION = 1
const SAMPLE_INTERVAL = 1000 / 20

type StoredGhost = {
  version: typeof STORAGE_VERSION
  run: GhostRun
}

let samples: GhostSample[] = []
let lastSampleT = Number.NEGATIVE_INFINITY

const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

const isSample = (v: unknown): v is GhostSample => {
  if (!v || typeof v !== 'object') return false
  const sample = v as GhostSample
  return (
    isFiniteNumber(sample.t) &&
    Array.isArray(sample.p) &&
    sample.p.length === 3 &&
    sample.p.every(isFiniteNumber) &&
    Array.isArray(sample.q) &&
    sample.q.length === 4 &&
    sample.q.every(isFiniteNumber)
  )
}

const isGhostRun = (v: unknown): v is GhostRun => {
  if (!v || typeof v !== 'object') return false
  const run = v as GhostRun
  return isFiniteNumber(run.time) && run.time > 0 && Array.isArray(run.samples) && run.samples.length > 1 && run.samples.every(isSample)
}

export function loadGhostRun(): GhostRun | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(GHOST_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredGhost
    if (parsed?.version !== STORAGE_VERSION || !isGhostRun(parsed.run)) return null
    return parsed.run
  } catch {
    return null
  }
}

export function saveGhostRun(run: GhostRun): void {
  try {
    if (typeof localStorage === 'undefined') return
    const stored: StoredGhost = { version: STORAGE_VERSION, run }
    localStorage.setItem(GHOST_STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Ignore quota / private-mode failures; gameplay continues without persistence.
  }
}

export function resetGhostRecording(): void {
  samples = []
  lastSampleT = Number.NEGATIVE_INFINITY
}

export function recordGhostSample(
  t: number,
  position: { x: number; y: number; z: number },
  quaternion: { x: number; y: number; z: number; w: number },
  force = false,
): void {
  if (!force && samples.length > 0 && t - lastSampleT < SAMPLE_INTERVAL) return
  lastSampleT = t
  samples.push({
    t,
    p: [position.x, position.y, position.z],
    q: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
  })
}

export function commitGhostRun(time: number, existing: GhostRun | null): GhostRun | null {
  if (time <= 0 || samples.length < 2) return null
  if (existing && time >= existing.time) return null
  const run: GhostRun = { time, samples: samples.slice() }
  saveGhostRun(run)
  return run
}

export function findGhostPose(runSamples: GhostSample[], t: number): { a: GhostSample; b: GhostSample; alpha: number } {
  const first = runSamples[0]
  const last = runSamples[runSamples.length - 1]
  if (t <= first.t) return { a: first, b: first, alpha: 0 }
  if (t >= last.t) return { a: last, b: last, alpha: 0 }

  let lo = 0
  let hi = runSamples.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (runSamples[mid].t <= t) lo = mid
    else hi = mid
  }

  const a = runSamples[lo]
  const b = runSamples[hi]
  const span = b.t - a.t
  return { a, b, alpha: span <= 0 ? 0 : (t - a.t) / span }
}
