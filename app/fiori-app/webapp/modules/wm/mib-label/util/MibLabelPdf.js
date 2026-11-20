sap.ui.define([
    "saps4hana/fiori/modules/wm/quarantine-label/util/AetherLogo",
    "saps4hana/fiori/modules/wm/mib-label/util/MibLabelLayout",
    "saps4hana/fiori/modules/wm/mib-label/util/MibStandardSticker"
], function (AetherLogo, MibLabelLayout, MibStandardSticker) {
    "use strict";

    var _pJsPdf = null;

    /**
     * Lazily load the locally bundled jsPDF (UMD global window.jspdf.jsPDF).
     *
     * @returns {Promise<any>}
     */
    function loadJsPdf() {
        if (_pJsPdf) {
            return _pJsPdf;
        }
        _pJsPdf = new Promise(function (resolve, reject) {
            if (typeof window !== "undefined" && window.jspdf && window.jspdf.jsPDF) {
                resolve(window.jspdf.jsPDF);
                return;
            }
            if (typeof document === "undefined") {
                reject(new Error("Document is undefined"));
                return;
            }
            var oScript = document.createElement("script");
            oScript.src = sap.ui.require.toUrl("saps4hana/fiori/thirdparty/jspdf.umd.min.js");
            oScript.onload = function () {
                if (window.jspdf && window.jspdf.jsPDF) {
                    resolve(window.jspdf.jsPDF);
                } else {
                    reject(new Error("jsPDF global not found after load"));
                }
            };
            oScript.onerror = function () {
                reject(new Error("Failed to load the PDF library"));
            };
            document.head.appendChild(oScript);
        });
        return _pJsPdf;
    }

    /**
     * Draws one 100 x 100 mm standard sticker matching the physical label from Adobe Form ZMM_AF_021 / TCode ZMIB.
     *
     * @param {any} doc - jsPDF instance (unit: mm)
     * @param {object} item - Line item data
     * @param {object} meta - Header parameters (transferOrderNumber, etc.)
     */
    function drawStandardSticker(doc, item, meta) {
        if (MibStandardSticker && typeof MibStandardSticker.drawStandardSticker === "function") {
            MibStandardSticker.drawStandardSticker(doc, item, meta, MibLabelLayout.formatDate, MibLabelLayout.withoutLeadingZeros);
        }
    }

    /**
     * Plays one label's draw list onto the current jsPDF page (unit: pt).
     *
     * @param {any} doc - jsPDF instance
     * @param {object[]} aItems - Draw items
     */
    function drawItems(doc, aItems) {
        doc.setFillColor(0, 0, 0);
        doc.setTextColor(0, 0, 0);
        aItems.forEach(function (it) {
            if (it.kind === "sep") {
                // Hairline at 5% fraction of black (ZQURAN SEP.opacity = 0.05)
                if (typeof doc.GState === "function" && typeof doc.saveGraphicsState === "function") {
                    doc.saveGraphicsState();
                    doc.setGState(new doc.GState({ opacity: it.opacity }));
                    doc.setFillColor(0, 0, 0);
                    doc.rect(it.x, it.y, it.w, it.h, "F");
                    doc.restoreGraphicsState();
                } else {
                    doc.setFillColor(242, 242, 242);
                    doc.rect(it.x, it.y, it.w, it.h, "F");
                }
            } else if (it.kind === "bar" || it.kind === "rule") {
                doc.rect(it.x, it.y, it.w, it.h, "F");
            } else if (it.kind === "box") {
                doc.setDrawColor(0, 0, 0);
                doc.setLineWidth(it.lineWidth || 0.5);
                doc.rect(it.x, it.y, it.w, it.h, "S");
            } else if (it.kind === "logo") {
                doc.setFillColor(0, 0, 0);
                var fnParse = AetherLogo && AetherLogo.parsePath;
                if (fnParse && it.paths) {
                    it.paths.forEach(function (d) {
                        var ops = fnParse(d, it.scale, it.x, it.y);
                        doc.path(ops);
                        doc.fill();
                    });
                }
            } else {
                doc.setFont("helvetica", it.bold ? "bold" : "normal").setFontSize(it.pt);
                var o = {};
                if (it.align === "center") {
                    o.align = "center";
                }
                if (it.angle) {
                    o.angle = it.angle;
                }
                var bScaled = it.hScale && it.hScale !== 1;
                if (bScaled) {
                    o.horizontalScale = it.hScale;
                    doc.saveGraphicsState();
                }
                doc.text(it.text, it.x, it.y, o);
                if (bScaled) {
                    doc.restoreGraphicsState();
                }
            }
        });
    }

    /**
     * Draws one 4" x 6" vertical sticker layout onto the jsPDF document.
     *
     * @param {any} doc - jsPDF instance (unit: pt, format: [288, 432])
     * @param {object} item - Line item data
     * @param {object} meta - Header parameters
     */
    function drawVerticalSticker(doc, item, meta) {
        var aItems = MibLabelLayout.getVerticalItems(item, meta);
        drawItems(doc, aItems);
    }

    /**
     * Dispatcher drawing either standard (100x100 mm) or vertical (288x432 pt) sticker.
     *
     * @param {any} doc
     * @param {object} item
     * @param {object} meta
     */
    function drawSticker(doc, item, meta) {
        var sVariant = (meta && meta.variant) || MibLabelLayout.VARIANTS.STANDARD;
        if (sVariant === MibLabelLayout.VARIANTS.VERTICAL) {
            drawVerticalSticker(doc, item, meta);
        } else {
            drawStandardSticker(doc, item, meta);
        }
    }

    /**
     * Builds a jsPDF document for the given sticker items according to the chosen variant.
     *
     * @param {any} JsPdfClass
     * @param {object[]} aItems
     * @param {object} [oMeta]
     * @returns {any}
     */
    function generateDoc(JsPdfClass, aItems, oMeta) {
        var meta = oMeta || {};
        var sVariant = meta.variant || MibLabelLayout.VARIANTS.STANDARD;
        var bIsVertical = sVariant === MibLabelLayout.VARIANTS.VERTICAL;
        var aFormat = bIsVertical ? [288, 432] : [100, 100];
        var sUnit = bIsVertical ? "pt" : "mm";

        var doc = new JsPdfClass({
            orientation: "portrait",
            unit: sUnit,
            format: aFormat,
            compress: true
        });

        if (typeof doc.viewerPreferences === "function") {
            doc.viewerPreferences({ PrintScaling: "None" });
        }

        var aRows = (aItems && aItems.length > 0) ? aItems : [{}];
        aRows.forEach(function (item, index) {
            if (index > 0) {
                doc.addPage(aFormat, "portrait");
            }
            drawSticker(doc, item, meta);
        });

        return doc;
    }

    /**
     * Generates a PDF Blob asynchronously.
     *
     * @param {object[]} aItems
     * @param {object} [oMeta]
     * @returns {Promise<Blob>}
     */
    function generateBlob(aItems, oMeta) {
        return loadJsPdf().then(function (JsPdfClass) {
            var doc = generateDoc(JsPdfClass, aItems, oMeta);
            return doc.output("blob");
        });
    }

    /**
     * Downloads the PDF file directly.
     *
     * @param {object[]} aItems
     * @param {string} sFileName
     * @param {object} [oMeta]
     * @returns {Promise<void>}
     */
    function download(aItems, sFileName, oMeta) {
        return loadJsPdf().then(function (JsPdfClass) {
            var doc = generateDoc(JsPdfClass, aItems, oMeta);
            doc.save(sFileName || "MIB-Sticker.pdf");
        });
    }

    /**
     * Triggers in-browser printing for the generated sticker PDF.
     *
     * @param {object[]} aItems
     * @param {object} [oMeta]
     * @returns {Promise<void>}
     */
    function print(aItems, oMeta) {
        return generateBlob(aItems, oMeta).then(function (oBlob) {
            var sUrl = URL.createObjectURL(oBlob);
            var oIframe = document.getElementById("mibPrintIframe");
            if (!oIframe) {
                oIframe = document.createElement("iframe");
                oIframe.id = "mibPrintIframe";
                oIframe.style.position = "fixed";
                oIframe.style.right = "0";
                oIframe.style.bottom = "0";
                oIframe.style.width = "0";
                oIframe.style.height = "0";
                oIframe.style.border = "0";
                document.body.appendChild(oIframe);
            }
            oIframe.src = sUrl;
            oIframe.onload = function () {
                try {
                    oIframe.contentWindow.focus();
                    oIframe.contentWindow.print();
                } catch {
                    window.open(sUrl, "_blank");
                }
            };
        });
    }

    return {
        VARIANTS: MibLabelLayout.VARIANTS,
        SEP: MibLabelLayout.SEP,
        V_LAYOUT: MibLabelLayout.V_LAYOUT,
        loadJsPdf: loadJsPdf,
        measureTextPt: MibLabelLayout.measureTextPt,
        formatDate: MibLabelLayout.formatDate,
        withoutLeadingZeros: MibLabelLayout.withoutLeadingZeros,
        getVerticalItems: MibLabelLayout.getVerticalItems,
        drawItems: drawItems,
        drawStandardSticker: drawStandardSticker,
        drawVerticalSticker: drawVerticalSticker,
        drawSticker: drawSticker,
        generateDoc: generateDoc,
        generateBlob: generateBlob,
        download: download,
        print: print
    };
});
