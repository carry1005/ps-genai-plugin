# AI修图插件byCarry · Photoshop 插件

一个基于 **Adobe UXP** 的 Photoshop 面板插件：**框选一块区域 → 在聊天框输入文字 → 调用文生图/图生图模型 → 结果作为新图层写回原位置**。

支持多模型自由切换、各自独立填写 API Key，主打 **Google Nano Banana (Gemini Image)**，同时内置 OpenAI、Stability 及自定义端点。

---

## ✨ 功能特性

- **框选即图生图**：用选框工具圈定区域，结合提示词对该区域重绘 / 编辑。
- **多模型可切换**：
  - Google **Nano Banana**（`gemini-2.5-flash-image`，可改 `gemini-3-pro-image-preview`）
  - OpenAI **GPT-Image**（`gpt-image-1`，图像编辑端点）
  - **Stability AI**（Core / SD3 / Ultra，支持图生图强度）
  - **通义千问 Qwen / 万相**（DashScope，`wanx2.1-imageedit` 图像编辑，异步任务制）
  - **自定义端点**（任意 OpenAI 兼容的 `/v1/images/edits`）
- **密钥分模型加密存储**：使用 UXP `secureStorage`，不落明文。
- **结果自动回位**：以**智能对象**新图层置入，并精确缩放/平移覆盖原选区（可继续无损调整）。
- **无选区回退整图**、**上传尺寸上限**（省时省钱，放回时无损还原尺寸）。
- **取消、进度、实时选区状态**、参数与上次选择自动记忆。
- 针对**公司网络（代理 / SSL 中间人）**做了专门的错误提示。

---

## 🧩 系统要求

- **Photoshop 24.0（2023）或更高**（依赖 `imaging` 与 `batchPlay placeEvent`）。
- **Adobe UXP Developer Tool (UDT)** 用于开发加载（[下载](https://developer.adobe.com/photoshop/uxp/devtool/)）。

---

## 🚀 安装与加载（开发模式）

1. 打开 Photoshop。
2. 安装并打开 **UXP Developer Tool**。
3. 点击 **Add Plugin**，选择本项目的 `manifest.json`。
4. 在该插件行点击 **Load**（或 Actions → Load）。
5. Photoshop 中 **插件 → AI修图插件byCarry** 即可看到面板（也可在 UDT 里点 ••• → Load 到指定 PS）。

> 修改代码后，在 UDT 里点 **Reload** 即可热更新。

---

## 📋 使用步骤

1. 打开任意图片文档。
2. 用**选框工具（M）**框选要修改的区域。
3. 在面板 **①** 选择模型，**②** 填入对应 API Key 并 **保存密钥**。
4. **④ 提示词**里描述想要的修改，例如：
   - `把这件外套改成红色皮夹克，保留人物姿态与光照`
   - `remove the background and make it pure white`
   - `把天空替换成黄昏火烧云`
5. 点 **生成**。完成后会在当前文档新增一个图层，覆盖原选区位置。

> 没有选区时，若勾选了「无选区时改用整张画布」，则对整图进行图生图。

---

## 🔑 各模型如何获取 API Key

| 模型 | 获取地址 | 备注 |
|---|---|---|
| Nano Banana (Gemini) | https://aistudio.google.com/apikey | 个人 Google 账号免费创建；图像生成有免费额度 |
| OpenAI GPT-Image | https://platform.openai.com/api-keys | 需绑定付费 |
| Stability AI | https://platform.stability.ai/account/keys | 按量计费 |
| Qwen / 万相 (DashScope) | https://bailian.console.aliyun.com | 阿里云百炼控制台，`sk-` 开头 |
| 自定义 | 你的服务商 | OpenAI 兼容 `/images/edits` |

---

## 🏢 公司网络注意事项（重要）

如果你在带 **代理 + SSL 中间人 + DLP** 的公司网络下使用：

1. **域名白名单**：UXP 只允许访问 `manifest.json → requiredPermissions.network.domains` 里列出的域名。已内置：
   ```
   https://generativelanguage.googleapis.com   (Gemini / Nano Banana)
   https://api.openai.com                      (OpenAI)
   https://api.stability.ai                    (Stability)
   https://dashscope.aliyuncs.com              (Qwen / 万相 提交与轮询)
   https://*.aliyuncs.com                      (Qwen 结果图 OSS 下载)
   ```
   **使用「自定义端点」时，必须把它的域名加进这里**，否则请求会被 UXP 直接拦截。
2. **证书**：UXP 的网络请求通常走系统证书库，一般能信任公司根证书；若报 `certificate / SSL` 错误，请联系 IT 信任根证书，或改用个人网络。
3. **代理**：UXP 一般继承系统代理设置。若超时，确认系统代理可达目标域名。
4. **合规**：把选区图像上传到外部 AI 服务前，请确认不违反公司数据外发政策。

---

## 🛠️ 故障排查

| 现象 | 可能原因 / 解决 |
|---|---|
| 面板加载不出来 | PS 版本低于 24.0；或 manifest 报错。看 UDT 的日志。 |
| `请求被拦截 / Failed to fetch` | 目标域名不在 manifest 白名单；或代理/网络不通。 |
| `certificate / SSL` 错误 | 公司 SSL 中间人；让 IT 信任根证书或换网络。 |
| Gemini「未返回图片，仅返回文本」 | 提示词缺少明确编辑指令，或被安全策略拦截；换更具体的指令。 |
| OpenAI / Stability 上传失败 | 旧版 UXP 对 `FormData/Blob` 支持不全；升级 Photoshop。 |
| 选区导出报 `format` 错误 | 个别版本 `imaging.encodeImageData` 不支持 png：把 `src/selection.js` 里 `format: "png"` 改为 `"jpg"`。 |
| 新图层位置/大小不对 | 极少数变换边界异常；图层已置入，可手动用自由变换（Ctrl/Cmd+T）微调。 |
| Qwen 报错 / 等待超时 | DashScope 为异步任务制；确认 key 有万相权限、`wanx2.1-imageedit` 可用；若提示 base64 不被接受，则该模型要求公网图，需换支持 base64 的模型。 |

---

## 📁 项目结构

```
ps-genai-plugin/
├── manifest.json        # UXP 插件清单（含网络域名白名单、面板定义）
├── index.html           # 面板 UI 结构
├── styles.css           # 面板样式（跟随 PS 深色主题）
└── src/
    ├── utils.js         # base64/Blob 等通用工具
    ├── storage.js       # 密钥(secureStorage)与设置(localStorage)
    ├── models.js        # 多模型适配器层（新增模型只改这里）
    ├── selection.js     # 选区读取 + imaging 像素导出
    ├── layers.js        # placeEvent 置入 + 缩放平移对齐
    └── main.js          # 面板主控制器（串联全流程）
```

### 如何新增一个模型

在 `src/models.js` 的 `MODELS` 数组里加一项：定义 `id / label / keyHint / fields / generate`，其中 `generate({ imageBase64, prompt, apiKey, options, signal })` 返回 `{ base64, mimeType }` 即可。UI 会根据 `fields` 自动渲染参数控件。若用到新域名，记得加进 `manifest.json` 白名单。

---

## 📦 打包发布（可选）

用 UXP Developer Tool 的 **Package** 生成 `.ccx`，双击即可安装到 Photoshop；或通过 Adobe Exchange / Creative Cloud 分发。

---

## ⚠️ 免责声明

本插件仅作为调用第三方生成式 AI 服务的客户端，生成内容的版权、合规与费用由对应服务商与使用者负责。请遵守各模型服务条款与所在组织的数据政策。
