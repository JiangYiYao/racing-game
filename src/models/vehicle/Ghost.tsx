import { useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Color, Quaternion, Vector3 } from 'three'

import type { ReactNode, MutableRefObject } from 'react'
import type { Group, Mesh, MeshStandardMaterial } from 'three'
import type { GLTF } from 'three-stdlib'

import { findGhostPose, recordGhostSample } from '../../ghost'
import { getState, useStore } from '../../store'

import type { GhostRun } from '../../ghost'

const posA = new Vector3()
const posB = new Vector3()
const quatA = new Quaternion()
const quatB = new Quaternion()
const ghostPaint = new Color('#8fd4ff')
const ghostEmissive = new Color('#16324a')

interface ChassisGLTF extends GLTF {
  nodes: {
    Chassis_1: Mesh
    Chassis_2: Mesh
    Glass: Mesh
    BrakeLights: Mesh
    HeadLights: Mesh
    Cabin_Grilles: Mesh
    Undercarriage: Mesh
    TurnSignals: Mesh
    Chrome: Mesh
  }
  materials: {
    BodyPaint: MeshStandardMaterial
    Chassis_2: MeshStandardMaterial
    Glass: MeshStandardMaterial
    BrakeLight: MeshStandardMaterial
    HeadLight: MeshStandardMaterial
    Black: MeshStandardMaterial
    Undercarriage: MeshStandardMaterial
    TurnSignal: MeshStandardMaterial
  }
}

interface WheelGLTF extends GLTF {
  nodes: {
    Mesh_14: Mesh
    Mesh_14_1: Mesh
  }
  materials: {
    'Material.002': MeshStandardMaterial
    'Material.009': MeshStandardMaterial
  }
}

const ghostify = (material: MeshStandardMaterial, opacity: number) => {
  const cloned = material.clone()
  cloned.transparent = true
  cloned.opacity = opacity
  cloned.depthWrite = true
  cloned.emissive.copy(ghostEmissive)
  cloned.emissiveIntensity = 0.8
  cloned.roughness = 0.35
  cloned.metalness = 0.1
  return cloned
}

function GhostChassis() {
  const { nodes: n, materials: m } = useGLTF('/models/chassis-draco.glb') as ChassisGLTF
  const materials = useMemo(() => {
    const body = ghostify(m.BodyPaint, 0.55)
    body.color.copy(ghostPaint)
    return {
      body,
      chassis2: ghostify(n.Chassis_2.material as MeshStandardMaterial, 0.55),
      glass: ghostify(m.Glass, 0.2),
      brake: ghostify(m.BrakeLight, 0.45),
      head: ghostify(m.HeadLight, 0.55),
      black: ghostify(m.Black, 0.55),
      under: ghostify(m.Undercarriage, 0.55),
      turn: ghostify(m.TurnSignal, 0.55),
      chrome: ghostify(n.Chrome.material as MeshStandardMaterial, 0.55),
    }
  }, [m, n])

  useEffect(
    () => () => {
      Object.values(materials).forEach((material) => material.dispose())
    },
    [materials],
  )

  return (
    <group position={[0, -0.2, -0.2]}>
      <mesh geometry={n.Chassis_1.geometry} material={materials.body} />
      <mesh geometry={n.Chassis_2.geometry} material={materials.chassis2} />
      <mesh geometry={n.Glass.geometry} material={materials.glass} />
      <mesh geometry={n.BrakeLights.geometry} material={materials.brake} />
      <mesh geometry={n.HeadLights.geometry} material={materials.head} />
      <mesh geometry={n.Cabin_Grilles.geometry} material={materials.black} />
      <mesh geometry={n.Undercarriage.geometry} material={materials.under} />
      <mesh geometry={n.TurnSignals.geometry} material={materials.turn} />
      <mesh geometry={n.Chrome.geometry} material={materials.chrome} />
    </group>
  )
}

function GhostWheelSpinner({ children, spin }: { children: ReactNode; spin: MutableRefObject<number> }) {
  const ref = useRef<Group>(null)
  useFrame(() => {
    if (ref.current) ref.current.rotation.x = spin.current
  })
  return <group ref={ref}>{children}</group>
}

function GhostWheels({ spin }: { spin: MutableRefObject<number> }) {
  const { nodes, materials } = useGLTF('/models/wheel-draco.glb') as WheelGLTF
  const [vehicleConfig, wheelInfo] = useStore((state) => [state.vehicleConfig, state.wheelInfo])
  const { back, front, height, width } = vehicleConfig
  const scale = wheelInfo.radius / 0.34
  const ghostMaterials = useMemo(() => [ghostify(materials['Material.002'], 0.55), ghostify(materials['Material.009'], 0.55)], [materials])

  useEffect(
    () => () => {
      ghostMaterials.forEach((material) => material.dispose())
    },
    [ghostMaterials],
  )

  return (
    <>
      {[0, 1, 2, 3].map((index) => {
        const length = index < 2 ? front : back
        const side = index % 2 ? 0.5 : -0.5
        const leftSide = !(index % 2)
        return (
          <group key={index} position={[width * side, height, length]} scale={scale}>
            <GhostWheelSpinner spin={spin}>
              <group scale={leftSide ? -1 : 1}>
                <mesh geometry={nodes.Mesh_14.geometry} material={ghostMaterials[0]} />
                <mesh geometry={nodes.Mesh_14_1.geometry} material={ghostMaterials[1]} />
              </group>
            </GhostWheelSpinner>
          </group>
        )
      })}
    </>
  )
}

function GhostCar({ run }: { run: GhostRun }) {
  const group = useRef<Group>(null)
  const spin = useRef(0)
  const lastPos = useRef(new Vector3())
  const primed = useRef(false)
  const runRef = useRef(run)
  runRef.current = run

  useFrame(() => {
    if (!group.current) return
    const { start } = getState()
    const elapsed = start ? Math.max(Date.now() - start, 0) : 0
    const { a, b, alpha } = findGhostPose(runRef.current.samples, elapsed)
    posA.fromArray(a.p).lerp(posB.fromArray(b.p), alpha)
    quatA.fromArray(a.q).slerp(quatB.fromArray(b.q), alpha)

    if (!start || elapsed === 0) {
      spin.current = 0
      primed.current = false
    } else if (primed.current) {
      spin.current += lastPos.current.distanceTo(posA) / 0.38
    }

    lastPos.current.copy(posA)
    primed.current = Boolean(start)
    group.current.position.copy(posA)
    group.current.quaternion.copy(quatA)
  })

  return (
    <group ref={group} renderOrder={10}>
      <GhostChassis />
      <GhostWheels spin={spin} />
    </group>
  )
}

function GhostRecorder() {
  useFrame(() => {
    const { chassisBody, finished, start } = getState()
    if (!start || finished || !chassisBody.current) return
    recordGhostSample(Date.now() - start, chassisBody.current.position, chassisBody.current.quaternion)
  })
  return null
}

export function Ghost() {
  const ghost = useStore((state) => state.ghost)
  return (
    <>
      <GhostRecorder />
      {ghost ? <GhostCar run={ghost} /> : null}
    </>
  )
}
