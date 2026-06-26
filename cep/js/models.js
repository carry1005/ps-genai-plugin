/*
 * models.js — 多模型适配器层
 *
 * 设计：所有模型实现统一的 generate() 接口，返回 { base64, mimeType }。
 * UI 根据每个模型的 fields 定义动态渲染参数控件，因此新增模型只需在 MODELS 里加一项。
 *
 * 统一入参：
 *   { imageBase64, prompt, apiKey, options, signal }
 *     imageBase64 — 框选区域导出的 PNG（base64，无 dataURL 前缀）
 *     prompt      — 聊天框文字
 *     apiKey      — 对应模型的密钥
 *     options     — 该模型的参数（与 fields.key 对应）
 *     signal      — AbortSignal，用于取消
 */
(function (root) {
  "use strict";
  const PSAI = (root.PSAI = root.PSAI || {});
  const U = PSAI.utils;

  // ---------- 通用网络层 ----------

  /** 把外部 signal 与超时合并成一个新的 signal */
  function withTimeout(signal, ms) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    const t = setTimeout(() => ctrl.abort(), ms);
    return {
      signal: ctrl.signal,
      clear() {
        clearTimeout(t);
        if (signal) signal.removeEventListener("abort", onAbort);
      },
    };
  }

  /** 把底层网络异常翻译成对用户（尤其公司网络）更有用的提示 */
  function networkHint(e) {
    const msg = (e && e.message) || String(e);
    if (/certificate|self.signed|SSL|TLS/i.test(msg)) {
      return (
        "网络/证书错误：" +
        msg +
        "。若在公司网络下，可能是 SSL 中间人根证书导致。UXP 通常走系统证书库，" +
        "如仍失败请联系 IT 信任公司根证书，或改用个人网络。"
      );
    }
    if (/Failed to fetch|NetworkError|ECONN|ENOTFOUND|proxy|timed?\s?out/i.test(msg)) {
      return (
        "网络连接失败：" +
        msg +
        "。请检查代理/网络连通性；并确认该域名已加入 manifest.json 的 network.domains 白名单。"
      );
    }
    return msg;
  }

  /** 统一 fetch：注入超时与取消，自动解析 JSON。返回 { res, data, raw } */
  async function apiFetch(url, init, signal, timeoutMs) {
    const to = withTimeout(signal, timeoutMs || 120000);
    try {
      const res = await fetch(url, Object.assign({}, init, { signal: to.signal }));
      const raw = await res.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch (e) {
        data = { _raw: raw };
      }
      return { res, data, raw };
    } catch (e) {
      if (e && e.name === "AbortError") {
        throw new Error(signal && signal.aborted ? "已取消。" : "请求超时（超过限制时间）。");
      }
      throw new Error(networkHint(e));
    } finally {
      to.clear();
    }
  }

  /** 从各家不同结构的错误响应里尽量提取可读信息 */
  function extractErr(data) {
    if (!data) return "";
    return (
      U.get(data, "error.message") ||
      U.get(data, "errors.0") ||
      U.get(data, "message") ||
      (typeof data.error === "string" ? data.error : "") ||
      U.get(data, "_raw") ||
      ""
    );
  }

  function collectText(candidates) {
    let out = "";
    (candidates || []).forEach((c) => {
      (U.get(c, "content.parts", []) || []).forEach((p) => {
        if (p && typeof p.text === "string") out += p.text + " ";
      });
    });
    return out.trim();
  }

  function requireKey(apiKey, where) {
    if (!apiKey || !apiKey.trim()) {
      throw new Error(`未填写 API Key（${where}）。请在上方“密钥”区填写并保存。`);
    }
  }

  /** 下载图片 URL 并转成 base64（用于 DashScope 等返回 OSS 链接的服务） */
  async function downloadAsBase64(url, signal) {
    const to = withTimeout(signal, 60000);
    try {
      const res = await fetch(url, { method: "GET", signal: to.signal });
      if (!res.ok) throw new Error(`下载结果图失败 (${res.status})`);
      const buf = await res.arrayBuffer();
      return U.uint8ArrayToBase64(new Uint8Array(buf));
    } catch (e) {
      if (e && e.name === "AbortError") {
        throw new Error(signal && signal.aborted ? "已取消。" : "下载结果图超时。");
      }
      throw new Error(networkHint(e));
    } finally {
      to.clear();
    }
  }

  // ---------- 适配器：Google Nano Banana (Gemini Image) ----------

  async function geminiGenerate({ imageBase64, prompt, apiKey, options, signal }) {
    requireKey(apiKey, "Google AI Studio");
    const model = (options.model || "gemini-2.5-flash-image").trim();
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) +
      ":generateContent?key=" +
      encodeURIComponent(apiKey.trim());

    const parts = [];
    if (prompt) parts.push({ text: prompt });
    if (imageBase64) {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: U.stripDataUrl(imageBase64) } });
    }
    if (parts.length === 0) throw new Error("提示词与图片不能同时为空。");

    const body = {
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    };

    const { res, data } = await apiFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      signal
    );
    if (!res.ok) throw new Error(extractErr(data) || `Gemini 请求失败 (${res.status})`);

    const candidates = U.get(data, "candidates", []) || [];
    for (const c of candidates) {
      const ps = U.get(c, "content.parts", []) || [];
      for (const p of ps) {
        const inline = p.inlineData || p.inline_data;
        if (inline && inline.data) {
          return {
            base64: inline.data,
            mimeType: inline.mimeType || inline.mime_type || "image/png",
          };
        }
      }
    }
    const txt = collectText(candidates);
    const blocked = U.get(data, "promptFeedback.blockReason") || U.get(candidates, "0.finishReason");
    throw new Error(
      txt
        ? `模型未返回图片，仅返回文本：${U.truncate(txt, 200)}`
        : `模型未返回图片${blocked ? "（原因：" + blocked + "）" : "（可能被安全策略拦截，或提示词缺少明确的编辑指令）"}。`
    );
  }

  // ---------- 适配器：OpenAI gpt-image-1（图像编辑/图生图） ----------

  async function openaiGenerate({ imageBase64, prompt, apiKey, options, signal }) {
    requireKey(apiKey, "OpenAI");
    if (!imageBase64) throw new Error("OpenAI 图像编辑需要先框选一块区域作为输入图。");
    const model = (options.model || "gpt-image-1").trim();
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt || "");
    form.append("image", U.base64ToBlob(imageBase64, "image/jpeg"), "input.jpg");
    form.append("n", "1");
    if (options.size && options.size !== "auto") form.append("size", options.size);
    if (options.quality && options.quality !== "auto") form.append("quality", options.quality);

    const { res, data } = await apiFetch(
      "https://api.openai.com/v1/images/edits",
      { method: "POST", headers: { Authorization: "Bearer " + apiKey.trim() }, body: form },
      signal
    );
    if (!res.ok) throw new Error(extractErr(data) || `OpenAI 请求失败 (${res.status})`);
    const b64 = U.get(data, "data.0.b64_json");
    if (!b64) throw new Error("OpenAI 未返回图片数据。");
    return { base64: b64, mimeType: "image/png" };
  }

  // ---------- 适配器：Stability AI（image-to-image） ----------

  async function stabilityGenerate({ imageBase64, prompt, apiKey, options, signal }) {
    requireKey(apiKey, "Stability AI");
    if (!imageBase64) throw new Error("Stability 图生图需要先框选一块区域作为输入图。");
    const endpoint =
      options.endpoint || "https://api.stability.ai/v2beta/stable-image/generate/core";
    const form = new FormData();
    form.append("prompt", prompt || "");
    form.append("image", U.base64ToBlob(imageBase64, "image/jpeg"), "input.jpg");
    form.append("mode", "image-to-image");
    form.append("strength", String(options.strength != null ? options.strength : 0.6));
    form.append("output_format", "png");
    if (options.negativePrompt) form.append("negative_prompt", options.negativePrompt);

    const { res, data } = await apiFetch(
      endpoint,
      {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey.trim(), Accept: "application/json" },
        body: form,
      },
      signal
    );
    if (!res.ok) throw new Error(extractErr(data) || `Stability 请求失败 (${res.status})`);
    const b64 = data.image || U.get(data, "artifacts.0.base64");
    if (!b64) throw new Error("Stability 未返回图片数据。");
    return { base64: b64, mimeType: "image/png" };
  }

  // ---------- 适配器：自定义（OpenAI 兼容 /images/edits） ----------

  async function customGenerate({ imageBase64, prompt, apiKey, options, signal }) {
    const endpoint = (options.endpoint || "").trim();
    if (!endpoint) throw new Error("请填写自定义端点 URL。");
    if (!imageBase64) throw new Error("自定义图生图需要先框选一块区域作为输入图。");
    const form = new FormData();
    if (options.model) form.append("model", options.model);
    form.append("prompt", prompt || "");
    form.append("image", U.base64ToBlob(imageBase64, "image/jpeg"), "input.jpg");
    form.append("n", "1");

    const headers = {};
    if (apiKey && apiKey.trim()) headers.Authorization = "Bearer " + apiKey.trim();

    const { res, data } = await apiFetch(
      endpoint,
      { method: "POST", headers, body: form },
      signal
    );
    if (!res.ok) throw new Error(extractErr(data) || `自定义端点请求失败 (${res.status})`);
    const b64 = U.get(data, "data.0.b64_json") || data.image || U.get(data, "artifacts.0.base64");
    if (!b64) throw new Error("自定义端点未返回可识别的 base64 图片字段。");
    return { base64: b64, mimeType: "image/png" };
  }

  // ---------- 适配器：通义千问 Qwen / 万相（DashScope，异步任务制） ----------

  async function qwenGenerate({ imageBase64, prompt, apiKey, options, signal }) {
    requireKey(apiKey, "阿里云百炼 DashScope");
    if (!imageBase64) throw new Error("Qwen 图像编辑需要先框选一块区域作为输入图。");
    const model = (options.model || "wanx2.1-imageedit").trim();
    const func = options.function || "description_edit";
    const auth = "Bearer " + apiKey.trim();
    const dataUrl = "data:image/jpeg;base64," + U.stripDataUrl(imageBase64);

    // 1) 提交异步任务
    const submit = await apiFetch(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis",
      {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify({
          model: model,
          input: { function: func, prompt: prompt || "", base_image_url: dataUrl },
          parameters: { n: 1 },
        }),
      },
      signal,
      60000
    );
    if (!submit.res.ok) {
      throw new Error(extractErr(submit.data) || `DashScope 提交失败 (${submit.res.status})`);
    }
    const taskId = U.get(submit.data, "output.task_id");
    if (!taskId) throw new Error(extractErr(submit.data) || "DashScope 未返回 task_id。");

    // 2) 轮询任务（最多约 3 分钟）
    const deadline = Date.now() + 180000;
    let resultUrl = null;
    let resultB64 = null;
    while (Date.now() < deadline) {
      if (signal && signal.aborted) throw new Error("已取消。");
      await U.sleep(2000);
      const poll = await apiFetch(
        "https://dashscope.aliyuncs.com/api/v1/tasks/" + encodeURIComponent(taskId),
        { method: "GET", headers: { Authorization: auth } },
        signal,
        30000
      );
      if (!poll.res.ok) {
        throw new Error(extractErr(poll.data) || `查询任务失败 (${poll.res.status})`);
      }
      const status = U.get(poll.data, "output.task_status");
      if (status === "SUCCEEDED") {
        const r0 = U.get(poll.data, "output.results.0", {}) || {};
        resultUrl = r0.url || null;
        resultB64 = r0.b64_image || r0.image || null;
        break;
      }
      if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
        throw new Error(
          U.get(poll.data, "output.message") || extractErr(poll.data) || "任务状态：" + status
        );
      }
      // PENDING / RUNNING：继续等待
    }
    if (!resultUrl && !resultB64) throw new Error("等待超时或未取得结果图，请重试。");

    // 3) 取回图片
    if (resultB64) return { base64: U.stripDataUrl(resultB64), mimeType: "image/png" };
    const b64 = await downloadAsBase64(resultUrl, signal);
    return { base64: b64, mimeType: "image/png" };
  }

  // ---------- 模型注册表 ----------

  const MODELS = [
    {
      id: "gemini",
      label: "Google Nano Banana (Gemini Image)",
      docs: "https://aistudio.google.com/apikey",
      keyHint: "在 Google AI Studio 免费获取 API Key（aistudio.google.com/apikey）。",
      generate: geminiGenerate,
      fields: [
        {
          key: "model",
          type: "text",
          label: "模型名",
          default: "gemini-2.5-flash-image",
          hint: "Nano Banana=gemini-2.5-flash-image；Pro 版可填 gemini-3-pro-image-preview。",
        },
      ],
    },
    {
      id: "qwen",
      label: "通义千问 Qwen / 万相 (DashScope)",
      docs: "https://bailian.console.aliyun.com",
      keyHint: "在阿里云百炼控制台获取 DashScope API Key（sk- 开头）。",
      generate: qwenGenerate,
      fields: [
        {
          key: "model",
          type: "select",
          label: "模型",
          default: "wanx2.1-imageedit",
          options: [
            { value: "wanx2.1-imageedit", label: "万相 2.1 图像编辑(推荐)" },
            { value: "wanx2.0-imageedit", label: "万相 2.0 图像编辑" },
          ],
          hint: "这些万相编辑模型走同一套异步接口。其他模型(如 qwen-image-edit)接口不同，可单独加。",
        },
        {
          key: "function",
          type: "select",
          label: "编辑功能",
          default: "description_edit",
          options: [
            { value: "description_edit", label: "指令编辑（按提示词改）" },
            { value: "stylization_all", label: "整体风格化" },
            { value: "stylization_local", label: "局部风格化" },
            { value: "remove_watermark", label: "去文字/水印" },
            { value: "expand", label: "扩图（外绘）" },
            { value: "super_resolution", label: "超分辨率" },
            { value: "doodle", label: "线稿生图" },
          ],
        },
      ],
    },
    {
      id: "openai",
      label: "OpenAI GPT-Image (DALL·E)",
      docs: "https://platform.openai.com/api-keys",
      keyHint: "在 platform.openai.com 创建 API Key（需绑定付费）。",
      generate: openaiGenerate,
      fields: [
        { key: "model", type: "text", label: "模型名", default: "gpt-image-1" },
        {
          key: "size",
          type: "select",
          label: "输出尺寸",
          default: "auto",
          options: [
            { value: "auto", label: "自动" },
            { value: "1024x1024", label: "1024×1024 方" },
            { value: "1536x1024", label: "1536×1024 横" },
            { value: "1024x1536", label: "1024×1536 竖" },
          ],
        },
        {
          key: "quality",
          type: "select",
          label: "质量",
          default: "auto",
          options: [
            { value: "auto", label: "自动" },
            { value: "low", label: "低（省钱）" },
            { value: "medium", label: "中" },
            { value: "high", label: "高" },
          ],
        },
      ],
    },
    {
      id: "stability",
      label: "Stability AI (Stable Image)",
      docs: "https://platform.stability.ai/account/keys",
      keyHint: "在 platform.stability.ai 获取 API Key。",
      generate: stabilityGenerate,
      fields: [
        {
          key: "endpoint",
          type: "select",
          label: "引擎",
          default: "https://api.stability.ai/v2beta/stable-image/generate/core",
          options: [
            { value: "https://api.stability.ai/v2beta/stable-image/generate/core", label: "Core（性价比）" },
            { value: "https://api.stability.ai/v2beta/stable-image/generate/sd3", label: "SD3" },
            { value: "https://api.stability.ai/v2beta/stable-image/generate/ultra", label: "Ultra（最佳）" },
          ],
        },
        {
          key: "strength",
          type: "range",
          label: "图生图强度",
          default: 0.6,
          min: 0,
          max: 1,
          step: 0.05,
          hint: "越高越偏离原图（0=几乎不变，1=完全重画）。",
        },
        { key: "negativePrompt", type: "text", label: "负向提示词（可选）", default: "" },
      ],
    },
    {
      id: "custom",
      label: "自定义端点 (OpenAI 兼容)",
      docs: "",
      keyHint: "任意 OpenAI 兼容的 /v1/images/edits 服务；域名需先加入 manifest.json 白名单。",
      generate: customGenerate,
      fields: [
        {
          key: "endpoint",
          type: "text",
          label: "完整端点 URL",
          default: "",
          hint: "例如 https://your-host/v1/images/edits（域名须加入 manifest）。",
        },
        { key: "model", type: "text", label: "模型名（可选）", default: "" },
      ],
    },
  ];

  function getById(id) {
    return MODELS.find((m) => m.id === id) || MODELS[0];
  }

  /** 取某模型的默认参数对象 */
  function defaultsOf(id) {
    const m = getById(id);
    const out = {};
    (m.fields || []).forEach((f) => {
      out[f.key] = f.default;
    });
    return out;
  }

  /** 统一调用入口 */
  async function generate(modelId, payload) {
    const m = getById(modelId);
    return m.generate(payload);
  }

  PSAI.models = { list: MODELS, getById, defaultsOf, generate };
})(typeof window !== "undefined" ? window : this);
