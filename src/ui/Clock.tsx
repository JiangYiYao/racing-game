import { useEffect, useRef } from 'react'
import { addEffect } from '@react-three/fiber'
import { useStore } from '../store'
import { readableTime } from './LeaderBoard'

const getTime = (finished: number, start: number) => {
  if (finished) return readableTime(finished)
  const time = start ? Date.now() - start : 0
  return readableTime(time)
}

export function Clock() {
  const ref = useRef<HTMLSpanElement>(null)
  const { bestTime, finished, start } = useStore(({ bestTime, finished, start }) => ({ bestTime, finished, start }))

  let text = getTime(finished, start)

  useEffect(() => {
    let lastTime = 0
    return addEffect((time) => {
      if (!ref.current || time - lastTime < 100) return
      lastTime = time
      text = getTime(finished, start)
      if (ref.current.innerText !== text) {
        ref.current.innerText = text
      }
    })
  }, [finished, start])

  return (
    <div className="clock">
      <span ref={ref} className="clock-current">
        {text}
      </span>
      <span className="clock-best">BEST {bestTime ? readableTime(bestTime) : '—'}</span>
    </div>
  )
}
