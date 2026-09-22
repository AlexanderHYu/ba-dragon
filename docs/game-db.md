# 游戏自带的单位库

复盘里的花费、配装名字，以前都是猜的：BATrace 的公开接口只给单位 ID 和一串配装 ID，
给不了名字，也给不了价钱，所以我们只能拿一张手工整理的基础价表，再按官方的出兵总分
等比例摊回去——数出来的单价常常差 20~30%，同一个单位的两套配装也只能叫「配装 A / B」。

游戏自己其实带着一张完整的表。把它读出来，这两件事就都准了。

## 东西在哪

```
<游戏目录>/BrokenArrow_Data/data.unity3d        UnityFS 归档，7 GB
   └── globalgamemanagers.assets                 640 MB
        └── MonoBehaviour "DataBaseCompiled"     24 张表，挨个加密
```

24 张表按固定顺序排成 24 条 Unity 字符串：Units、Abilities、Ammunitions、Armors、Mobility、
Turrets、Weapons、Sensors、SquadMembers、**Modifications**、**Options**、Specializations、
TransportAvailabilities……每一条都是 base64，解开后是

```
"fhk3s0g3" + 16 字节 IV + AES-256-CBC 密文（PKCS7 补齐）
```

解出来是 JSON。卡组文件（`%USERPROFILE%\AppData\LocalLow\SteelBalalaikaStudio\BrokenArrow\Decks\*.dek`）
用的是同一套格式，只是不套 base64。

密钥是 32 个 ASCII 字符，跟着游戏版本走。**本仓库不带这个值。**

软件里带了一份**导出好的数据**（`src/shared/game/data.json`，80 KB），所以配装真名和精确花费
**不填密钥也能用**，只是游戏更新之后这份会比游戏里旧一点。要一直跟着游戏走，就在
「设置 → 游戏数据」里填上密钥，点一下「读取」——解一次存一次，平时开软件只读存下来的，
不会每次都解。看卡组内容（.dek）必须有密钥，因为卡组文件本身是加密的。

导出那份自带数据：

```bash
npm run export-gamedata -- --key <32位密钥>     # 写 src/shared/game/data.json
```

## 我们用其中三张表

| 表 | 有什么 | 拿来干嘛 |
| --- | --- | --- |
| `Units` | 单位 ID、名字（`HUDName`）、基础价、国家、兵种 | 单位真名和底价 |
| `Modifications` | 槽位：属于哪个单位、第几个槽 | 把配装选项挂回单位 |
| `Options` | 选项 ID、加价、`ReplaceUnitName`、`ConcatenateWithUnitName`、界面名 | 配装真名和加价 |

名字是拼出来的：底名 → 某个选项有 `ReplaceUnitName` 就整个换掉 → 有 `ConcatenateWithUnitName`
就往后接。所以 `Stryker ICV` + SRAT + Javelin 会变成 `Stryker ICV Javelin Trophy`，
`M8 AGS` 换了主炮直接变 `M8 Thunderbolt`。

**单价 = 单位基础价 + 每个选项的加价。**

## 准不准

拿本机 31 局真实对局（5427 条出兵记录、95 个玩家场次）对过：

- 每条记录都能在表里查到，没有对不上的 ID；
- 按上面这个算法加起来的**出兵分**和**回收分**，和 BATrace 的官方数字**一个子儿不差**（95/95）；
- 损失分 91/95 完全一致，另外 4 场差 1~3%（官方的算法在个别情况下略低），
  所以损失这一项仍然按官方总额缩放一次，保证总数对得上。

有一条记录查不到（比如游戏更新了、表里没这个 ID），整场退回估算——
半精确半估算的数字最难解释。

## 怎么读的（`src/main/services/`）

- `unityfs.ts`：UnityFS 归档。只实现游戏实际用到的两种块压缩（不压 / LZ4），自带一个
  LZ4 block 解码器，不引第三方库。按逻辑地址只解需要的那几块，不落 640 MB 临时文件。
- `gameDb.ts`：从归档尾部往前找 `DataBaseCompiled`（这东西在资源文件 97% 的位置，
  倒着扫只要解百分之几），读 24 条字符串，挑我们要的几张解密。

