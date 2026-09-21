import './memory-storage'

import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from 'three'

import {
  GHOST_SAMPLE_HZ,
  GHOST_STORAGE_KEY,
  commitGhostRun,
  findGhostPose,
  ghostElapsed,
  isNewBestTime,
  loadGhostRun,
  recordGhostSample,
  recordGhostSampleFromChassis,
  resetGhostRecording,
  saveGhostRun,
} from '../src/ghost'
import { getState, position as spawnPosition, setState } from '../src/store'

import type { GhostRun, GhostSample } from '../src/ghost'

const identityQuat: [number, number, number, number] = [0, 0, 0, 1]
const sampleInterval = 1000 / GHOST_SAMPLE_HZ

const pose = (t: number, x: number, z = 0): GhostSample => ({
  t,
  p: [x, 0.75, z],
  q: identityQuat,
})

const sampleAt = (t: number, x: number, y = 1, z = 2) => {
  recordGhostSample(t, { x, y, z }, { x: 0, y: 0, z: 0, w: 1 })
}

const cannonStyleChassis = (live: Vector3, liveQuat = new Quaternion(), spawn = new Vector3(...spawnPosition)) => {
  const chassis = new Object3D()
  chassis.position.copy(spawn)
  chassis.quaternion.setFromEuler(new Euler(0, Math.PI / 2 + 0.35, 0))
  chassis.updateMatrix()
  chassis.matrixAutoUpdate = false
  chassis.matrix.copy(new Matrix4().compose(live, liveQuat, new Vector3(1, 1, 1)))
  chassis.updateMatrixWorld(true)
  return chassis
}

const resetStoreGhost = () => {
  resetGhostRecording()
  localStorage.clear()
  setState({
    bestTime: 0,
    finished: 0,
    ghost: null,
    newBest: false,
    start: 0,
  })
}

describe('ghost recording', () => {
  beforeEach(() => {
    resetGhostRecording()
    localStorage.clear()
  })

  it('records the first sample immediately, then throttles to 20 Hz', () => {
    sampleAt(0, 0)
    sampleAt(sampleInterval - 1, 1)
    sampleAt(sampleInterval, 2)
    sampleAt(sampleInterval * 2 - 1, 3)
    sampleAt(sampleInterval * 2, 4)

    const run = commitGhostRun(sampleInterval * 2, null)
    assert.ok(run)
    assert.equal(run.samples.length, 3)
    assert.deepEqual(
      run.samples.map((sample) => sample.t),
      [0, sampleInterval, sampleInterval * 2],
    )
    assert.deepEqual(
      run.samples.map((sample) => sample.p[0]),
      [0, 2, 4],
    )
  })

  it('accepts a forced finish sample even inside the 20 Hz window', () => {
    sampleAt(0, 0)
    sampleAt(10, 9, 9, 9)
    recordGhostSample(12, { x: 5, y: 1, z: 8 }, { x: 0, y: 0, z: 0, w: 1 }, true)

    const run = commitGhostRun(12, null)
    assert.ok(run)
    assert.equal(run.samples.length, 2)
    assert.deepEqual(run.samples[1], {
      t: 12,
      p: [5, 1, 8],
      q: identityQuat,
    })
  })

  it('reads cannon world pose instead of the stale local spawn transform', () => {
    const liveQuat = new Quaternion().setFromEuler(new Euler(0.1, 0.8, -0.2))
    const chassis = cannonStyleChassis(new Vector3(42, 3, -17), liveQuat)

    assert.deepEqual(chassis.position.toArray(), [...spawnPosition])
    assert.notEqual(chassis.position.x, 42)

    recordGhostSampleFromChassis(0, chassis)
    recordGhostSampleFromChassis(sampleInterval, chassis, true)

    const run = commitGhostRun(sampleInterval, null)
    assert.ok(run)
    assert.deepEqual(run.samples[0].p, [42, 3, -17])
    assert.ok(Math.abs(run.samples[0].q[0] - liveQuat.x) < 1e-6)
    assert.ok(Math.abs(run.samples[0].q[1] - liveQuat.y) < 1e-6)
    assert.ok(Math.abs(run.samples[0].q[2] - liveQuat.z) < 1e-6)
    assert.ok(Math.abs(run.samples[0].q[3] - liveQuat.w) < 1e-6)
  })

  it('does not commit a run with fewer than two samples', () => {
    sampleAt(0, 0)
    assert.equal(commitGhostRun(1000, null), null)
    assert.equal(localStorage.getItem(GHOST_STORAGE_KEY), null)
  })
})

