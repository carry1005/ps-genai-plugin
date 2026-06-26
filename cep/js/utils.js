/*
 * utils.js — 通用工具函数
 * 全部挂载到全局命名空间 window.PSAI.utils，避免依赖模块系统（UXP 各版本对 ESM 支持不一致）。
 */
(function (root) {
  "use strict";
  const PSAI = (root.PSAI = root.PSAI || {});

  /** 把 base64 字符串解码为 Uint8Array */
  function base64ToUint8Array(base64) {
    const clean = stripDataUrl(base64);
    const binary = atob(clean);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /** 把 Uint8Array 编码为 base64 字符串（分块避免栈溢出） */
  function uint8ArrayToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000; // 32KB 一段
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const sub = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, sub);
    }
    return btoa(binary);
  }

  /** 去掉 dataURL 前缀（data:image/png;base64,xxxx -> xxxx） */
  function stripDataUrl(str) {
    if (typeof str !== "string") return str;
    const idx = str.indexOf("base64,");
    return idx >= 0 ? str.slice(idx + 7) : str;
  }

  /** base64 -> Blob，用于 multipart/form-data 上传 */
  function base64ToBlob(base64, mime) {
    const bytes = base64ToUint8Array(base64);
    return new Blob([bytes], { type: mime || "image/png" });
  }

  /** 异步延时 */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 简单防抖 */
  function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /** 安全读取嵌套属性 a?.b?.c */
  function get(obj, path, fallback) {
    try {
      return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj) ?? fallback;
    } catch (e) {
      return fallback;
    }
  }

  /** 生成短时间戳，用于图层命名 */
  function timeTag() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  /** 截断字符串用于命名/日志 */
  function truncate(str, n) {
    if (!str) return "";
    str = String(str).replace(/\s+/g, " ").trim();
    return str.length > n ? str.slice(0, n) + "…" : str;
  }

  PSAI.utils = {
    base64ToUint8Array,
    uint8ArrayToBase64,
    stripDataUrl,
    base64ToBlob,
    sleep,
    debounce,
    get,
    timeTag,
    truncate,
  };
})(typeof window !== "undefined" ? window : this);