整套 100 毫秒左右跑完。解出来的精简表（单位 + 配装 + 国家 + 专精）存进本地库，
按归档的大小+修改时间当版本戳；游戏更新了会在设置里提示「点一下重新读取」，但不会自动去解。

## 配装计算器用到的表

`src/shared/game/combat.json`（350 KB，同一个导出脚本一起写出来）里还有：

| 表 | 关键字段 |
| --- | --- |
| `Ammunitions` | 伤害、压制伤害、近距/远距穿深、针对哪种装甲、目标类型位图、AOE 半径、超压半径、可否被 APS 拦、激光制导、散布 |
| `Armors` | 血量、动能装甲（前/侧/后/顶）、破甲装甲（前/侧/后/顶）、步兵护甲值 |
| `Weapons` | 弹匣、装填、点射发数与间隔、瞄准时间、行进间射击、稳定器、是否依赖雷达 |
| `Turrets` / `TurretUnits` / `TurretWeapons` | 哪个单位有哪些炮塔、炮塔上挂什么武器 |
| `SquadMembers` | 步兵班里每个人拿什么枪 |
| `Abilities` | APS 拦截次数/冷却、ECM 命中率乘数、诱饵数量/乘数/持续、烟雾、激光指示、雷达 |
| `Sensors` / `Mobility` | 对地/低空/高空发现距离；速度、转向、爬升、滞空时间 |

### 战斗公式：从哪来的

**全部是从 `GameAssembly.dll` 的机器码里读出来的**，不是猜的。

游戏是 IL2CPP 打的（C# → C++ → x86-64），没有 IL 可读。`tools/il2cpp-peek.py` 做这三步：

1. 解 `global-metadata.dat`，按名字找到方法拿它的 token；
2. 在 `GameAssembly.dll` 里按模块名找到 `CodeGenModule`，顺着 `methodPointers[token的rid - 1]` 拿到函数地址；
3. capstone 反汇编，顺手把 rip 相对寻址的浮点常量读出来。

```bash
pip install capstone
python tools/il2cpp-peek.py CalculateMissileHitChance
python tools/il2cpp-peek.py get_Damage --count 4      # 属性 getter 能直接读出字段偏移
```

字段偏移也是这么定的——属性 getter 就是一条 `movss xmm0, [rcx+偏移] / ret`：

| 字段 | 偏移 | 字段 | 偏移 |
| --- | --- | --- | --- |
| SupplyCost | 0x5c | TargetType | 0x78 |
| **Damage** | **0x64** | ArmorTargeted | 0x80 |
| StressDamage | 0x68 | PenetrationAtMinRange | 0x84 |
| HealthAOERadius | 0x90 | PenetrationAtGroundRange | 0x88 |
| StressAOERadius | 0x94 | MinimalRange / GroundRange | 0xac / 0xb0 |
| DispersionH / V / Minimal | 0xd8 / 0xdc / 0xe0 | Seeker | 0x108 |

**非制导武器的命中率**（`CalculateWeaponHitChance`）

```
比例 = clamp(最小散布 + (1 − 最小散布) × clamp(距离 / 地面射程, 0, 1), 0, 1)
H = 水平散布 × 比例      V = 垂直散布 × 比例
命中率 = clamp( min(H, min(长, 宽)) × min(V, 高) / (H × V), 0, 1)     散布为 0 → 必中
```

也就是「目标投影面积占散布椭圆的比例」。目标比散布还大就是必中——坦克炮打坦克基本都是 100%，
但机枪打步兵、火炮打车就掉得厉害。

**制导弹药的命中率**（`CalculateMissileHitChance`）

```
命中率 = 基础命中 × 目标ECM × 干扰弹效果 × 压制系数 × 经验 × 暴击系数
干扰弹效果 = 没放就是 1；放了 n 发 = ((1 − 弹药抗干扰) × 干扰弹乘数) ^ n
```

标量重载里确实是连着六个 `mulss`；我们只算前四个，经验和暴击那两个乘数游戏没写在数据里。

