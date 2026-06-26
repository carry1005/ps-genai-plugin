/*
 * layers.js — 将生成结果作为新图层置入并对齐回原选区
 *   placeImageAsLayer(base64, targetBounds, name)
 *     1. 把 base64 写入临时 PNG
 *     2. 用 placeEvent 置入为智能对象图层（可无损再编辑）
 *     3. 缩放 + 平移，使其精确覆盖原选区矩形
 */
(function (root) {
  "use strict";
  const PSAI = (root.PSAI = root.PSAI || {});
  const U = PSAI.utils;

  const ps = require("photoshop");
  const app = ps.app;
  const core = ps.core;
  const action = ps.action;
  const constants = ps.constants;

  const uxp = require("uxp");
  const fs = uxp.storage.localFileSystem;
  const formats = uxp.storage.formats;

  function num(v) {
    if (v == null) return 0;
    if (typeof v === "object") return v._value != null ? v._value : v.value != null ? v.value : 0;
    return v;
  }

  function normBounds(b) {
    return {
      left: num(b.left),
      top: num(b.top),
      right: num(b.right),
      bottom: num(b.bottom),
    };
  }

  async function writeTempPng(base64) {
    const folder = await fs.getTemporaryFolder();
    const file = await folder.createFile("psai_" + Date.now() + ".png", { overwrite: true });
    const bytes = U.base64ToUint8Array(base64);
    await file.write(bytes.buffer, { format: formats.binary });
    return file;
  }

  async function fitLayerToBounds(layer, target) {
    const b1 = normBounds(layer.bounds);
    const lw = b1.right - b1.left;
    const lh = b1.bottom - b1.top;
    if (lw < 1 || lh < 1) return;

    const tw = target.right - target.left;
    const th = target.bottom - target.top;

    const anchor = (constants.AnchorPosition && constants.AnchorPosition.TOPLEFT) || undefined;

    const sx = (tw / lw) * 100;
    const sy = (th / lh) * 100;
    if (Math.abs(sx - 100) > 0.01 || Math.abs(sy - 100) > 0.01) {
      await layer.scale(sx, sy, anchor);
    }

    const b2 = normBounds(layer.bounds);
    const dx = target.left - b2.left;
    const dy = target.top - b2.top;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      await layer.translate(dx, dy);
    }
  }

  /**
   * 把生成图片置入为新图层并对齐到 targetBounds。
   * @returns {Promise<{layerName:string}>}
   */
  async function placeImageAsLayer(base64, targetBounds, name) {
    return await core.executeAsModal(
      async () => {
        const doc = app.activeDocument;
        if (!doc) throw new Error("没有打开的文档。");

        const file = await writeTempPng(base64);
        const token = await fs.createSessionToken(file);

        await action.batchPlay(
          [
            {
              _obj: "placeEvent",
              null: { _path: token, _kind: "local" },
              freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
              offset: {
                _obj: "offset",
                horizontal: { _unit: "distanceUnit", _value: 0 },
                vertical: { _unit: "distanceUnit", _value: 0 },
              },
            },
          ],
          {}
        );

        // 置入后，新智能对象是当前活动图层
        const layer =
          (doc.activeLayers && doc.activeLayers[0]) ||
          (doc.layers && doc.layers[0]) ||
          null;

        if (layer && targetBounds) {
          try {
            await fitLayerToBounds(layer, targetBounds);
          } catch (e) {
            // 对齐失败不致命，图层已置入
            console.warn("对齐图层失败：", e && e.message);
          }
        }

        if (layer && name) {
          try {
            layer.name = name;
          } catch (e) {
            /* ignore */
          }
        }

        try {
          await file.delete();
        } catch (e) {
          /* 临时文件清理失败可忽略 */
        }

        return { layerName: layer ? layer.name : "(未知图层)" };
      },
      { commandName: "置入 AI 生成图层" }
    );
  }

  PSAI.layers = { placeImageAsLayer };
})(typeof window !== "undefined" ? window : this);
