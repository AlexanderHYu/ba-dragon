// 称号的显示名（社区梗，不要改）。好/坏/中性看 @shared/dragon 的 TITLES。
import { TITLES } from '@shared/dragon'

export const TITLE_NAME: Record<string, string> = {
  carry: '大腿', blame: '背锅侠', deserter: '掉线狗', tryhard: '带不动', passenger: '躺赢狗', lonewolf: '孤勇者',
  reaper: '收割机', untouched: '保活能手', landlord: '地产大亨', artygod: '大炮兵主义', bandit: '土匪', canteen: '奶妈',
  weightlifter: '举重冠军', killsteal: '抢人头', demolition: '拆迁队', courier: '快递员', refund: '七天无理由退货',
  backstabbed: '被背刺', atm: '开送', scraper: '刮痧师傅', boxed: '落地成盒', camper: '蹲逼', convoy: '运输大队长',
  freeloader: '吃白食', spender: '败家子', traitor: '内鬼', crash: '曼巴out'
}

/** 称号标签的样式：好的金描边，差的虚线灰，中性的普通描边 */
export const titleCls = (id: string): string => 'tag ' + (TITLES[id] || 'neutral')