制导弹药把「水平散布 / 垂直散布」两个字段挪作他用：**水平 = 基础命中率，垂直 = 抗干扰**。
实际数据里基本是 1.0 / 0.0，所以一发热焰弹（×0.85）就能把命中砍到 85%，连放两发 72%，
再叠上飞机 ECM ×0.8 就只剩 58%。

**AOE**（`ShellHitSystem.DealAOEDamage`）

```
d = clamp(爆点到目标中心 − 目标外壳半径, 0, 100)
系数 = d ≥ 半径 ? 0 : (伤害不衰减 ? 1 : clamp(1 − d / 半径, 0, 1))
```

两件事值得注意：距离是从**目标外壳**算的（所以大目标更容易被溅到），
以及引擎只处理爆心 100 米以内的单位。

反汇编里能看到 `movss xmm15, 100`（那个 100 米的夹子）、`divss` 之后 `subss xmm1, xmm0`
（1 − d/半径）再 clamp 到 [0,1]，以及 `subss ... [rbx+0x28]`（减目标外壳半径）。

**游戏怎么自动挑弹种**（`SelectBestShellForTarget`）

```
对每一种弹药：
  1. test [弹药+0x78], 目标类型位      ; 目标位图和目标的类型位有交集才考虑
  2. 距离 ≥ 最小射程，且 ≤ 对这个目标的有效射程
  3. 算这个距离上的穿深 → 过伤害公式拿到对这个目标的实际伤害
     → 调 GetTargetAccuracy 拿命中率 → 两个一乘（`mulss xmm0, xmm6`）
  4. 分数最高的那一发胜出（优先目标和普通目标分别记一个最好分）
```

也就是说评分是**命中率 × 实际伤害**，不是裸伤害——所以它会自己避开打不动的弹种。
（我一开始只读到第 3 步取 `Damage` 那条 `movss` 就下了结论，结果算出「坦克拿 HE 打坦克」，
往下再读几十条才看到后面还有伤害公式和命中率两次调用。）

烟雾弹和激光制导弹是另一条请求路径（`GenerateSmoke` / `LaserGuided` 两个标志），普通开火不选。

**目标类型位**：单位的 `Type` 字段就是它在位图里占的那一位，从数据里逐个数出来：
**2 = 步兵**（194 个单位）、**4 = 车辆**（234）、**8 = 直升机**（45）、**16 = 飞机**（62）、**32 = 船**（5）。
对得上：穿甲弹 36 = 车辆+船（打不了步兵）、步枪 47 里有直升机没有飞机、
斯汀格 24 = 直升机+飞机、AMRAAM 16 = 只打飞机。

**攻顶**：`TopArmorAttack` 是显式标志（TOW-2B、集束弹、机炮扫射）；
另外抛射角 36°、抛射高度 0 的那一组反坦克导弹（标枪、地狱火、JAGM、长钉）也是攻顶——
这一条是看数据归纳的（空空弹的抛射角是 5° 配 100 的抛射高度，不算）。

**发射通道**（`CanUseFiringChannel`）

每件武器挂在炮塔上时有个 `WeaponChannel`。**同一个通道上的武器不能同时开火**，
不同通道可以——直升机的火箭巢、坦克的主炮和同轴机枪就是这么分的。
所以算一个单位的总输出时，每个通道只能取最能打的那一件再相加。

### 打中之后掉多少血

`BattleSystemHelpers` 里有 `DamageFormulaKinetic` 和 `DamageFormulaHEAT` 两条公式
（还有 `CalculateHitDamage` / `CalculateHitDamageWithThreshold` / `CalculateCQCHitDamage`）。
HEAT 那条反汇编出来是：

```
伤害 × pow(穿深, k) / (pow(穿深, k) + c × pow(装甲, k))
```

也就是说**穿甲不是二值的**，是一条软比值曲线：穿深比装甲高就掉得多，低也不是完全零。
动能那条结构类似，外加一个上限。

用哪条公式由 `IsHEATFourmulaUsed` 决定，它的机器码就一句 `cmp edx, 2` —— **ArmorTargeted == 2 走破甲曲线**，
其余走动能。

动能那条（`DamageFormulaKinetic`，参数是 基础伤害 / 穿深 / 装甲）：

