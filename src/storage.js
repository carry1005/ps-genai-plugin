/*
 * storage.js — 凭据与设置持久化
 *  - API Key：使用 UXP secureStorage 加密存储（按模型隔离），不落明文。
 *  - 普通设置：使用 localStorage 保存上次选择的模型、参数等非敏感项。
 */
(function (root) {
  "use strict";
  const PSAI = (root.PSAI = root.PSAI || {});

  const uxp = require("uxp");
  const secureStorage = uxp.storage.secureStorage;
  const SETTINGS_KEY = "psai.settings.v1";

  function keyName(modelId) {
    return `psai.apikey.${modelId}`;
  }

  /** 保存某模型的 API Key；传空则删除 */
  async function saveApiKey(modelId, key) {
    const name = keyName(modelId);
    if (!key) {
      try {
        await secureStorage.removeItem(name);
      } catch (e) {
        /* 不存在则忽略 */
      }
      return;
    }
    await secureStorage.setItem(name, key);
  }

  /** 读取某模型的 API Key，返回明文字符串（无则空串） */
  async function getApiKey(modelId) {
    try {
      const val = await secureStorage.getItem(keyName(modelId));
      if (!val) return "";
      // secureStorage 返回 Uint8Array
      return new TextDecoder().decode(val);
    } catch (e) {
      return "";
    }
  }

  /** 读取全部非敏感设置 */
  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  /** 合并写入非敏感设置 */
  function saveSettings(patch) {
    try {
      const cur = loadSettings();
      const next = Object.assign({}, cur, patch);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    } catch (e) {
      return patch;
    }
  }

  PSAI.storage = {
    saveApiKey,
    getApiKey,
    loadSettings,
    saveSettings,
  };
})(typeof window !== "undefined" ? window : this);
