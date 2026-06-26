/*
 * host.jsx — ExtendScript 宿主脚本，负责所有 Photoshop 操作。
 * 由面板通过 CSInterface.evalScript("函数(参数)") 调用，返回字符串结果。
 * 约定返回格式：成功 "OK|..."，失败 "ERR|错误信息"。
 */
#target photoshop

// 取选区(或整图)的像素边界 [left, top, right, bottom]
function _psaiBounds(doc, hasSel) {
    if (hasSel) {
        var b = doc.selection.bounds;
        return [
            Math.round(b[0].as("px")),
            Math.round(b[1].as("px")),
            Math.round(b[2].as("px")),
            Math.round(b[3].as("px"))
        ];
    }
    return [0, 0, Math.round(doc.width.as("px")), Math.round(doc.height.as("px"))];
}

// 轻量查询当前选区状态：返回 "sel|w|h|docW|docH" / "nosel|0|0|docW|docH" / "nodoc"
function psaiSelectionInfo() {
    try {
        if (app.documents.length === 0) return "nodoc";
        var doc = app.activeDocument;
        var hasSel = true;
        try { var t = doc.selection.bounds; } catch (e) { hasSel = false; }
        var b = _psaiBounds(doc, hasSel);
        return (hasSel ? "sel" : "nosel") + "|" + (b[2] - b[0]) + "|" + (b[3] - b[1]) +
            "|" + Math.round(doc.width.as("px")) + "|" + Math.round(doc.height.as("px"));
    } catch (e) {
        return "nodoc";
    }
}

// 导出选区(或整图)为临时 JPEG 文件，返回 "OK|文件路径|left,top,right,bottom"
function psaiExportSelection(maxEdge) {
    try {
        if (app.documents.length === 0) return "ERR|没有打开的文档";
        var doc = app.activeDocument;
        var hasSel = true;
        try { var tb = doc.selection.bounds; } catch (e) { hasSel = false; }
        var b = _psaiBounds(doc, hasSel);

        var dup = doc.duplicate("__psai_tmp__", true); // 合并副本
        app.activeDocument = dup;
        if (hasSel) {
            dup.crop([UnitValue(b[0], "px"), UnitValue(b[1], "px"), UnitValue(b[2], "px"), UnitValue(b[3], "px")]);
        }
        dup.flatten();

        // 调整到模型友好的尺寸范围：最短边 >= 512，最长边 <= min(maxEdge, 4096)。
        // Qwen/万相要求宽高都在 512~4096；放回时按原选区 bounds 缩放，不影响最终位置与比例。
        var w = dup.width.as("px"), h = dup.height.as("px");
        var cap = (maxEdge && maxEdge > 0) ? maxEdge : 2048;
        if (cap > 4096) cap = 4096;
        if (cap < 512) cap = 512;
        var scale = 1;
        var minSide = Math.min(w, h), maxSide = Math.max(w, h);
        if (minSide < 512) scale = 512 / minSide;       // 放大过小的选区
        if (maxSide * scale > cap) scale = cap / maxSide; // 不超过上限
        var nw = Math.max(1, Math.round(w * scale));
        var nh = Math.max(1, Math.round(h * scale));
        // 兜底：极端长宽比时强制夹到 [512, 4096]
        if (nw < 512) nw = 512;
        if (nh < 512) nh = 512;
        if (nw > 4096) nw = 4096;
        if (nh > 4096) nh = 4096;
        if (nw !== Math.round(w) || nh !== Math.round(h)) {
            dup.resizeImage(UnitValue(nw, "px"), UnitValue(nh, "px"), null, ResampleMethod.BICUBIC);
        }

        var file = new File(Folder.temp.fsName + "/psai_in_" + (new Date().getTime()) + ".jpg");
        var opt = new JPEGSaveOptions();
        opt.quality = 10;
        dup.saveAs(file, opt, true, Extension.LOWERCASE);
        dup.close(SaveOptions.DONOTSAVECHANGES);
        app.activeDocument = doc;

        return "OK|" + file.fsName + "|" + b.join(",");
    } catch (e) {
        return "ERR|" + e.toString();
    }
}

// 把图片文件置入为新图层并对齐到 [left,top,right,bottom]，返回 "OK|图层名"
function psaiPlaceImage(path, left, top, right, bottom, layerName) {
    try {
        if (app.documents.length === 0) return "ERR|没有打开的文档";
        var doc = app.activeDocument;
        var f = new File(path);
        if (!f.exists) return "ERR|结果文件不存在: " + path;

        // 置入为智能对象(默认居中)
        var desc = new ActionDescriptor();
        desc.putPath(charIDToTypeID("null"), f);
        desc.putEnumerated(charIDToTypeID("FTcs"), charIDToTypeID("QCSt"), charIDToTypeID("Qcsa"));
        executeAction(charIDToTypeID("Plc "), desc, DialogModes.NO);

        var layer = doc.activeLayer;

        // 缩放到目标尺寸(基于左上角)
        var lb = layer.bounds;
        var lw = lb[2].as("px") - lb[0].as("px");
        var lh = lb[3].as("px") - lb[1].as("px");
        var tw = right - left, th = bottom - top;
        if (lw > 0 && lh > 0) {
            var sx = (tw / lw) * 100, sy = (th / lh) * 100;
            if (Math.abs(sx - 100) > 0.01 || Math.abs(sy - 100) > 0.01) {
                layer.resize(sx, sy, AnchorPosition.TOPLEFT);
            }
        }
        // 平移到目标左上角
        var lb2 = layer.bounds;
        var dx = left - lb2[0].as("px");
        var dy = top - lb2[1].as("px");
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
            layer.translate(UnitValue(dx, "px"), UnitValue(dy, "px"));
        }

        if (layerName) { try { layer.name = layerName; } catch (e) {} }
        return "OK|" + layer.name;
    } catch (e) {
        return "ERR|" + e.toString();
    }
}