```
穿深 ≥ 装甲 → 直接返回基础伤害（满伤）
否则  d = 基础 × (1 + (穿深 − 装甲) ÷ (穿深 × APE))
      d ≤ 0        → 0
      0 < d < 基础×0.1 → 基础×0.1
```

注意这个分支顺序：**先算，算出来 ≤ 0 才是零；只要还是正的就抬到 10% 下限**。
APE = 1 时，归零的临界是「装甲 ≥ 两倍穿深」。

系数存在 `BattleSystemSettings` 里，机器码是 `[config+0x16c/0x170/0x174/0x178]`。
值直接从 `globalgamemanagers.assets` 里那个 `BattleSystemSettings` 对象读出来
（对象名之后的序列化偏移 +528 起连着四个 float）：

| 常量 | 值 |
| --- | --- |
| `ARMOR_PENETRATION_EFFECTIVENESS` | 1.0 |
| `MINIMAL_DAMAGE_COEFFICIENT` | 0.1 |
| `HE_ARMOR_EFFECTIVENESS` | 1.0 |
| `HEAT_CURVE_COEFFICIENT` | 2.0 |
| `MISSILE_MERGE_POWER`（+552） | 1.0 |

这几个值和八月那份快照一致，说明九月更新没动过。

### 合并挂架

飞机把同型挂架并起来齐射（`CombinePylonsOnAircraft`）：

```
合并后的发射间隔 = (各挂架间隔之和 ÷ 挂架数) ÷ 总弹量 ^ MISSILE_MERGE_POWER
```

**先取平均，再除总弹量**，不是直接求和除弹量；最小和最大间隔分开算。
MISSILE_MERGE_POWER = 1，所以两个挂架各带两发并起来，间隔是单挂架的四分之一。

### 哪些是直读，哪些是推的

**直读**（游戏里怎么写就怎么用）：伤害、穿深、装甲、射速、射程、AOE 半径、ECM/诱饵/APS 的参数。

**推算**（没有权威来源，我们自己定的规则，界面上都标了）：

- **穿甲判定 = 穿深 ≥ 装甲**。依据是数值本身就是照这个调的：M829A4 穿深 840，M1A2 SEP v3 正面动能 850 —— 差 10 点，正好「自己打不穿自己」。侧面 120 就随便穿。
- **穿深随距离线性掉**：近距穿深 → 地面射程处的穿深之间插值（两个值一样的导弹就不掉）。
- **目标外壳半径**：AOE 是从外壳算距离的，但外壳是碰撞体，数据里只有长宽高，
  所以按长宽的外接圆半径近似。
- **溅射也要过穿甲判定**：不然「打不穿的 HE 照样炸死坦克」，反应装甲就没意义了。
- **打死要几秒**：瞄准 + 后面每发按弹匣节奏（点射间隔、装填）平摊。

## 压制（Stress）和步兵掉人

两套机制都是从 `GameAssembly.dll` 里读出来的，数值来自 `globalgamemanagers.assets`
里的「Buff Config」资产（和 `BattleSystemSettings` 同一片区域，用同样的办法读）。

### 压制组件

`BrokenArrow.Client.Ecs.BattleSystem.Components.StressComponent`，七个字段，
偏移是从 `StressSystem.SetStressLevel` 的机器码里对出来的：

| 偏移 | 字段 | 说明 |
| --- | --- | --- |
| +0x00 | `MaxStress` | 单位表里的 `MaxStress` |
| +0x04 | `ShockedStressValue` | 黄线 |
| +0x08 | `PanickedStressValue` | 红线 |
| +0x10 | `PendingDamages` | 这一秒里待结算的压制伤害 |
| +0x18 | `CurrentStressValue` | 当前压制值 |
| +0x1c | `CurrentStressLevel` | 0 正常 / 1 Shocked（黄）/ 2 Panicked（红） |
| +0x20 | `TimeAfterLastDamage` | 离上次挨打多久 |

### 每秒怎么算

`StressSystem.Update` 每 `STRESS_TICK` 跑一次，`.cctor` 里把它写成 `1.0`，也就是一秒一次。
一秒之内有没有挨打是二选一的（`cmp [PendingDamages+0x18], 0`）：

