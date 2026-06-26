/*
 * selection.js — 选区读取与像素导出
 *   getSelectionInfo() : 轻量读取当前选区状态（供 UI 显示，不进 modal）
 *   exportSelection()  : 在 modal 中把选区（或整图）导出为 PNG base64
 */
(function (root) {
  "use strict";
  const PSAI = (root.PSAI = root.PSAI || {});
  const U = PSAI.utils;

  const ps = require("photoshop");
  const app = ps.app;
  const core = ps.core;
  const imaging = ps.imaging;

  /** 把可能带单位的数值统一成像素数字 */
  function num(v) {
    if (v == null) return 0;
    if (typeof v === "object") return v._value != null ? v._value : v.value != null ? v.value : 0;
    return v;
  }

  function readSelectionBounds(doc) {
    let b = null;
    try {
      b = doc.selection && doc.selection.bounds;
    } catch (e) {
      b = null;
    }
    if (!b) return null;
    const r = {
      left: Math.round(num(b.left)),
      top: Math.round(num(b.top)),
      right: Math.round(num(b.right)),
      bottom: Math.round(num(b.bottom)),
    };
    if (r.right - r.left < 1 || r.bottom - r.top < 1) return null;
    return r;
  }

  function clampBounds(b, doc) {
    const w = Math.round(num(doc.width));
    const h = Math.round(num(doc.height));
    const left = Math.max(0, Math.min(b.left, w - 1));
    const top = Math.max(0, Math.min(b.top, h - 1));
    const right = Math.max(left + 1, Math.min(b.right, w));
    const bottom = Math.max(top + 1, Math.min(b.bottom, h));
    return { left, top, right, bottom };
  }

  /** 轻量状态读取，不修改文档 */
  function getSelectionInfo() {
    try {
      const doc = app.activeDocument;
      if (!doc) return { hasDoc: false, hasSelection: false };
      const b = readSelectionBounds(doc);
      if (!b) {
        return {
          hasDoc: true,
          hasSelection: false,
          docW: Math.round(num(doc.width)),
          docH: Math.round(num(doc.height)),
        };
      }
      return { hasDoc: true, hasSelection: true, width: b.right - b.left, height: b.bottom - b.top };
    } catch (e) {
      return { hasDoc: false, hasSelection: false, error: e.message };
    }
  }

  async function exportRegion(doc, bounds, maxEdge) {
    const w = bounds.right - bounds.left;
    const h = bounds.bottom - bounds.top;
    const opts = {
      documentID: doc.id,
      sourceBounds: bounds,
      componentSize: 8,
      applyAlpha: false,
    };
    // 控制上传尺寸：超过最长边则等比缩小（放回时再无损缩放回原选区大小）
    if (maxEdge && Math.max(w, h) > maxEdge) {
      const scale = maxEdge / Math.max(w, h);
      opts.targetSize = {
        width: Math.max(1, Math.round(w * scale)),
        height: Math.max(1, Math.round(h * scale)),
      };
    }
    const pix = await imaging.getPixels(opts);

    // JPEG 不支持 alpha：若像素是 4 通道（带 alpha），先剔掉 alpha 转成 RGB 再编码，
    // 否则带透明的图层会报 "image data with alpha cannot be encoded as jpeg"。
    let encodeTarget = pix.imageData;
    let rgbData = null;
    try {
      if (pix.imageData.components === 4) {
        const raw = await pix.imageData.getData();
        const w2 = pix.imageData.width;
        const h2 = pix.imageData.height;
        const rgb = new Uint8Array(w2 * h2 * 3);
        for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
          rgb[j] = raw[i];
          rgb[j + 1] = raw[i + 1];
          rgb[j + 2] = raw[i + 2];
        }
        rgbData = await imaging.createImageDataFromBuffer(rgb, {
          width: w2,
          height: h2,
          components: 3,
          componentSize: 8,
          colorSpace: pix.imageData.colorSpace || "RGB",
          colorProfile: pix.imageData.colorProfile,
        });
        encodeTarget = rgbData;
      }
    } catch (e) {
      console.warn("剔离 alpha 失败，按原样编码：", e && e.message);
    }

    const base64 = await imaging.encodeImageData({
      imageData: encodeTarget,
      base64: true,
    });

    try {
      pix.imageData.dispose();
    } catch (e) {
      /* ignore */
    }
    try {
      if (rgbData) rgbData.dispose();
    } catch (e) {
      /* ignore */
    }
    return base64;
  }

  /**
   * 导出当前选区（无选区时可回退整图）。
   * @returns {Promise<{base64:string, bounds:object, isSelection:boolean, docId:number}>}
   */
  async function exportSelection(opts) {
    opts = opts || {};
    const fallbackToFullDoc = opts.fallbackToFullDoc !== false;
    const maxEdge = opts.maxEdge || 0;

    return await core.executeAsModal(
      async () => {
        const doc = app.activeDocument;
        if (!doc) throw new Error("没有打开的文档，请先在 Photoshop 中打开或新建一个文件。");

        let bounds = readSelectionBounds(doc);
        const isSelection = !!bounds;
        if (!bounds) {
          if (!fallbackToFullDoc) {
            throw new Error("未检测到选区。请先用选框工具（M）框选一块区域。");
          }
          bounds = { left: 0, top: 0, right: Math.round(num(doc.width)), bottom: Math.round(num(doc.height)) };
        }
        bounds = clampBounds(bounds, doc);
        const base64 = await exportRegion(doc, bounds, maxEdge);
        return { base64, bounds, isSelection, docId: doc.id };
      },
      { commandName: "导出选区像素" }
    );
  }

  PSAI.selection = { getSelectionInfo, exportSelection };
})(typeof window !== "undefined" ? window : this);
