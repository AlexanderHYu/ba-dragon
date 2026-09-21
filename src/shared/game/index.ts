// 软件自带的一份游戏单位表：单位名字和底价、每套配装的加价和名字。
// data.json 是从游戏文件里导出来的（scripts/export-gamedata.mts），游戏更新之后重新导一次。
// 用户自己在设置里填了密钥的话，就用他本机实时解出来的，不看这份。
import raw from './data.json'

export interface GameData {
  meta: {
    /** 这份数据是哪天导出来的 */
    updatedAt: string
    /** 当时游戏资源包的大小:修改时间，用来判断是不是同一个游戏版本 */
    stamp: string
  }
  /** 单位 id → [名字, 基础价] */
  units: Record<number, [string, number]>
  /** 配装选项 id → [加价, 改名, 名字后缀, 显示名]（显示名是空串 = 空槽位，不显示） */
  options: Record<number, [number, string | null, string | null, string]>
  /** 国家 id → 名字 */
  countries: Record<number, string>
  /** 专精 id → 名字 */
  specs: Record<number, string>
}

export const BUNDLED = raw as unknown as GameData

/** 自带的这份有没有东西（空的说明还没导出过） */
export const hasBundled = (): boolean => Object.keys(BUNDLED.units).length > 0