```
挨打了（ApplyStressDamage）：
    压制值 = min(压制值 + Σ这一秒的压制伤害, MaxStress)，再夹到 ≥ 0
    TimeAfterLastDamage = 0
    清空 PendingDamages

没挨打（StressRecovery）：
    TimeAfterLastDamage += STRESS_TICK
    压制值 = max(0, 压制值 − (floor(TimeAfterLastDamage) × StressRecoveryMultiplier + 1))
```

恢复是**加速**的：停火第一秒退 2 点，第二秒 3 点，第三秒 4 点……所以断断续续地打压不住人，
一梭子打满才有意义。

单次命中加多少，`BattleSystemHelpers.CalculateStressDamage(maxStress, healthDamage, stressDamage, targetMaxHealth)`
只有四条指令：

```
压制伤害 = 弹药的 StressDamage + MaxStress × (这一下掉的血 ÷ 目标满血)
```

第二项意味着**掉血本身就是压制**：削掉 10% 的血就等于加 10% 的压制上限，
所以大口径弹在压制上是双重收益。`HitDamageInfo` 里另有 `StressAOEDamageModifier`，
溅射范围用弹药的 `StressAOERadius`（一般比 `HealthAOERadius` 大），这部分我们只算了直击的目标。

### 定级

`SetStressLevel`：

```
压制值 < 红线 → 等级 = 压制值 ≥ 黄线 ? 1 : 0
压制值 ≥ 红线 → 等级 = 2（已经是 2 就什么都不做）
```

红了之后必须等压制值掉回红线**以下**才会降级。黄线红线 = `MaxStress ×` Buff Config 里的倍率：

| | 黄线倍率 | 红线倍率 |
| --- | --- | --- |
| 车辆 / 飞机 | `ShockedLevelMultiplier` 0.5 | `PanickedLevelMultiplier` 0.8 |
| 步兵 | `ShockedLevelMultiplierInfantry` 0.4 | `PanickedLevelMultiplierInfantry` 0.8 |

`StressRecoveryMultiplier` = 1。这三条是本文里唯一**没有**直接读到赋值现场的：
组件是在生成单位时内联初始化的，没有单独的函数可抓；但单位表里除了 `MaxStress`
再没有别的压制字段，组件也只有这两个阈值，所以只可能是这么乘出来的。

### 黄红两档的惩罚

Buff Config 的 `StressModifiers` 是个 `键 → 17 个 float` 的字典，序列化下来键的顺序是 1、2、0：

| 乘数 | 黄（车辆） | 红（车辆） | 黄（步兵） | 红（步兵） | 黄（飞机） | 红（飞机） |
| --- | --- | --- | --- | --- | --- | --- |
| 瞄准时间 | 1.5 | 2 | 2 | 3 | 1.5 | 1.5 |
| 装填时间 | 1.25 | 1.5 | 1.25 | 1.5 | 1 | 1 |
| 连发间隔 | 1 | 1 | 1.25 | 1.5 | 1 | 1 |
| 散布 | 1.15 | 1.52 | 1.15 | 1.52 | 1.5 | 2 |
| 导弹命中 | 0.85 | 0.5 | 同左 | 同左 | 1 | 1 |
| 移动速度 | 0.6 | 0.2 | 同左 | 同左 | 同左 | 同左 |

（导弹命中和移动速度是三类共用的一项；飞机的导弹命中不受压制影响。）

### 步兵掉人

`InfantryUnitComponent` 里 `HealthPerSoldier` 在 `UnitBuilder.InitUnitHealth` 里写成
`满血 ÷ 班组人数`。`InfantryDeathHealSystem.InternalUpdate` 每帧算一次：

```
活着的人数 = clamp(ceil(当前血量 ÷ HealthPerSoldier), 0, 班组人数)
```

（`ceil` 是 `roundsd xmm0, xmm0, 0xa`，向上取整。）少了就调 `KillSquadSolders`，多了就 `HealSquad`。

