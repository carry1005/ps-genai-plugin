/*
 * main.js — 面板主控制器
 * 负责：初始化 UI、动态参数渲染、密钥管理、串联“导出选区 → 调模型 → 写回图层”。
 */
(function (root) {
  "use strict";
  const PSAI = (root.PSAI = root.PSAI || {});
  const U = PSAI.utils;

  const els = {};
  const paramEls = {}; // 当前模型参数控件 { key: element }
  let currentModelId = null;
  let running = false;
  let abortCtrl = null;

  function $(id) {
    return document.getElementById(id);
  }

  function cacheEls() {
    [
      "modelPicker",
      "modelHint",
      "apiKey",
      "showKey",
      "keyBadge",
      "saveKey",
      "clearKey",
      "paramContainer",
      "prompt",
      "advHead",
      "advChevron",
      "advBody",
      "maxEdge",
      "fallbackFull",
      "layerPrefix",
      "progress",
      "status",
      "generate",
      "cancel",
      "selInfo",
    ].forEach((id) => (els[id] = $(id)));
  }

  // ---------- 状态/进度 ----------

  function setStatus(text, kind) {
    els.status.textContent = text;
    els.status.className = "status" + (kind ? " " + kind : "");
  }

  function setRunning(on) {
    running = on;
    els.generate.disabled = on;
    els.progress.classList.toggle("active", on);
    els.cancel.classList.toggle("hidden", !on);
  }

  function updateKeyBadge(saved) {
    els.keyBadge.textContent = saved ? "已保存 ✓" : "未保存";
    els.keyBadge.className = "badge " + (saved ? "ok" : "warn");
  }

  // ---------- 模型下拉 ----------

  function buildModelPicker() {
    const menu = document.createElement("sp-menu");
    menu.setAttribute("slot", "options");
    PSAI.models.list.forEach((m) => {
      const item = document.createElement("sp-menu-item");
      item.textContent = m.label;
      item.setAttribute("value", m.id);
      menu.appendChild(item);
    });
    els.modelPicker.appendChild(menu);
  }

  // ---------- 动态参数渲染 ----------

  function renderParams(model, savedParams) {
    els.paramContainer.innerHTML = "";
    for (const k in paramEls) delete paramEls[k];

    (model.fields || []).forEach((f) => {
      const val = savedParams && savedParams[f.key] != null ? savedParams[f.key] : f.default;

      const wrap = document.createElement("div");
      wrap.className = "field";

      const label = document.createElement("span");
      label.className = "label";
      label.textContent =
        f.label + (f.type === "range" ? "：" + (val != null ? val : "") : "");
      wrap.appendChild(label);

      let control;
      if (f.type === "select") {
        control = document.createElement("sp-picker");
        control.setAttribute("size", "s");
        control.className = "full";
        const menu = document.createElement("sp-menu");
        menu.setAttribute("slot", "options");
        (f.options || []).forEach((o) => {
          const item = document.createElement("sp-menu-item");
          item.textContent = o.label;
          item.setAttribute("value", o.value);
          if (o.value === val) item.setAttribute("selected", "");
          menu.appendChild(item);
        });
        control.appendChild(menu);
        control.value = val;
        control.addEventListener("change", () => onParamChange());
      } else if (f.type === "range") {
        control = document.createElement("sp-slider");
        control.setAttribute("min", f.min);
        control.setAttribute("max", f.max);
        control.setAttribute("step", f.step);
        control.className = "full";
        control.value = val;
        const onInput = () => {
          label.textContent = f.label + "：" + control.value;
          onParamChange();
        };
        control.addEventListener("input", onInput);
        control.addEventListener("change", onInput);
      } else {
        control = document.createElement("sp-textfield");
        if (f.type === "number") control.setAttribute("type", "number");
        control.className = "full";
        control.value = val == null ? "" : val;
        if (f.hint) control.setAttribute("placeholder", f.hint);
        control.addEventListener("input", () => onParamChange());
      }

      paramEls[f.key] = control;
      wrap.appendChild(control);

      if (f.hint && f.type !== "text") {
        const hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent = f.hint;
        wrap.appendChild(hint);
      }
      els.paramContainer.appendChild(wrap);
    });
  }

  function collectOptions(model) {
    const opts = {};
    (model.fields || []).forEach((f) => {
      const el = paramEls[f.key];
      let v = el ? el.value : f.default;
      if (f.type === "number" || f.type === "range") v = Number(v);
      opts[f.key] = v;
    });
    return opts;
  }

  function onParamChange() {
    const model = PSAI.models.getById(currentModelId);
    const opts = collectOptions(model);
    const settings = PSAI.storage.loadSettings();
    const params = settings.params || {};
    params[currentModelId] = opts;
    PSAI.storage.saveSettings({ params });
  }

  // ---------- 选择模型 ----------

  async function selectModel(id) {
    currentModelId = id;
    const model = PSAI.models.getById(id);
    const settings = PSAI.storage.loadSettings();
    const savedParams = (settings.params || {})[id];
    renderParams(model, savedParams);
    els.modelHint.textContent = model.keyHint || "";

    const key = await PSAI.storage.getApiKey(id);
    els.apiKey.value = key || "";
    updateKeyBadge(!!key);

    PSAI.storage.saveSettings({ lastModel: id });
  }

  // ---------- 选区状态 ----------

  function updateSelInfo() {
    if (running) return;
    const info = PSAI.selection.getSelectionInfo();
    if (!info.hasDoc) {
      els.selInfo.textContent = "（未打开文档）";
      return;
    }
    if (info.hasSelection) {
      els.selInfo.textContent = "当前选区：" + info.width + " × " + info.height + " px";
    } else {
      els.selInfo.textContent =
        "无选区：将使用整张画布（" + (info.docW || "?") + " × " + (info.docH || "?") + "）";
    }
  }

  // ---------- 主流程 ----------

  async function onGenerate() {
    if (running) return;
    const modelId = currentModelId;
    const model = PSAI.models.getById(modelId);
    const prompt = (els.prompt.value || "").trim();
    const options = collectOptions(model);
    const maxEdge = parseInt(els.maxEdge.value, 10) || 0;
    const fallbackToFullDoc = !!els.fallbackFull.checked;

    if (!prompt) {
      setStatus("请输入提示词。", "error");
      els.prompt.focus();
      return;
    }
    const apiKey = await PSAI.storage.getApiKey(modelId);
    if (modelId !== "custom" && !apiKey) {
      setStatus("请先填写并保存 API Key。", "error");
      els.apiKey.focus();
      return;
    }

    setRunning(true);
    abortCtrl = new AbortController();
    try {
      setStatus("正在读取选区像素…");
      const sel = await PSAI.selection.exportSelection({ fallbackToFullDoc, maxEdge });

      const w = sel.bounds.right - sel.bounds.left;
      const h = sel.bounds.bottom - sel.bounds.top;
      setStatus(
        (sel.isSelection ? "已导出选区 " : "已导出整图 ") + w + "×" + h + "，正在请求模型…"
      );

      const result = await PSAI.models.generate(modelId, {
        imageBase64: sel.base64,
        prompt: prompt,
        apiKey: apiKey,
        options: options,
        signal: abortCtrl.signal,
      });

      setStatus("模型已返回，正在写回图层…");
      const prefix = (els.layerPrefix.value || "AI").trim();
      const name = prefix + " · " + U.truncate(prompt, 16) + " · " + U.timeTag();
      const placed = await PSAI.layers.placeImageAsLayer(result.base64, sel.bounds, name);

      setStatus("✅ 完成：已新建图层「" + placed.layerName + "」", "ok");
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (/已取消/.test(msg)) setStatus("已取消。");
      else setStatus("❌ " + msg, "error");
      console.error("[AI 生成填充] 失败：", e);
    } finally {
      setRunning(false);
      abortCtrl = null;
    }
  }

  function onCancel() {
    if (abortCtrl) {
      try {
        abortCtrl.abort();
      } catch (e) {
        /* ignore */
      }
      setStatus("正在取消…");
    }
  }

  // ---------- 事件绑定 ----------

  function bindEvents() {
    els.modelPicker.addEventListener("change", () => {
      selectModel(els.modelPicker.value);
    });

    els.showKey.addEventListener("change", () => {
      els.apiKey.setAttribute("type", els.showKey.checked ? "text" : "password");
    });

    els.saveKey.addEventListener("click", async () => {
      const v = (els.apiKey.value || "").trim();
      try {
        await PSAI.storage.saveApiKey(currentModelId, v);
        updateKeyBadge(!!v);
        setStatus(v ? "密钥已加密保存。" : "已清空该模型密钥。", "ok");
      } catch (e) {
        setStatus("密钥保存失败：" + ((e && e.message) || e), "error");
      }
    });

    els.clearKey.addEventListener("click", async () => {
      els.apiKey.value = "";
      try {
        await PSAI.storage.saveApiKey(currentModelId, "");
        updateKeyBadge(false);
        setStatus("已清空该模型密钥。", "ok");
      } catch (e) {
        setStatus("清除失败：" + ((e && e.message) || e), "error");
      }
    });

    els.advHead.addEventListener("click", () => {
      const open = els.advBody.classList.toggle("open");
      els.advChevron.classList.toggle("open", open);
    });

    [els.maxEdge, els.layerPrefix].forEach((el) =>
      el.addEventListener("input", () => {
        PSAI.storage.saveSettings({
          maxEdge: parseInt(els.maxEdge.value, 10) || 0,
          layerPrefix: els.layerPrefix.value,
        });
      })
    );
    els.fallbackFull.addEventListener("change", () => {
      PSAI.storage.saveSettings({ fallbackFull: !!els.fallbackFull.checked });
    });

    els.generate.addEventListener("click", onGenerate);
    els.cancel.addEventListener("click", onCancel);
  }

  // ---------- 初始化 ----------

  async function init() {
    cacheEls();
    buildModelPicker();

    const settings = PSAI.storage.loadSettings();
    if (settings.maxEdge != null) els.maxEdge.value = settings.maxEdge;
    if (settings.layerPrefix) els.layerPrefix.value = settings.layerPrefix;
    if (settings.fallbackFull != null) els.fallbackFull.checked = !!settings.fallbackFull;

    const first =
      settings.lastModel && PSAI.models.getById(settings.lastModel)
        ? settings.lastModel
        : PSAI.models.list[0].id;

    // 等待 spectrum 组件就绪后再设置选中值
    els.modelPicker.value = first;
    await selectModel(first);

    bindEvents();
    updateSelInfo();
    setInterval(updateSelInfo, 1000);
    setStatus("就绪");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : this);