describe('playback clock', () => {
  it('snaps to 0 when the race is not started, matching reset', () => {
    assert.equal(ghostElapsed(0, 12_000), 0)
    assert.equal(ghostElapsed(5_000, 5_250), 250)
  })

  it('holds the first sample until the query time reaches it, then interpolates', () => {
    const samples = [pose(16, 0), pose(116, 10)]
    const before = findGhostPose(samples, 0)
    assert.equal(before.a, samples[0])
    assert.equal(before.b, samples[0])
    assert.equal(before.alpha, 0)

    const mid = findGhostPose(samples, 66)
    assert.equal(mid.a, samples[0])
    assert.equal(mid.b, samples[1])
    assert.equal(mid.alpha, 0.5)
  })

  it('holds the last sample after the recorded finish, matching a frozen HUD clock', () => {
    const samples = [pose(0, 0), pose(4_000, 40)]
    const elapsed = ghostElapsed(1_000, 1_000 + 9_000)
    const poseAt = findGhostPose(samples, elapsed)
    assert.equal(elapsed, 9_000)
    assert.equal(poseAt.a, samples[1])
    assert.equal(poseAt.alpha, 0)
  })

  it('uses alpha 0 when neighboring samples share a timestamp', () => {
    const samples = [pose(100, 1), pose(100, 2), pose(200, 3)]
    const held = findGhostPose(samples, 100)
    assert.equal(held.alpha, 0)
    assert.equal(held.a.p[0], 1)
  })
})

describe('best-time updates', () => {
  beforeEach(() => {
    resetGhostRecording()
    localStorage.clear()
  })

  it('saves the first valid run and rejects slower or equal times', () => {
    assert.equal(isNewBestTime(8_000, null), true)
    assert.equal(isNewBestTime(8_000, { time: 8_000, samples: [pose(0, 0), pose(8_000, 1)] }), false)
    assert.equal(isNewBestTime(7_999, { time: 8_000, samples: [pose(0, 0), pose(8_000, 1)] }), true)

    sampleAt(0, 0)
    sampleAt(sampleInterval, 1)
    const first = commitGhostRun(8_000, null)
    assert.ok(first)
    assert.equal(first.time, 8_000)

    resetGhostRecording()
    sampleAt(0, 2)
    sampleAt(sampleInterval, 3)
    assert.equal(commitGhostRun(8_000, first), null)
    assert.equal(commitGhostRun(8_001, first), null)
    assert.equal(loadGhostRun()?.time, 8_000)

    resetGhostRecording()
    sampleAt(0, 4)
    sampleAt(sampleInterval, 5)
    const faster = commitGhostRun(7_500, first)
    assert.ok(faster)
    assert.equal(loadGhostRun()?.time, 7_500)
    assert.equal(loadGhostRun()?.samples[0].p[0], 4)
  })
})

describe('retry / reset', () => {
  beforeEach(resetStoreGhost)
  afterEach(resetStoreGhost)

  it('clears the in-progress recording without erasing a saved best', () => {
    sampleAt(0, 9)
    sampleAt(sampleInterval, 10)
    const saved = commitGhostRun(4_000, null)
    assert.ok(saved)
    setState({ ghost: saved, bestTime: saved.time })

    sampleAt(0, 99)
    getState().actions.reset()

    assert.equal(getState().start, 0)
    assert.equal(getState().finished, 0)
    assert.equal(ghostElapsed(getState().start, Date.now()), 0)
    assert.equal(getState().ghost?.time, 4_000)
    assert.equal(loadGhostRun()?.time, 4_000)
    assert.equal(commitGhostRun(1_000, getState().ghost), null)
  })

  it('starts a new recording buffer on the start-line trigger', () => {
    sampleAt(0, 1)
    sampleAt(sampleInterval, 2)
    getState().actions.onStart()
    assert.ok(getState().start > 0)
    assert.equal(getState().finished, 0)
    assert.equal(commitGhostRun(500, null), null)

    sampleAt(0, 3)
    sampleAt(sampleInterval, 4)
    const run = commitGhostRun(500, null)
    assert.ok(run)
    assert.equal(run.samples[0].p[0], 3)
  })
})