谁先倒下看 `SquadMembers` 表里的 `DeathPriority`：`KillSquadSolders` 先把 `edi` 置成
`INT_MIN` 扫一遍取**最大值**，再把所有等于这个值的人收进一个列表，从里面**随机**挑一个。
所以是「优先级数字大的先走，同级随机」——没有特殊武器的普通步枪手通常是 3 或 4，
班长和扛反坦克的通常是 1，最后才轮到他们。

计算器把这两套机制接了起来：`simulate()` 让所有能同时开火的武器按各自的弹匣节奏打，逐秒结算压制、掉血、掉人，
给出变黄、变红、打死的时刻和整条时间轴。还没算进去的：弹丸飞行时间、导弹中途丢失、
溅射给旁边单位的压制。

### 发射通道别搞反了

`CanUseFiringChannel` 进门第一件事：

```
esi = [weapon + 0xc0]      // WeaponChannel
test esi, esi
je  → return true          // 通道 0 直接放行
```

**通道 0 等于不占通道**，这类武器各打各的，互不干扰；只有同一个**非零**通道上的武器才会互相挡着
（直升机火箭巢、飞机的某些挂架靠这个分组）。游戏数据里 1191 件武器挂在通道 0 上，非零的只有 88 件，
所以「每个通道只算一件」如果连通道 0 一起算，坦克的同轴、步兵班里除了最强那把之外的所有枪
就全被吞掉了——总输出会被严重低估。

### 距离单位：数据里的射程要乘 2

数据库里的射程、散布、溅射半径都是世界单位，游戏界面上给玩家看的米数是它的**两倍**——
数据写 700 的坦克炮，游戏里显示 1400 m。计算全部留在世界单位里（比值不受影响，
和游戏本体的公式一致），只在显示的时候乘 2（`DIST_SCALE`）。
单位的长宽高是例外：那本来就是真实米数（艾布拉姆斯 7.6 m），不乘。

### 掩体和步兵减伤

**林区不减伤**——那是红龙的设定，这个游戏没有。林区只挡视野。平地也没有额外减伤。
真正压低伤害的是两条，都乘在**基础伤害**上，乘完才过装甲公式
（机器码里就是把一串乘数乘进 xmm6，再拿它当基础伤害调伤害公式）：

```
步兵自己抗打击   M = clamp01(floor + 每人加成 × 存活人数)
楼里             B = clamp01(0.18 + 0.02 × 楼里总人数)
无视掩体         effective(f) = f + (1 − f) × clamp01(弹药的 IgnoreCover)
两条都吃的时候   effective(M) × effective(B)
```

`M` 那两个系数在 `BuffConfig.StressModifiers` 里，**跟压制等级走**：

| 目标状态 | floor | 每人加成 | 10 人班组 |
| --- | --- | --- | --- |
| 正常 / 黄 | 0.36 | 0.02 | ×0.56 |
| 红（崩溃） | 0.1 | 0.1 | **×1.00** |

两个结论：**被压成红的步兵不但打不准，还直接不扛打了**；班组掉人之后剩下的反而更耐打
（3 个人是 ×0.42）。`BuffDebuffSystem.SetStressModifiers` 里是
`xmm1 = 人数 × [cfg+0x4c] + [cfg+0x48]`，再 clamp 到 [0,1]，乘进单位的受伤害乘数。

`B` 的两个数读自 `BuildingsConfig`（九月版本：`DamageModifierFloor` 0.18、
`DamageModifierPerSoldier` 0.02、`BuildingDamageThreshold` 5）。楼里的人数算的是
**这栋楼里所有班组**，不只是挨打的那一个。单发伤害超过门槛（5）的弹直接跳过楼房减伤——
大口径炮弹不吃楼。

`IgnoreCover` 是弹药表里的一个 **0~1 浮点**（不是开关）：数据里 493 种弹是 0，
22 种是 1，中间还有 0.08 ~ 0.5 的一堆。1 = 完全无视这两条减伤。

