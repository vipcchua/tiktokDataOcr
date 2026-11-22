import React from 'react'

export const accountFields = [
  { key: 'name', label: '账号名字' },
  { key: 'handle', label: '账号 ID' },
  { key: 'homepage', label: '主页链接' },
  { key: 'followers', label: '粉丝数' },
]

export function accountLabel(account) {
  return account.name || account.handle || '未命名账号'
}

export function AccountPresets({ accounts, update, active, selectDefault, remove }) {
  return <div>
    <div className="toolbar">
      <button className="secondary" onClick={() => update([...accounts, { key: crypto.randomUUID() }])}>添加账号</button>
    </div>
    <p>勾选默认账号，为未分配的作品和新识别的作品填入账号信息。</p>
    {accounts.map(account => <fieldset key={account.key} className="account-form">
      <legend>{accountLabel(account)}</legend>
      <div className="toolbar">
        <label><input type="checkbox" checked={active === account.key}
          onChange={event => selectDefault(event.target.checked ? account.key : '')}/> 默认使用</label>
        <button className="secondary delete-account" onClick={() => remove(account)}>删除账号</button>
      </div>
      <div className="account-inputs">{accountFields.map(field => <label key={field.key}>{field.label}
        <input value={account[field.key] || ''} onChange={event => {
          const value = event.target.value
          update(accounts.map(item => item.key === account.key ? { ...item, [field.key]: value } : item))
        }}/>
      </label>)}</div>
    </fieldset>)}
  </div>
}

export function AccountSelect({ accounts, value, change, label }) {
  return <select aria-label={label} value={value} onChange={event => change(event.target.value)}>
    <option value="">未分配</option>
    {accounts.map(account => <option key={account.key} value={account.key}>{accountLabel(account)}</option>)}
  </select>
}

export function accountSpans(rows, enabled) {
  const spans = rows.map(() => 1)
  if (!enabled) return spans
  for (let first = 0; first < rows.length;) {
    let end = first + 1
    while (rows[first].account && end < rows.length && rows[first].account === rows[end].account) end++
    spans[first] = end - first
    spans.fill(0, first + 1, end)
    first = end
  }
  return spans
}
