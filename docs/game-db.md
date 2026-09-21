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
  3. 剩下的里面挑 Damage（+0x64）最高的那一发
```

**这一步不看穿不穿得动**——所以自动开火经常拿伤害高但穿深低的弹去啃正面。
另外烟雾弹和激光制导弹是另一条请求路径（`GenerateSmoke` / `LaserGuided` 两个标志），
普通开火不会选它们。

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

### 还没拿到的：打中之后掉多少血

`BattleSystemHelpers` 里有 `DamageFormulaKinetic` 和 `DamageFormulaHEAT` 两条公式
（还有 `CalculateHitDamage` / `CalculateHitDamageWithThreshold` / `CalculateCQCHitDamage`）。
HEAT 那条反汇编出来是：

```
伤害 × pow(穿深, k) / (pow(穿深, k) + c × pow(装甲, k))
```

也就是说**穿甲不是二值的**，是一条软比值曲线：穿深比装甲高就掉得多，低也不是完全零。
动能那条结构类似，外加一个上限。

问题是 k 和 c 这些系数存在运行时的 `BrokenArrow.Client.Ecs.Configs.GameConfig` 对象里
（机器码里是 `[config+0x16c]`、`[+0x170]`、`[+0x174]`、`[+0x178]`），既不在编译好的单位库里，
也没在这些表里，所以暂时拿不到。

**计算器现在按「穿深 ≥ 装甲 = 满伤，否则 0」估算，界面上标了。**
穿深、装甲、伤害这些输入都是真值，只有「打中掉多少血」这一步是近似。
拿到那四个系数就能把这一块也变成真的。

### 哪些是直读，哪些是推的

**直读**（游戏里怎么写就怎么用）：伤害、穿深、装甲、射速、射程、AOE 半径、ECM/诱饵/APS 的参数。

**推算**（没有权威来源，我们自己定的规则，界面上都标了）：

- **穿甲判定 = 穿深 ≥ 装甲**。依据是数值本身就是照这个调的：M829A4 穿深 840，M1A2 SEP v3 正面动能 850 —— 差 10 点，正好「自己打不穿自己」。侧面 120 就随便穿。
- **穿深随距离线性掉**：近距穿深 → 地面射程处的穿深之间插值（两个值一样的导弹就不掉）。
- **目标外壳半径**：AOE 是从外壳算距离的，但外壳是碰撞体，数据里只有长宽高，
  所以按长宽的外接圆半径近似。
- **溅射也要过穿甲判定**：不然「打不穿的 HE 照样炸死坦克」，反应装甲就没意义了。
- **打死要几秒**：瞄准 + 后面每发按弹匣节奏（点射间隔、装填）平摊。

## 顺带能做的

`.dek` 解出来是卡组内容：分类 → 每张卡的单位 ID、配装选项、运输载具、张数，
所以「卡组工具」里能直接看一副卡组带了什么、每张多少钱（前提同样是填了密钥）。

还没用上的：弹道细节（初速、加速度、导引头角度）、炮塔转向死角、补给消耗、
班组成员的死亡顺序——要做更细的模拟的话数据都是现成的。