出处：`ShellHitSystem.DealUnitDamage` 里的 `effective()` 那一段和 `BuffDebuffSystem.SetStressModifiers`
是我自己反汇编核的；`BuildingsConfig`、`BuffConfig` 的数值是从 `globalgamemanagers.assets` 里读的。
两条乘数各自的公式和常量都对得上朋友那份提取。**还没完全核实的**：楼房那条的门槛具体接在哪、
`IgnoreCover` 是不是对 M 和 B 各抵消一次（我只在其中一处看到了 `effective()`，
另一处按朋友那份写的）。

### 装甲：方向装甲和统一装甲值是二选一

`Armors` 表里有八个方向装甲（动能前/侧/后/顶 + 破甲前/侧/后/顶）和一个单独的 `ArmorValue`。
统计下来**两者互斥**：235 个单位走方向装甲，246 个走统一值，没有单位两样都有。
步兵、飞机、直升机、皮薄的车都是后者——所以**飞机的方向装甲全是 0，不能当成「没装甲」**
（A-10 的 `ArmorValue` 是 30）。之前只给步兵用统一值，导致所有飞机在计算器里被当成裸奔，
防空导弹一发秒。

### 近炸引信

防空导弹不是撞上去的，是在目标旁边炸开，所以判定「命中」也吃不到直击伤害。
`BattleSystemConstants` 的静态构造函数里写死了两个数
（`[static+0x28] = 0x3f000000`、`[static+0x2c] = 0x3ea8f5c3`）：

| 常量 | 值 | 意思 |
| --- | --- | --- |
| `MISSILE_RADIOFUSE_HIT_PREDICTED_AVERAGE_DAMAGE_PROPORTION` | **0.33** | 一次近炸命中平均只打出 33% 的伤害，游戏 AI 就拿这个数预估 |
| `MISSILE_MISS_RADIOFUSE_TRIGGER_CHANCE` | **0.5** | 判定脱靶之后，引信还有一半概率照样起爆 |

（哪个是哪个：0.5 那个被丢进随机数函数做判定，0.33 那个进了伤害预估的算式。）

弹药表里的 `RadioFuseDistance` 就是起爆距离，**一律是溅射半径的 0.8 倍**
（40N6：溅射 40 / 近炸 32；AIM-7M：15 / 12）。判据得是**制导 + 有这个值**：
118 种弹药带这个字段，其中 58 种是非制导的——7.62 步枪弹也写着 5，那显然是命中检测
半径不是引信；剩下 60 种制导的全都能打空中目标，没有一种纯打地面的，正好就是防空弹
和空空弹这一批。非制导的高炮近炸弹（130mm AA 之类）也带这个字段，但游戏怎么处理它们
还没验，所以没算进来。

起爆距离的分布也拿到了。`SeekerSystem.GenerateMissVectorOnTarget`（RVA 0x809AC0）：

```
p = random(MIN, MAX)
擦身距离（到外壳） = p × 弹药的 RadioFuseDistance
擦身向量半径 = 目标 RoughRadius + 擦身距离
p > 1 → 标记 isCMMiss（擦出了触发半径）
```

`MIN / MAX` = `RADIUFUSE_MISS_DISTANCE_PROPORTION_MIN / MAX`，在 `BattleSystemSettings`
序列化偏移 **+396 / +400 = 0.6 / 1.4**（字段 55/56）。那一段的对齐是这么定下来的：
往前数 +376 = 0.8（`MAX_MISSILE_MISS_DISTANCE_PROPORTION`）、+380 = 200（`..._CAP`）、
+392 = 0.25（`MISSILE_OVERKILL_CLEAR_DELAY`）、+404 = 10（`MISSILE_MISS_ADDITIONAL_CLEARENCE`），
名字和数值全都对得上号。

所以计算器按 **p ∈ [MIN, 1]** 那一支（真在引信半径里起爆的）对溅射衰减曲线积分，
逐弹算出平均伤害比例。防空弹的近炸距离一律是溅射半径的 0.8 倍，积出来
**0.345 ~ 0.36**——和游戏自己写死的预估常量 **0.33** 对得上，两条独立的路子互相印证。
计算器用逐弹算出来的值，不用那个粗略常量。

### 军械库里不显示的单位