describe('localStorage', () => {
  beforeEach(() => {
    resetGhostRecording()
    localStorage.clear()
  })

  it('round-trips a valid run under pmndrs.racing-game.ghost-best', () => {
    const run: GhostRun = { time: 3_210, samples: [pose(0, 1), pose(50, 2), pose(3_210, 3)] }
    saveGhostRun(run)
    assert.equal(JSON.parse(localStorage.getItem(GHOST_STORAGE_KEY)!).version, 1)
    assert.deepEqual(loadGhostRun(), run)
  })

  it('rejects missing, corrupt, unversioned, and incomplete payloads', () => {
    assert.equal(loadGhostRun(), null)

    localStorage.setItem(GHOST_STORAGE_KEY, '{')
    assert.equal(loadGhostRun(), null)

    localStorage.setItem(GHOST_STORAGE_KEY, JSON.stringify({ run: { time: 1000, samples: [pose(0, 0), pose(50, 1)] } }))
    assert.equal(loadGhostRun(), null)

    localStorage.setItem(GHOST_STORAGE_KEY, JSON.stringify({ version: 1, run: { time: 0, samples: [pose(0, 0), pose(50, 1)] } }))
    assert.equal(loadGhostRun(), null)

    localStorage.setItem(GHOST_STORAGE_KEY, JSON.stringify({ version: 1, run: { time: 1000, samples: [pose(0, 0)] } }))
    assert.equal(loadGhostRun(), null)

    localStorage.setItem(
      GHOST_STORAGE_KEY,
      JSON.stringify({ version: 1, run: { time: 1000, samples: [pose(0, 0), { t: NaN, p: [1, 2, 3], q: identityQuat }] } }),
    )
    assert.equal(loadGhostRun(), null)
  })
})

describe('store finish / HUD best-time flags', () => {
  const now = 20_000
  const originalNow = Date.now

  beforeEach(() => {
    resetStoreGhost()
    Date.now = () => now
  })

  afterEach(() => {
    Date.now = originalNow
    resetStoreGhost()
  })

  it('commits a new best from world pose and marks the finish overlay', () => {
    const chassis = cannonStyleChassis(new Vector3(11, 2, 13))
    getState().chassisBody.current = chassis
    setState({ start: now - 4_000, finished: 0, ghost: null, bestTime: 0 })

    recordGhostSampleFromChassis(0, chassis)
    getState().actions.onFinish()

    const state = getState()
    assert.equal(state.finished, 4_000)
    assert.equal(state.bestTime, 4_000)
    assert.equal(state.newBest, true)
    assert.equal(state.ghost?.time, 4_000)
    assert.deepEqual(state.ghost?.samples.at(-1)?.p, [11, 2, 13])
    assert.notDeepEqual(state.ghost?.samples.at(-1)?.p, [...spawnPosition])
    assert.equal(loadGhostRun()?.time, 4_000)
  })

  it('keeps the previous ghost on a slower or tied finish', () => {
    const previous: GhostRun = { time: 4_000, samples: [pose(0, 0), pose(4_000, 8)] }
    saveGhostRun(previous)
    setState({ start: now - 4_000, finished: 0, ghost: previous, bestTime: 4_000, newBest: false })
    getState().chassisBody.current = cannonStyleChassis(new Vector3(1, 1, 1))

    sampleAt(0, 1)
    sampleAt(sampleInterval, 2)
    getState().actions.onFinish()

    const tied = getState()
    assert.equal(tied.finished, 4_000)
    assert.equal(tied.bestTime, 4_000)
    assert.equal(tied.newBest, false)
    assert.equal(tied.ghost?.samples[1].p[0], 8)
    assert.equal(loadGhostRun()?.samples[1].p[0], 8)

    resetGhostRecording()
    setState({ start: now - 5_000, finished: 0, newBest: false })
    sampleAt(0, 3)
    sampleAt(sampleInterval, 4)
    getState().actions.onFinish()

    const slower = getState()
    assert.equal(slower.finished, 5_000)
    assert.equal(slower.bestTime, 4_000)
    assert.equal(slower.newBest, false)
    assert.equal(loadGhostRun()?.time, 4_000)
  })
})
