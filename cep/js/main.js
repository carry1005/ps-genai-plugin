/*
 * main.js (CEP 版) — 面板主控制器
 * 复用 PSAI.utils / PSAI.storage / PSAI.models；PS 操作通过 CSInterface 调 host.jsx；
 * 临时图片读写用 Node 的 fs/os/path（manifest 已启用 --enable-nodejs）。
 */
(function () {
  "use strict";
  var PSAI = window.PSAI || {};
  var U = PSAI.utils;
  var cs = new CSInterface();

  var fs = null, os = null, path = null;
  try {
    fs = require("fs");
    os = require("os");
    path = require("path");
  } catch (e) {
    /* 若 Node 不可用会在生成时报错 */
  }

  var els = {};
  var paramEls = {};
  var currentModelId = null;
  var running = false;
  var abortCtrl = null;
  var referenceImages = [];
  var pendingConfirm = false;
  var confirmTimer = null;
  var promptDialogOpen = false;

  function $(id) { return document.getElementById(id); }

  /** 调 ExtendScript 函数，返回 Promise<string> */
  function jsx(script) {
    return new Promise(function (resolve) {
      cs.evalScript(script, function (r) { resolve(r == null ? "" : String(r)); });
    });
  }
  /** 安全构造 jsx 调用（数字原样，字符串用 JSON 转义） */
  function jsxCall(fn, args) {
    var a = (args || []).map(function (x) {
      return typeof x === "number" ? String(x) : JSON.stringify(String(x));
    }).join(",");
    return jsx(fn + "(" + a + ")");
  }

  function cacheEls() {
    ["modelPicker", "modelHint", "apiKey", "showKey", "keyBadge", "saveKey", "clearKey",
      "paramContainer", "prompt", "addRef", "refInfo", "clearRef",
      "settingsBtn", "settingsArea", "settingsOverlay", "settingsClose", "maxEdge",
      "fallbackFull", "layerPrefix", "progress", "status", "generate", "cancel", "selInfo"
    ].forEach(function (id) { els[id] = $(id); });
  }

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

  function toggleSettings(open) {
    if (!els.settingsOverlay) return;
    var show = open == null ? els.settingsOverlay.classList.contains("hidden") : open;
    els.settingsOverlay.classList.toggle("hidden", !show);
  }

  function updateRefInfo() {
    if (referenceImages.length === 0) {
      els.refInfo.textContent = "无参考图";
      els.clearRef.classList.add("hidden");
    } else {
      els.refInfo.textContent = referenceImages.length + " 张参考图";
      els.clearRef.classList.remove("hidden");
    }
  }

  function buildModelPicker() {
    PSAI.models.list.forEach(function (m) {
      var op = document.createElement("option");
      op.value = m.id; op.textContent = m.label;
      els.modelPicker.appendChild(op);
    });
  }

  function renderParams(model, savedParams) {
    els.paramContainer.innerHTML = "";
    paramEls = {};
    (model.fields || []).forEach(function (f) {
      var val = savedParams && savedParams[f.key] != null ? savedParams[f.key] : f.default;
      var wrap = document.createElement("div"); wrap.className = "field";
      var label = document.createElement("label"); label.className = "lbl";
      label.textContent = f.label + (f.type === "range" ? "：" + val : "");
      wrap.appendChild(label);

      var ctrl;
      var mount = null;
      if (f.type === "select") {
        ctrl = document.createElement("select"); ctrl.className = "full";
        (f.options || []).forEach(function (o) {
          var op = document.createElement("option");
          op.value = o.value; op.textContent = o.label;
          if (o.value === val) op.selected = true;
          ctrl.appendChild(op);
        });
        ctrl.addEventListener("change", onParamChange);
      } else if (f.type === "combo") {
        // 自绘可编辑下拉：输入框 + 预设列表（CEF 面板里 datalist 点击不弹，故自绘）
        var comboWrap = document.createElement("div"); comboWrap.className = "combo";
        ctrl = document.createElement("input"); ctrl.type = "text"; ctrl.className = "full";
        ctrl.value = val == null ? "" : val;
        ctrl.setAttribute("autocomplete", "off");
        var arrow = document.createElement("span"); arrow.className = "combo-arrow"; arrow.textContent = "▾";
        var listEl = document.createElement("div"); listEl.className = "combo-list hidden";
        var toggleList = function (show) {
          if (show == null) show = listEl.classList.contains("hidden");
          if (show) listEl.classList.remove("hidden"); else listEl.classList.add("hidden");
        };
        (f.options || []).forEach(function (o) {
          var item = document.createElement("div"); item.className = "combo-item";
          item.textContent = o.label || o.value;
          item.addEventListener("mousedown", function (e) {
            e.preventDefault();
            ctrl.value = o.value;
            toggleList(false);
            onParamChange();
          });
          listEl.appendChild(item);
        });
        arrow.addEventListener("mousedown", function (e) { e.preventDefault(); toggleList(); ctrl.focus(); });
        ctrl.addEventListener("focus", function () { toggleList(true); });
        ctrl.addEventListener("blur", function () { setTimeout(function () { toggleList(false); }, 150); });
        ctrl.addEventListener("input", onParamChange);
        comboWrap.appendChild(ctrl);
        comboWrap.appendChild(arrow);
        comboWrap.appendChild(listEl);
        mount = comboWrap;
      } else if (f.type === "range") {
        ctrl = document.createElement("input"); ctrl.type = "range";
        ctrl.min = f.min; ctrl.max = f.max; ctrl.step = f.step; ctrl.value = val; ctrl.className = "full";
        ctrl.addEventListener("input", function () {
          label.textContent = f.label + "：" + ctrl.value; onParamChange();
        });
      } else {
        ctrl = document.createElement("input");
        ctrl.type = f.type === "number" ? "number" : "text";
        ctrl.value = val == null ? "" : val; ctrl.className = "full";
        if (f.hint) ctrl.placeholder = f.hint;
        ctrl.addEventListener("input", onParamChange);
      }
      paramEls[f.key] = ctrl;
      wrap.appendChild(mount || ctrl);
      if (f.hint && f.type !== "text") {
        var h = document.createElement("p"); h.className = "hint"; h.textContent = f.hint;
        wrap.appendChild(h);
      }
      els.paramContainer.appendChild(wrap);
    });
  }

  function collectOptions(model) {
    var opts = {};
    (model.fields || []).forEach(function (f) {
      var el = paramEls[f.key];
      var v = el ? el.value : f.default;
      if (f.type === "number" || f.type === "range") v = Number(v);
      opts[f.key] = v;
    });
    return opts;
  }
  function onParamChange() {
    var opts = collectOptions(PSAI.models.getById(currentModelId));
    var s = PSAI.storage.loadSettings();
    var params = s.params || {};
    params[currentModelId] = opts;
    PSAI.storage.saveSettings({ params: params });
  }

  function selectModel(id) {
    currentModelId = id;
    var model = PSAI.models.getById(id);
    var s = PSAI.storage.loadSettings();
    renderParams(model, (s.params || {})[id]);
    els.modelHint.textContent = model.keyHint || "";
    PSAI.storage.getApiKey(id).then(function (key) {
      els.apiKey.value = key || "";
      updateKeyBadge(!!key);
    });
    PSAI.storage.saveSettings({ lastModel: id });
  }

  function updateSelInfo() {
    if (running) return;
    jsx("psaiSelectionInfo()").then(function (r) {
      if (!r || r === "nodoc") { els.selInfo.textContent = "（未打开文档）"; return; }
      var p = r.split("|");
      if (p[0] === "sel") els.selInfo.textContent = "当前选区：" + p[1] + " × " + p[2] + " px";
      else els.selInfo.textContent = "无选区：将用整张画布（" + p[3] + " × " + p[4] + "）";
    });
  }

  function openPromptDialog() {
    if (promptDialogOpen) return;
    promptDialogOpen = true;
    jsxCall("psaiPromptDialog", [els.prompt.value || ""]).then(function (r) {
      promptDialogOpen = false;
      if (r && r !== "__CANCEL__") { els.prompt.value = r; resetConfirm(); }
    }, function () { promptDialogOpen = false; });
  }

  function resetConfirm() {
    pendingConfirm = false;
    if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
    if (els.generate) {
      els.generate.textContent = "生成";
      els.generate.classList.remove("confirm");
    }
  }

  async function onGenerate() {
    if (running) return;
    if (!fs) { setStatus("Node 文件系统不可用（manifest 需 --enable-nodejs）。", "error"); return; }
    var modelId = currentModelId;
    var model = PSAI.models.getById(modelId);
    var prompt = (els.prompt.value || "").trim();
    var options = collectOptions(model);
    var maxEdge = parseInt(els.maxEdge.value, 10) || 0;

    if (!prompt) { setStatus("请输入提示词。", "error"); els.prompt.focus(); return; }
    var apiKey = await PSAI.storage.getApiKey(modelId);
    if (modelId !== "custom" && !apiKey) {
      setStatus("请先填写并保存 API Key。", "error"); els.apiKey.focus(); return;
    }

    // 面板内二次确认：首次点击进入确认态，再点一次才真正生成（避免误触）
    if (!pendingConfirm) {
      pendingConfirm = true;
      els.generate.textContent = "⚠️ 确认生成（再点一次）";
      els.generate.classList.add("confirm");
      setStatus("再次点击「确认生成」开始，会消耗一次模型调用额度。5 秒内未点将取消。");
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmTimer = setTimeout(resetConfirm, 5000);
      return;
    }
    resetConfirm();

    setRunning(true);
    abortCtrl = new AbortController();
    try {
      setStatus("正在导出选区…");
      var exp = await jsxCall("psaiExportSelection", [maxEdge]);
      if (exp.indexOf("OK|") !== 0) throw new Error(exp.replace(/^ERR\|/, "") || "导出选区失败");
      var parts = exp.split("|");
      var inPath = parts[1];
      var bounds = parts[2].split(",").map(Number); // [l,t,r,b]
      var inputB64 = fs.readFileSync(inPath).toString("base64");

      var w = bounds[2] - bounds[0], h = bounds[3] - bounds[1];
      setStatus("已导出 " + w + "×" + h + "，正在请求模型…");
      var result = await PSAI.models.generate(modelId, {
        imageBase64: inputB64, prompt: prompt, apiKey: apiKey, options: options,
        signal: abortCtrl.signal, extraImages: referenceImages.slice(),
        inputW: w, inputH: h,
      });

      setStatus("模型已返回，正在写回图层…");
      var outPath = path.join(os.tmpdir(), "psai_out_" + Date.now() + ".png");
      fs.writeFileSync(outPath, Buffer.from(U.stripDataUrl(result.base64), "base64"));
      var name = (els.layerPrefix.value || "AI") + " " + U.truncate(prompt, 16) + " " + U.timeTag();
      var pl = await jsxCall("psaiPlaceImage", [outPath, bounds[0], bounds[1], bounds[2], bounds[3], name]);
      if (pl.indexOf("OK|") !== 0) throw new Error(pl.replace(/^ERR\|/, "") || "写回图层失败");

      setStatus("✅ 完成：已新建图层「" + pl.split("|")[1] + "」", "ok");
      try { fs.unlinkSync(inPath); } catch (e) {}
    } catch (e) {
      var msg = (e && e.message) || String(e);
      if (/已取消/.test(msg)) setStatus("已取消。");
      else setStatus("❌ " + msg, "error");
    } finally {
      setRunning(false);
      abortCtrl = null;
    }
  }

  function onCancel() {
    if (abortCtrl) { try { abortCtrl.abort(); } catch (e) {} setStatus("正在取消…"); }
  }

  function saveAdv() {
    PSAI.storage.saveSettings({
      maxEdge: parseInt(els.maxEdge.value, 10) || 0,
      layerPrefix: els.layerPrefix.value,
    });
  }

  function bindEvents() {
    els.modelPicker.addEventListener("change", function () { resetConfirm(); selectModel(els.modelPicker.value); });
    if (els.prompt) els.prompt.addEventListener("input", resetConfirm);
    els.showKey.addEventListener("change", function () {
      els.apiKey.type = els.showKey.checked ? "text" : "password";
    });
    els.saveKey.addEventListener("click", function () {
      var v = (els.apiKey.value || "").trim();
      PSAI.storage.saveApiKey(currentModelId, v).then(function () {
        updateKeyBadge(!!v);
        setStatus(v ? "密钥已保存。" : "已清空该模型密钥。", "ok");
      }).catch(function (e) { setStatus("密钥保存失败：" + ((e && e.message) || e), "error"); });
    });
    els.clearKey.addEventListener("click", function () {
      els.apiKey.value = "";
      PSAI.storage.saveApiKey(currentModelId, "").then(function () {
        updateKeyBadge(false); setStatus("已清空该模型密钥。", "ok");
      });
    });
    els.maxEdge.addEventListener("input", saveAdv);
    els.layerPrefix.addEventListener("input", saveAdv);
    els.fallbackFull.addEventListener("change", function () {
      PSAI.storage.saveSettings({ fallbackFull: !!els.fallbackFull.checked });
    });
    if (els.prompt) els.prompt.addEventListener("click", openPromptDialog);
    if (els.settingsBtn) els.settingsBtn.addEventListener("click", function () { toggleSettings(true); });
    if (els.settingsClose) els.settingsClose.addEventListener("click", function () { toggleSettings(false); });
    if (els.settingsOverlay) els.settingsOverlay.addEventListener("click", function (e) {
      if (e.target === els.settingsOverlay) toggleSettings(false);
    });
    if (els.addRef) els.addRef.addEventListener("click", function () {
      if (!fs) { setStatus("Node 不可用，无法读取参考图。", "error"); return; }
      jsxCall("psaiPickImage", []).then(function (r) {
        if (!r || r === "__CANCEL__") return;
        if (r.indexOf("OK|") !== 0) { setStatus("选图失败：" + r, "error"); return; }
        try {
          var b64 = fs.readFileSync(r.slice(3)).toString("base64");
          referenceImages.push(b64);
          updateRefInfo();
          setStatus("已添加参考图（共 " + referenceImages.length + " 张）", "ok");
        } catch (e) { setStatus("读取参考图失败：" + ((e && e.message) || e), "error"); }
      });
    });
    if (els.clearRef) els.clearRef.addEventListener("click", function () {
      referenceImages = [];
      updateRefInfo();
      setStatus("已清空参考图。", "ok");
    });
    els.generate.addEventListener("click", onGenerate);
    els.cancel.addEventListener("click", onCancel);
  }

  function init() {
    cacheEls();
    try { bindEvents(); } catch (e) { console.error(e); if (els.status) setStatus("事件绑定失败：" + e, "error"); }
    try {
      buildModelPicker();
      var s = PSAI.storage.loadSettings();
      if (s.maxEdge != null) els.maxEdge.value = s.maxEdge;
      if (s.layerPrefix) els.layerPrefix.value = s.layerPrefix;
      if (s.fallbackFull != null) els.fallbackFull.checked = !!s.fallbackFull;
      updateRefInfo();
      var first = (s.lastModel && PSAI.models.getById(s.lastModel)) ? s.lastModel : PSAI.models.list[0].id;
      els.modelPicker.value = first;
      selectModel(first);
      setStatus("就绪");
    } catch (e) {
      console.error(e);
      if (els.status) setStatus("初始化失败：" + ((e && e.message) || e), "error");
    }
    updateSelInfo();
    setInterval(updateSelInfo, 1200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