`Units.DisplayInArmory = false` 的有 72 个：跳伞的飞行员和机组、船（Zubr、LCAC、
Arleigh Burke、LHA-6）、TESTING DUMMY，还有 35 个**降落态的飞机**——
比如 `F-15EX Eagle II (landed)`，花费 9、分类是后勤、目标类型位是 4（地面车辆），
所以防空导弹锁不上它（它停在机场上，不算空中目标）。

另一类默认藏起来的是**配装变体**：母单位的「Squad loadout」一换就变成它，
它自己没有配装槽。步兵里 194 个有 **73 个**是这样（非步兵只有 5 个），
而且名字经常和母单位一模一样——`Rangers RRC`（自己有槽位）和 `Rangers RRC`（变体）
在列表里就是两行看不出区别的东西。判据是「被某个配装的 `ReplaceUnitId` 指到
**且** 自己没有配装槽」。

麻烦的是军械库那批的 `HUDName` 和正常单位是一样的（那架 landed 的 F-15 HUDName 就是
`F-15EX Eagle II`），搜出来像重复项。所以：这些单位用库里的 `Name`（带「(landed)」），
正常单位还是用 `HUDName`；单位选择器默认不列它们，勾「连隐藏单位一起列」才出来，
出来也带个「隐藏」标签。

### 伤害随机的只有近炸引信这一处

翻了一遍：**单发伤害本身**带随机的只有近炸引信（起爆距离 `p × RadioFuseDistance`，
`p = random(0.6, 1.4)`）。别的随机都不落在伤害数值上：

| 哪里随机 | 随机的是什么 |
| --- | --- |
| 命中判定 | 中不中（二值），计算器算的是期望 |
| 非制导散布 | 打偏之后落点在哪——落点决定溅射吃多少，已经按散布积分进期望里 |
| 装填 / 连发 / 瞄准时间 | 数据是 min~max，随机的是**节奏**不是伤害（计算器取中值） |
| 暴击（`CriticalBaseProbability` = 2%） | 触发的是**状态**：瞄准时间、光学、机动、散布、装填的乘数，不改伤害 |

所以计算器只给近炸弹画「最好 ~ 最坏」的浮动带：贴着最近处炸（p = MIN）最疼，
擦着引信边缘炸（p = 1）最不疼。

### 主动防护（APS）

数据里所有 APS 都是**冷却 6 秒、备弹 2 或 4 发**，`APSHitboxProportion` 一律是 2
（不区分单位，所以没拿它当概率用）。计算器按「每 6 秒拦一发可拦弹种，拦完备弹就不管用了」
接进时间轴：齐射打过去只有第一发会被吃掉，剩下的照常进伤害。

### 弹匣节奏：先急后慢

武器表里 `MagazineSize` / `TimeBetweenBursts` / `ReloadTime` 三个字段凑出来的节奏对
「两连发 + 长装填」这类武器很关键。布莱德利的双联 TOW：弹匣 2 发、两发之间 3.5 秒、
打空要装 10 秒，所以**前两发来得很快（1.5s、5s），第三发要等到 16.5s**。

「击杀时间」按这个真实节奏走，不是拿平均每发耗时乘出来的——两种算法差得不少：

| | 按真实节奏 | 按平均节奏 |
| --- | --- | --- |
| 布莱德利 TOW（2 发打死） | **5 s** | 9 s |
| 阿帕奇 JAGM（2 发打死） | **2 s** | 3.3 s |
| M1A2 主炮（3 发打死，单发武器） | 19 s | 19 s |

单发武器两种算法一致，所以这个差别只出现在有弹匣的武器上。秒伤那一栏还是用平均值
（那是稳态输出），两者各答各的问题。

这个节奏和 APS 的互动是实打实的：APS 冷却 6 秒，而双联 TOW 两发只隔 3.5 秒——
**第一发被拦，第二发必进**。

## 顺带能做的

`.dek` 解出来是卡组内容：分类 → 每张卡的单位 ID、配装选项、运输载具、张数，
所以「卡组工具」里能直接看一副卡组带了什么、每张多少钱（前提同样是填了密钥）。

还没用上的：弹道细节（初速、加速度、导引头角度）、炮塔转向死角、补给消耗——
要做更细的模拟的话数据都是现成的。
