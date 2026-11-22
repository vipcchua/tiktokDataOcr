import React, { useRef, useState } from 'react'
import { parseCount } from './analysis'

export function PlayShareChart({ rows, playIndex }) {
  const [pinned, setPinned] = useState(null)
  const [hovered, setHovered] = useState(null)
  const touchStart = useRef(null)
  const lastTap = useRef(-Infinity)
  const works = rows.map((row, index) => ({
    id: row.id,
    title: row.values[0] || `作品 ${index + 1}`,
    plays: parseCount(row.values[playIndex]),
    color: `hsl(${(175 + index * 137.508) % 360} 64% ${index % 2 ? 56 : 43}%)`,
  }))
  const total = works.reduce((sum, work) => sum + (work.plays ?? 0), 0)
  const active = works.some(work => work.id === (hovered ?? pinned) && work.plays > 0) ? hovered ?? pinned : null
  let angle = 0
  const segments = works.filter(work => work.plays > 0).map(work => {
    const start = angle
    angle += work.plays / total * 360
    const color = active === null || active === work.id ? work.color : `color-mix(in srgb, ${work.color} 30%, #e3ecef)`
    return `${color} ${start}deg ${Math.min(angle, 360)}deg`
  })
  return <figure className="play-share">
    <figcaption>各作品播放量占比</figcaption>
    {total > 0 ? <div className="play-share-body">
      <div className="play-share-pie" aria-hidden="true" style={{ background: `conic-gradient(${segments.join(', ')})` }}/>
      <ul aria-label="各作品播放量占比明细">
        {works.map(work => <li key={work.id}>
          <button type="button" className="play-share-item" disabled={!(work.plays > 0)} aria-pressed={pinned === work.id}
            data-active={active === work.id} onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(work.id) }}
            onPointerLeave={() => setHovered(null)} onFocus={event => {
              if (event.currentTarget.matches(':focus-visible')) setHovered(work.id)
            }} onBlur={() => setHovered(null)}
            onPointerDown={event => {
              if (event.pointerType === 'touch') touchStart.current = { id: work.id, x: event.clientX, y: event.clientY }
            }}
            onPointerCancel={() => { touchStart.current = null }}
            onPointerUp={event => {
              if (event.pointerType !== 'touch') return
              const start = touchStart.current
              touchStart.current = null
              if (start?.id === work.id && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 10) {
                lastTap.current = performance.now()
                setPinned(current => current === work.id ? null : work.id)
              }
            }}
            onClick={event => {
              if (event.nativeEvent.pointerType === 'touch' ||
                (event.detail > 0 && !event.nativeEvent.pointerType && performance.now() - lastTap.current < 500)) return
              setPinned(current => current === work.id ? null : work.id)
            }}>
            <span className="play-share-key" style={{ background: work.plays > 0 ? work.color : '#aab6bd' }}/>
            <span className="play-share-title">{work.title}</span>
            <span>{work.plays === null ? '无播放量' : `${(work.plays / total * 100).toFixed(2)}%`}</span>
          </button>
        </li>)}
      </ul>
    </div> : <p>有可用的播放量后，这里会显示占比。</p>}
  </figure>
}
