在线体验：[https://time.pudiu.com](https://time.pudiu.com)

下载：[https://time.pudiu.com/down.html](https://time.pudiu.com/down.html)


# Pudiu Time 桌面版

[把线上翻页时钟](http://time.pudiu.com) 一台电脑就能跑的单机系统：翻页时钟 + 本地视频/图片轮播 + 多时区底座 + 数字标牌投放。
**不需要服务器、不需要后台管理端**，素材和配置全部保存在本机。

---

## 一、快速开始（三种启动方式，选一种即可）

| 方式 | 操作 | 适合 |
| --- | --- | --- |
| **① 双击 `启动桌面版.bat`**（工作区根目录） | 自动优先启动已打包程序，没有则自动装依赖后用源码启动 | 日常使用，最省事 |
| **② 双击 `dist\PudiuTime 1.0.0.exe`** | 免安装版，直接跑打包好的程序 | 拷给别人用 |
| **③ `dist\PudiuTime Setup 1.0.0.exe`** | NSIS 安装版，装完有桌面快捷方式 | 长期投放、开机自启 |

开发调试才用 `npm start`（必须先 `npm install`）。

> ⚠️ 若窗口一闪而过或没起来：多半是环境变量 `ELECTRON_RUN_AS_NODE=1` 在作祟（VS Code 等环境会注入）。
> 启动脚本已自动清除该变量；命令行启动前也请执行 `set ELECTRON_RUN_AS_NODE=`。
> 排障日志在：`%TEMP%\pudiu-time-desktop.log`

---

## 二、核心能力

| 模块 | 说明 |
| --- | --- |
| 翻页时钟 | 毫秒对齐的自校正走时引擎，24/12 小时制、缩放、字体、卡片底色、字色、水平/垂直镜像 |
| 本地素材库 | 导入本机视频/图片（多选），自动生成缩略图，索引持久化，重启不丢失 |
| 轮播播放 | 勾选素材进入播放列表，顺序/随机切换，图片按停留时长切换、视频播完自动下一条，**视频音量可调** |
| 在线壁纸 | 内置网页版同款在线素材库（联网时可用） |
| **Bing 每日壁纸** | 走站点 `bing.php` 代理随机取图；可「设为背景 / 换一张」，支持**每日 0 点后自动更新**；Bing 模式下按 `N`/`P` 或「下一张」即换一张随机图（与网页版一致） |
| 多时区底座 | 自动 IP 定位本地时区 + 手动添加全球城市，最多挂 4 个 |
| 背景音乐 | 选择本地 mp3/wav，音量可调，随程序记忆 |
| 桌面投放 | 开机自启、窗口置顶、指定显示器全屏、关闭最小化到系统托盘、启动即全屏 |
| 防误触 | L 键锁屏待机，鼠标/按键唤醒提示，适合展会现场 |
| 多语言 | 内置 23 种语言（沿用网页版 i18n 词典） |

### 快捷键

| 键 | 作用 |
| --- | --- |
| `F` | 全屏 / 退出全屏 |
| `L` | 锁屏待机（再按 L 解锁） |
| `N` / `P` | 下一张 / 上一张背景 |
| `B` | 打开 / 关闭素材库面板 |
| `Esc` | 关闭素材库面板 |

---

## 三、目录结构

```
PudiuTime/
├─ main.js          主进程：窗口/托盘/自启/多显示器/media:// 协议/配置持久化
├─ preload.js       安全桥接（contextIsolation），暴露桌面能力给渲染层
├─ package.json     依赖与 electron-builder 打包配置
├─ 启动.bat         一键启动（自动装依赖、清理冲突环境变量）
├─ assets/icon.ico  窗口与托盘图标
└─ src/
   ├─ index.html    界面（自绘无边框标题栏 + 三屏滚动结构）
   ├─ app.js        渲染层逻辑：走时/时区/背景轮播/素材库/设置
   ├─ desktop.css   桌面专属样式
   ├─ style.css     原网页样式（沿用）
   ├─ i18n_full.json 多语言词典（沿用）
   └─ bg_assets.json 在线壁纸清单（沿用）
```

配置与素材索引存放位置：`%APPDATA%\pudiu-time-desktop\config.json`
缩略图缓存：`%APPDATA%\pudiu-time-desktop\thumbs\`
（设置面板底部有「打开配置与素材目录」按钮）

---

## 四、本地素材是怎么加载的？

渲染层跑在 `file://` 下，`fetch`/直接 `file://` 引用会被 Chromium 拦。
因此主进程注册了自定义协议 **`media://`**：

- `media://local/<编码后的绝对路径>`
- 支持 HTTP `Range`，大视频可拖动、可循环，不整包读入内存
- 自带 `Access-Control-Allow-Origin`，缩略图才能用 canvas 抓取

素材只存**路径索引**，不复制文件，删除索引不会动你磁盘上的原文件。

---

## 五、打包成 exe（已完成）

依赖已装好，直接执行：

```bash
npm run dist
```

国内网络请先设置镜像，否则会卡在下载环节：

```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm run dist
```

### 实测产物（electron-builder 26.15.3 / Electron 44.7.0 / win32-x64）

| 文件 | 大小 | 说明 | 测试结果 |
| --- | --- | --- | --- |
| `dist\PudiuTime Setup 1.0.0.exe` | ~107 MB | NSIS 安装包，可装到任意目录，建桌面/开始菜单快捷方式 | 构建成功 |
| `dist\PudiuTime 1.0.0.exe` | ~106 MB | portable 免安装版，双击即用（自解压到临时目录运行） | ✅ 已启动，窗口与走时正常 |
| `dist\win-unpacked\PudiuTime.exe` | — | 免打包的原始运行目录，排障用 | ✅ 已启动，渲染层无报错 |

验证方式：启动后窗口标题正常、渲染层 boot 日志完整、无异常堆栈
（日志路径 `%TEMP%\pudiu-time-desktop.log`）。

> 注意：本机若存在 `ELECTRON_RUN_AS_NODE=1`（VS Code 等环境会注入），打包出的 exe 也可能起不来，
> 打包前同样要先 `set ELECTRON_RUN_AS_NODE=`。

---

## 六、常见问题

**Q：窗口起来了但背景黑屏？**
A：默认使用在线壁纸，离线环境会黑屏。打开右侧设置 → 点「纯色背景」取色，或按 `B` 导入本地素材。

**Q：视频背景没有声音？**
A：依次确认三点：① 素材库面板里「视频静音播放」是**关**的；② 「视频音量」滑块不是 0（默认 80%）；③ 视频文件本身有音轨。
   旧版本默认值是「静音 + 音量 0」，即使取消静音也听不见——新版启动时会把这种组合自动修正为 80%。

**Q：Bing 壁纸怎么用？**
A：下滑到媒体中心 → 切到「在线壁纸」页签 → 顶部 Bing 卡片 → **设为背景** / **换一张**；勾选「每日 0 点自动更新」后每天跨天自动换图。
   Bing 模式下按 `N`/`P` 也是换一张随机图。图片来自站点 `bing.php` 代理（无需 API Key，离线时会自动回退到默认图）。

**Q：想让开机就自动全屏投放？**
A：设置面板 → 桌面投放 → 打开「开机自动启动」+「启动即全屏投放」，并选择目标显示器。

**Q：背景音乐开关打开了但没声音？**
A：桌面版**没有内置在线音源**，必须先「选择本地音频…」选一个 mp3/wav。选过之后路径会写进配置，下次启动自动续上。
若没选文件就打开开关，现在会弹出提示并自动关掉开关（旧版是静默失败）。

**Q：弹出 `Error launching app / Unable to find Electron app at ...`？**
A：这是把 Electron 指向了**不是应用目录**的文件夹。请确认只从上面「三种启动方式」进入；
不要手动执行 `electron <某个子目录>`。旧版本工程里曾有个临时诊断目录 `tools/media-test`，已删除。

**Q：关闭窗口后程序还在？**
A：默认「关闭时最小化到托盘」，双击托盘图标恢复；托盘菜单里可真正退出。

---

## 七、已修复问题记录（排障参考）

排查入口：主进程与渲染层日志都会写入 `%TEMP%\pudiu-time-desktop.log`。
启动时日志会打出关键自检信息，例如：
`[PudiuTime] 桌面版已启动 | 素材 1 个 | 在线壁纸 19 张 | 语言包 23 种`
——哪一项是 0，就说明对应的链路断了。

| 现象 | 根因 | 修复 |
| --- | --- | --- |
| 在线壁纸列表空空如也 | 主进程**漏注册** `asset:read` IPC，渲染层拿不到 `bg_assets.json`（`file://` 下又不能直接 fetch） | 主进程补 `ipcMain.handle('asset:read')`，用 `fs` 读 `src/` 下资源 |
| 本地视频/图片背景不显示、缩略图抓不到 | `media://` 自定义协议注册时缺 `corsEnabled: true`，Chromium 对带 CORS 检查的请求直接拦截 | privileges 加 `corsEnabled`、`allowServiceWorkers` |
| 重启后背景音乐失效 | 音频只存了 blob URL（会话有效），路径没用来恢复 | 落盘 `file.path`，启动时 `ensureAudioSource()` 用 `media://` 重建音源 |
| 导入素材后画面没变化 | 导入只入库、不自动投放 | 首次导入或当前无背景素材时，自动投放到背景 |

验证结论（本机实测）：本地 36MB mp4 加载并轮播正常（`muted=false` 有声）、在线壁纸 19 张、语言包 23 种、音源从配置恢复成功。

https://www.youtube.com/watch?v=WLcd7QxVl-o

更多工具：[https://tool.pudiu.com/](https://tool.pudiu.com/)
