// 把解出来的原始表压成配装计算器用的那份数据（src/shared/game/combat.json）。
// 只留计算要用的字段，全部压成数组，导出来 400 KB 左右。
import type { RawTables } from './gameDb'
import type {
  CAbility,
  CAmmo,
  CArmor,
  COptionEffect,
  CTurretMount,
  CUnit,
  CWeapon,
  CombatData
} from '@shared/game/combat'

const n = (x: unknown): number => {
  const v = Number(x)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0
}
const b = (x: unknown): 0 | 1 => (x ? 1 : 0)
const s = (x: unknown): string => String(x ?? '').trim()

/** 炮塔名字的头一个词就是它的类别：MainTurret / CupolaTurret / SwivelTurret / HullTurret… */
const turretClass = (name: string): string => (s(name).split(/\s+/)[0] || '').replace(/\d+$/, '')

export function buildCombat(r: RawTables): CombatData {
  const t = r.t
  const row = (k: string): Record<string, unknown>[] => (t[k] as Record<string, unknown>[]) || []

  const units: Record<number, CUnit> = {}
  for (const u of row('Units')) {
    // 军械库里不显示的那些（跳伞的飞行员、船、测试假人、降落态的飞机）用库里的真名，
    // 它们的 HUDName 常常和正常单位撞名——「F-15EX Eagle II (landed)」的 HUDName 就是
    // 「F-15EX Eagle II」，混在列表里看着像重复
    const armory = b(u.DisplayInArmory)
    units[n(u.Id)] = [
      armory ? s(u.HUDName) || s(u.Name) : s(u.Name) || s(u.HUDName),
      n(u.Cost),
      n(u.Length),
      n(u.Width),
      n(u.Height),
      n(u.MaxStress),
      n(u.Stealth),
      n(u.CategoryType),
      n(u.Role),
      n(u.CountryId),
      n(u.Type),
      armory
    ] as CUnit
  }

  const armors: Record<number, CArmor> = {}
  for (const a of row('ArmorsJson')) {
    armors[n(a.Id)] = [
      n(a.MaxHealthPoints),
      n(a.KinArmorFront),
      n(a.KinArmorSides),
      n(a.KinArmorRear),
      n(a.KinArmorTop),
      n(a.HeatArmorFront),
      n(a.HeatArmorSides),
      n(a.HeatArmorRear),
      n(a.HeatArmorTop),
      n(a.ArmorValue)
    ] as CArmor
  }

  const unitArmor: Record<number, number> = {}
  for (const x of row('UnitArmorsJson')) {
    const uid = n(x.UnitId)
    // 一个单位可能列了好几条，第一条当默认
    if (!unitArmor[uid]) unitArmor[uid] = n(x.ArmorId)
  }

  const turretName = new Map<number, string>()
  const turretDefault = new Map<number, boolean>()
  const turretParent = new Map<number, number>()
  for (const x of row('TurretsJson')) {
    turretName.set(n(x.Id), s(x.Name))
    turretDefault.set(n(x.Id), !!x.IsDefault)
    // 子炮塔：配装换的是主炮塔，挂在它下面的（同轴机枪、车顶遥控武器站）跟着一起换
    if (n(x.ParentTurretId)) turretParent.set(n(x.Id), n(x.ParentTurretId))
  }

  const turrets: Record<number, CTurretMount[]> = {}
  for (const x of row('TurretUnitsJson')) {
    const uid = n(x.UnitId)
    const tid = n(x.TurretId)
    const name = turretName.get(tid) || ''
    ;(turrets[uid] ||= []).push([
      tid,
      n(x.Order),
      turretClass(name),
      b(turretDefault.get(tid)),
      turretParent.get(tid) || 0
    ] as CTurretMount)
  }

  const turretWeapons: Record<number, [number, number, number][]> = {}
  for (const x of row('TurretWeaponsJson')) {
    // WeaponPriority：同一个非零通道上抢占发射权时，数字**小**的赢（CanUseFiringChannel）
    ;(turretWeapons[n(x.TurretId)] ||= []).push([n(x.WeaponId), n(x.WeaponChannel), n(x.WeaponPriority)])
  }

  const weapons: Record<number, CWeapon> = {}
  for (const w of row('WeaponsJson')) {
    weapons[n(w.Id)] = [
      s(w.HUDName) || s(w.Name),
      n(w.MagazineSize),
      n(w.MagazineReloadTimeMin),
      n(w.MagazineReloadTimeMax),
      n(w.ShotsPerBurstMin),
      n(w.ShotsPerBurstMax),
      n(w.TimeBetweenShotsInBurst),
      n(w.TimeBetweenBurstsMin),
      n(w.TimeBetweenBurstsMax),
      n(w.AimTimeMin),
      n(w.AimTimeMax),
      b(w.CanShootOnTheMove),
      n(w.StabilizerQuality),
      b(w.IsRadarDependent),
      n(w.SimultaneousTracking),
      b(w.CanBeMerged)
    ] as CWeapon
  }

  const weaponAmmo: Record<string, [number, number][]> = {}
  for (const x of row('WeaponAmmunitionsJson')) {
    const k = n(x.UnitId) + ':' + n(x.WeaponId)
    ;(weaponAmmo[k] ||= []).push([n(x.AmmunitionId), n(x.Quantity)])
  }

  const ammo: Record<number, CAmmo> = {}
  for (const a of row('AmmunitionsJson')) {
    ammo[n(a.Id)] = [
      s(a.HUDName) || s(a.Name),
      n(a.Damage),
      n(a.StressDamage),
      n(a.PenetrationAtMinRange),
      n(a.PenetrationAtGroundRange),
      n(a.GroundRange),
      n(a.LowAltRange),
      n(a.HighAltRange),
      n(a.TargetType),
      n(a.ArmorTargeted),
      n(a.HealthAOERadius),
      n(a.StressAOERadius),
      n(a.OverpressureRadius),
      b(a.TopArmorAttack),
      b(a.CanBeIntercepted),
      b(a.LaserGuided),
      n(a.DispersionHorizontalRadius),
      n(a.DispersionVerticalRadius),
      n(a.MinimalRange),
      n(a.CriticMultiplier),
      n(a.IgnoreCover),
      b(a.NoDamageFalloff),
      n(a.Seeker),
      n(a.DispersionMinimal),
      n(a.LoftAngle),
      n(a.LoftHeight),
      n(a.RadioFuseDistance)
    ] as CAmmo
  }

  const abilities: Record<number, CAbility> = {}
  for (const a of row('AbilitiesJson')) {
    abilities[n(a.Id)] = [
      s(a.Name),
      b(a.IsAPS),
      n(a.APSQuantity),
      n(a.APSCooldown),
      n(a.APSHitboxProportion),
      n(a.ECMAccuracyMultiplier),
      b(a.IsDecoy),
      n(a.DecoyQuantity),
      n(a.DecoyAccuracyMultiplier),
      n(a.DecoyDuration),
      n(a.DecoyCooldown),
      b(a.IsSmoke),
      b(a.IsLaserDesignator),
      b(a.IsRadar)
    ] as CAbility
  }

  const unitAbilities: Record<number, number[]> = {}
  for (const x of row('UnitAbilitiesJson')) {
    ;(unitAbilities[n(x.UnitId)] ||= []).push(n(x.AbilityId))
  }

  const options: Record<number, COptionEffect> = {}
  for (const o of row('OptionsJson')) {
    const e: COptionEffect = {}
    if (n(o.ArmorId)) e.a = n(o.ArmorId)
    if (n(o.ReplaceUnitId)) e.u = n(o.ReplaceUnitId)
    if (n(o.MainSensorId)) e.s = n(o.MainSensorId)
    if (n(o.MobilityId)) e.m = n(o.MobilityId)
    const ab = [n(o.Ability1Id), n(o.Ability2Id), n(o.Ability3Id)].filter(Boolean)
    if (ab.length) e.b = ab
    const tt: Record<number, number> = {}
    for (let i = 0; i <= 20; i++) {
      const v = n(o['Turret' + i + 'Id'])
      if (v) tt[i] = v
    }
    if (Object.keys(tt).length) e.t = tt
    if (Object.keys(e).length) options[n(o.Id)] = e
  }

  const squad: Record<number, [number, number, number][]> = {}
  for (const m of row('SquadMembersJson')) {
    ;(squad[n(m.UnitId)] ||= []).push([n(m.PrimaryWeaponId), n(m.SpecialWeaponId), n(m.DeathPriority)])
  }

  // 每个单位的配装槽位和里面的选项（做选择界面用）
  const modsOf = new Map<number, { id: number; unitId: number; name: string; order: number }>()
  for (const m of row('ModificationsJson')) {
    // 槽位名：界面名是 Custom_Slot_Wing_pylons 这种，去掉前缀换成「Wing pylons」；
    // 没有就退回内部名的头一个词（Armor / MainTurret …）
    const ui = s(m.UIName)
      .replace(/^.*?Custom_Slot_?/i, '')
      .replace(/_/g, ' ')
      .trim()
    const name = ui || s(m.Name).split(/\s+/)[0] || '配装'
    modsOf.set(n(m.Id), { id: n(m.Id), unitId: n(m.UnitId), name, order: n(m.Order) })
  }
  const optsByMod = new Map<number, [number, 0 | 1][]>()
  for (const o of row('OptionsJson')) {
    const mid = n(o.ModificationId)
    if (!optsByMod.has(mid)) optsByMod.set(mid, [])
    optsByMod.get(mid)!.push([n(o.Id), b(o.IsDefault)])
  }
  const unitOptions: CombatData['unitOptions'] = {}
  for (const m of [...modsOf.values()].sort((a, c) => a.order - c.order)) {
    const list = optsByMod.get(m.id)
    if (!list?.length || !m.unitId) continue
    ;(unitOptions[m.unitId] ||= []).push([m.name, list])
  }

  // 哪个单位能出现在哪个专精里（筛选用）
  const unitSpecs: Record<number, number[]> = {}
  for (const x of row('SpecializationAvailabilitiesJson')) {
    const uid = n(x.UnitId)
    const sid = n(x.SpecializationId)
    if (!uid || !sid) continue
    ;(unitSpecs[uid] ||= []).push(sid)
  }
  const specs: Record<number, [string, number]> = {}
  for (const x of row('SpecializationsJson')) specs[n(x.Id)] = [s(x.Name), n(x.CountryId)]
  const countries: Record<number, string> = {}
  for (const x of row('CountriesJson')) countries[n(x.Id)] = s(x.Name)

  const sensors: Record<number, [string, number, number, number]> = {}
  for (const x of row('SensorsJson')) {
    sensors[n(x.Id)] = [s(x.Name), n(x.OpticsGround), n(x.OpticsLowAltitude), n(x.OpticsHighAltitude)]
  }

  const mobility: CombatData['mobility'] = {}
  for (const x of row('MobilityJson')) {
    mobility[n(x.Id)] = [
      s(x.Name),
      n(x.MaxSpeedRoad),
      n(x.MaxCrossCountrySpeed),
      n(x.MaxSpeedReverse),
      n(x.TurnRate),
      n(x.Acceleration),
      n(x.ClimbRate),
      n(x.LoiteringTime),
      n(x.AfterBurningLoiteringTime),
      b(x.IsAmphibious),
      b(x.IsAirDroppable)
    ]
  }

  return {
    meta: { updatedAt: new Date().toISOString().slice(0, 10), stamp: r.stamp },
    units,
    armors,
    unitArmor,
    turrets,
    turretWeapons,
    weapons,
    weaponAmmo,
    ammo,
    abilities,
    unitAbilities,
    options,
    squad,
    unitOptions,
    unitSpecs,
    specs,
    countries,
    sensors,
    mobility
  }
}
