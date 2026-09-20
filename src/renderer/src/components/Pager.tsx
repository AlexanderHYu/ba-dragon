// 分页条：列表只显示一页，翻页按钮在下面。档案和录像共用。
export default function Pager({
  page,
  pageSize,
  total,
  onPage
}: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
}): React.JSX.Element | null {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  const from = page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  return (
    <div className="pager">
      <button disabled={page <= 0} onClick={() => onPage(0)} title="第一页">
        «
      </button>
      <button disabled={page <= 0} onClick={() => onPage(page - 1)}>
        上一页
      </button>
      <span className="dim">
        {from}–{to} / {total}
      </span>
      <button disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        下一页
      </button>
      <button disabled={page >= pages - 1} onClick={() => onPage(pages - 1)} title="最后一页">
        »
      </button>
    </div>
  )
}

/** 取当前页的那几条，并保证页码不越界 */
export function pageSlice<T>(list: T[], page: number, size: number): { items: T[]; page: number } {
  const pages = Math.max(1, Math.ceil(list.length / size))
  const p = Math.min(Math.max(0, page), pages - 1)
  return { items: list.slice(p * size, p * size + size), page: p }
}
