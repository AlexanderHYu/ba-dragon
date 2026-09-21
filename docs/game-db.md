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

## 顺带能做的

`.dek` 解出来是卡组内容：分类 → 每张卡的单位 ID、配装选项、运输载具、张数，
所以「卡组工具」里能直接看一副卡组带了什么、每张多少钱（前提同样是填了密钥）。

还没用上的表：装甲、武器、弹药、传感器、机动、炮塔、班组成员——
真要做「单位百科」或者「这套配装贵在哪」的话，数据都是现成的。
