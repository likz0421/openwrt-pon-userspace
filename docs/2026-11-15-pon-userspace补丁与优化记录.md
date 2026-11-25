# pon-userspace 补丁与优化记录（bugfix）

起始：2026-11-15
上游：`pbs05/openwrt-pon-userspace`，对比基准 `upstream/main a903fcc`（2026-11-16，2026-11-24 拉取）。
范围：`bugfix` 分支来源于主分支，因此本文件记录两类优化——相对上游仓库的（已在主分支，见第一节）与相对主分支的（仅 bugfix）。主分支另有一份只含相对上游的 main 版；与主分支合并时本文件冲突保留 bugfix 版（全集），并把主分支新增/变更的优化行并入。

记录规范：

- 表列：优化项、优化方案简介、关联提交、合入状态、验收状态、验收说明。
- 合入状态列只记 `已合入主分支`/`未合入（仅 bugfix）`。
- 验收状态列只记录实机验证结果（`已验收`/`待验收`，括号内可注场景或阻塞原因）；其余记 `—`。
- 合并冲突若只落在版本号，取 bugfix 侧更高值再 +1。

## 一、相对上游（已合入主分支）

| 优化项 | 优化方案简介 | 关联提交 | 合入状态 | 验收状态 | 验收说明 |
|---|---|---|---|---|---|
| luci-app-pon 概览页光模块状态卡片 | 概览页新增光模块状态卡片，经 `ponctl frontend` 读 rx/tx/温度，读不到时整卡隐藏 | `9667359`；本分支 `819c562` 合并主分支 | 已合入主分支 | 待验收（未进固件） | 不适用标准 SFP/ethtool -m 口径；进固件后核卡片读数与读不到时的隐藏 |
| 光模块卡片补线路模式/线路状态/ONU 状态 | 卡片内补线路模式、线路状态与 ONU 状态；无 WiFi 机型不加载 hg5585f 配置 | `1128d06`；本分支 `819c562` 合并主分支 | 已合入主分支 | 待验收（未进固件） | 进固件后核三项显示与无 WiFi 机型的配置加载 |
| 忽略 IDE 与 tmp | 忽略 IDE 与 tmp 目录 | `5cd9a46`；本分支 `819c562` 合并主分支 | 已合入主分支 | — | 仅仓库整理，不进固件 |

## 二、仅 bugfix（相对主分支）

| 优化项 | 优化方案简介 | 关联提交 | 合入状态 | 验收状态 | 验收说明 |
|---|---|---|---|---|---|
| LOID 补零方向可选、链路层原始报文展示、pon-reopen 配套 | LOID 左/右补零可选；展示链路层原始报文；提供 EPON LLID 卡死时线路重开的用户态入口（驱动侧 worker 见 drivers `d574aed`），LuCI PON 配置页与状态页随之增项 | `e5f85de`（含 `992124c` 发布号 4、`75ab52c` 缩进修正） | 未合入（仅 bugfix） | 待验收 | 需在要求特定 LOID 补零方向的 EPON OLT 上验注册；LLID 卡死场景验 pon-reopen 入口 |

其余与主分支的差异只有版本号与本文档；功能内容一致。

## 三、待办

- 实机验收 `e5f85de`：需要特定 LOID 补零方向的 EPON OLT 上验注册；LLID 卡死场景验 pon-reopen 入口。
- 光模块卡片待进固件后在 XG-040G-MD 上验收。
- 外部优化候选池（第四节）逐项拍板是否合入 bugfix。

## 四、外部优化候选池

2026-11-25 对上游三仓库 issue/PR 与社区 fork 做全量审计（141 条 issue/PR、约 230 个 fork，37 个活跃 fork 逐提交对比）。本节只登记、不合入：是否合入 bugfix 后续逐项拍板；拍板合入后按单项单提交移植进第二节，并从本节标注去向。状态口径：`候选`＝值得移植、待拍板；`关注`＝场景不符或未证实、保持跟踪；`拒绝`＝不适用，留原因避免重复评估。上游 PR 的提交 ID 为审计时 `refs/pull/<N>/head` 的 head，PR 后续更新需在移植前重取。

### 上游 pbs05/openwrt-pon-userspace 未合入 PR

