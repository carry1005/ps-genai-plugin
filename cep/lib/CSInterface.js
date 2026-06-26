/*
 * CSInterface 精简版 — 提供 CEP 面板与 ExtendScript(宿主)通信所需的核心能力。
 * 仅实现本插件用到的方法：evalScript / getHostEnvironment / getSystemPath。
 * 底层依赖 CEP 注入的全局对象 window.__adobe_cep__。
 */
function CSInterface() {}

/** 调用宿主端(ExtendScript)脚本，callback 收到字符串返回值 */
CSInterface.prototype.evalScript = function (script, callback) {
  if (typeof window.__adobe_cep__ !== "undefined" && window.__adobe_cep__) {
    window.__adobe_cep__.evalScript(script, callback || function () {});
  } else if (callback) {
    callback("ERR|CEP 环境不可用(__adobe_cep__ 未注入)");
  }
};

/** 获取宿主环境信息(appName/appVersion 等) */
CSInterface.prototype.getHostEnvironment = function () {
  try {
    return JSON.parse(window.__adobe_cep__.getHostEnvironment());
  } catch (e) {
    return {};
  }
};

/** 获取扩展自身路径等系统路径 */
CSInterface.prototype.getSystemPath = function (type) {
  try {
    var path = window.__adobe_cep__.getSystemPath(type);
    return decodeURIComponent(path);
  } catch (e) {
    return "";
  }
};

SystemPath = {
  EXTENSION: "extension",
  USER_DATA: "userData",
  COMMON_FILES: "commonFiles",
  HOST_APPLICATION: "hostApplication",
};
