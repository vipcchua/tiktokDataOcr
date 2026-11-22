import React from 'react'

const links = [
  { name: '个人主页', url: 'https://www.cchua.com/', icon: <path d="m3 11 9-8 9 8M5 10v10h14V10m-9 10v-6h4v6"/> },
  { name: 'GitHub', url: 'https://github.com/vipcchua', icon: <path fill="currentColor" stroke="none" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.76c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/> },
  { name: '抖音', url: 'https://v.douyin.com/tVADAUejacY', icon: <path d="M14 3v12a4 4 0 1 1-4-4h1v3h-1a1 1 0 1 0 1 1V3h3Zm0 0c1 3 3 4 6 4v3c-2 0-4-1-6-2z" fill="currentColor" stroke="none"/> },
  { name: '小红书', url: 'https://www.xiaohongshu.com/user/profile/5657187103eb84665b671a6d', mark: '小红书' },
  { name: 'B站', url: 'https://space.bilibili.com/1766152', icon: <path d="m7 3 3 4m7-4-3 4M3 7h18v13H3zM8 12v2m8-2v2" /> },
  { name: '微博', url: 'https://www.weibo.com/u/1367370533', icon: <><path d="M3 16c0-4 5-8 8-8 2 0 1 2 2 2 2-1 5-1 5 1 0 1 3 1 3 4 0 3-4 6-9 6s-9-2-9-5ZM17 3a6 6 0 0 1 6 6m-6-3a3 3 0 0 1 3 3"/><ellipse cx="11" cy="16" rx="3" ry="2"/></> },
  { name: 'X', url: 'https://x.com/SzCchua', icon: <path d="M4 3h4l12 18h-4zM20 3 4 21" /> },
  { name: 'Instagram', url: 'https://www.instagram.com/cchua_channel/', icon: <><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".7" fill="currentColor"/></> },
  { name: 'YouTube', url: 'https://www.youtube.com/@SzCchua', icon: <><rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor"/><path d="m10 9 5 3-5 3z" fill="#171c27" stroke="none"/></> },
]

export function ProjectFooter() {
  return <footer className="project-footer">
    <nav aria-label="Cchua 社交主页">
      {links.map(({ name, url, mark, icon }) => <a key={name} href={url} target="_blank" rel="noopener noreferrer" aria-label={name} title={name}>
        {mark ? <span aria-hidden="true">{mark}</span> : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>}
      </a>)}
    </nav>
    <p>Project By Cchua</p>
  </footer>
}