| 候选项 | 来源 | 提交 ID | 状态 | 备注 |
|---|---|---|---|---|
| CTC 多 VLAN 实例支持 | [#14](https://github.com/pbs05/openwrt-pon-userspace/pull/14) | `3f892688018d1b7f5778695915326b99ebfcfba6` | 候选 | LuCI CTC VLAN IDs 显示不全；烽火 CT 实机验证 [4092]→[140,4092]，单实例 OLT 行为不变。本机 CTC 线路直接相关 |
| 华为 OLT 厂商 ME + ANI-G 适配 | [#17](https://github.com/pbs05/openwrt-pon-userspace/pull/17) | `98999ac14d90c0de253cf68620d587d8c23aef80` | 关注 | 作者在 MD 上验证；本机 OLT 下发正常，暂无症状，换 OLT 时再评估 |
| RX 元数据快照 | [#10](https://github.com/pbs05/openwrt-pon-userspace/pull/10) | `811e07d019e08c83ee5cb781cbd7282c7a2166f3` | 关注 | PonWrt#101 配套观测，等驱动侧 MBI 取证需求明确后再看 |
| IPTV bridge-vlan 重构 | [#6](https://github.com/pbs05/openwrt-pon-userspace/pull/6) | `ee1703646e7509b5707cd03eab3ee929feba8cd6` | 关注 | 已关闭未合入；本机 IPTV 现方案可用，仅作重构参考 |

### 社区 fork 与外部提交

| 候选项 | 来源 | 提交 ID | 状态 | 备注 |
|---|---|---|---|---|
| UCI 变更自动重载 daemons | [NNdroid/openwrt-pon-userspace](https://github.com/NNdroid/openwrt-pon-userspace) | `cfb8f64ed1389b684006d31dc852a3b0ed1b1dc9` | 候选 | UCI 配置变更后自动重载相关守护进程，免手动重启；需核对重载范围与现 service trigger 是否重叠 |
| pond OOM 守护 | [wuziwei/ponwrt-ZN504-HG5585F](https://github.com/wuziwei/ponwrt-ZN504-HG5585F) | `713311e9bb87cd506d2ee9b54e0a2f3ab590e1ab` | 候选 | 提交在 ponwrt fork，内容属 airoha-pond；本机有 mosdns+clash 两次 OOM 前科，512MB 值得评估 |
| OAM 身份重认证刷新 | [NNdroid/openwrt-pon-userspace](https://github.com/NNdroid/openwrt-pon-userspace) | `df63826f4b6928a13fc9480d9cf8f0911210eea0` | 关注 | 重认证时刷新 OAM 身份；本机注册稳定，无症状 |
| CTC SN 格式 + i18n | [NNdroid/openwrt-pon-userspace](https://github.com/NNdroid/openwrt-pon-userspace) | `b7ba944822a80cb9c3444c1aa39875df22cb43c6` | 关注 | CTC SN 输入格式校验与翻译；外观/易用类，非功能缺陷 |
| vlanscan 工具系列 | [NNdroid/openwrt-pon-userspace](https://github.com/NNdroid/openwrt-pon-userspace) | `719eda769ce9be81c7febf76efc5f420785bb893`（首提交，系列多笔） | 关注 | VLAN 扫描调试工具；需要时再整系列评估 |
| 模式感知诊断 | [NNdroid/openwrt-pon-userspace](https://github.com/NNdroid/openwrt-pon-userspace) | `d4bc7e3551bece2ac06a47941d39f131e6c0b843`、`942b84ae989817dea26ada7109202d30c85edef8` | 关注 | 按 XG-PON/EPON 模式区分诊断输出；与现有 ponctl 诊断重叠度待对比 |
| 身份工具 + 线路重开 | [NNdroid/openwrt-pon-userspace](https://github.com/NNdroid/openwrt-pon-userspace) | `f01d709f743c44db96fdb5d73a613c63a88c539b` | 关注 | 与第二节 `e5f85de` 的 pon-reopen 方向重叠，移植前须对比避免双实现 |

### 跟踪中的 issue（无现成提交）

| 候选项 | 来源 | 提交 ID | 状态 | 备注 |
|---|---|---|---|---|
| ALCL OLT 缺 ME 实例 | [#15](https://github.com/pbs05/openwrt-pon-userspace/issues/15) | —（issue 内含已验证修复代码） | 关注 | 诺基亚/ALCL OLT 场景；本机 OLT 非 ALCL，换局端时再评估 |
| 组播 GEM 泛洪 | [#8](https://github.com/pbs05/openwrt-pon-userspace/issues/8) | — | 关注 | 关联 PonWrt#88；IPTV 组播场景，现方案未受影响 |