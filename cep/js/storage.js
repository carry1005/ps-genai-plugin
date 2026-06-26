/*
 * storage.js — 凭据与设置持久化
 *  - 全部使用 localStorage：在 UDT 加载、系统 extensions 目录加载等各种方式下都稳定可用。
 *    （secureStorage 在开发者/手动加载模式下可能不可用，会导致密钥存不进去。）
 */
(function (root) {
  "use strict";
  const PSAI = (root.PSAI = root.PSAI || {});

  const SETTINGS_KEY = "psai.settings.v1";

  function keyName(modelId) {
    return `psai.apikey.${modelId}`;
  }

  /** 保存某模型的 API Key；传空则删除。用 localStorage 保证各种加载方式下都可用。 */
  async function saveApiKey(modelId, key) {
    const name = keyName(modelId);
    try {
      if (!key) {
        localStorage.removeItem(name);
      } else {
        localStorage.setItem(name, key);
      }
    } catch (e) {
      throw new Error("无法保存密钥：" + ((e && e.message) || e));
    }
  }

  /** 读取某模型的 API Key，返回明文字符串（无则空串） */
  async function getApiKey(modelId) {
    try {
      return localStorage.getItem(keyName(modelId)) || "";
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
