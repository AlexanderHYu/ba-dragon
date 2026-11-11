// 龙区分数字的颜色（名单、复盘、档案、玩家页共用）

/**
 * 分数的颜色：跟旁边那个龙/区/泯标记（单局）或分档（玩家龙区分）走，不自己另划分数线——
 * 以前按 8 / 6.5 / 4 / 2.5 自己分五档，和单局标记（8.2 / 2.8）、玩家分档（9.1 / 7.3 / 3.7 / 1.9）都对不上，
 * 会出现「标的是泯，数字却是黄的」。
 * 配色规则：金 = 强，越弱越暗；「区」不用红色（红色是 B 队）。
 */
const LABEL_COLOR: Record<string, string> = {
  dragon: 'var(--gold-txt)', // 龙 / 真龙
  solid: 'var(--solid-txt)', // 有龙样
  min: 'var(--text-hi)', // 泯（单局）
  average: 'var(--text-hi)', // 泯然众人
  weak: 'var(--dim)', // 有点区
  qu: 'var(--faint)' // 区 / 纯区
}
export function scoreColor(v: number | null | undefined, label: string | null | undefined): string {
  if (v == null || !label) return 'var(--dim)'
  return LABEL_COLOR[label] || 'var(--text)'
}

/**
 * K/D、胜率这类数字只标两头：明显好的绿色加上箭头（v-up），明显差的灰色加下箭头（v-dn），中间不加。
 * 差的那头不用红色，免得和 B 队混。
 */
export function goodBad(v: number | null | undefined, good: number, bad: number): string {
  if (v == null) return ''
  if (v >= good) return 'v-up'
  if (v <= bad) return 'v-dn'
  return ''
}
