sap.ui.define([
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Input",
    "sap/m/Label",
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/Text",
    "sap/m/MessageToast",
    "sap/ui/core/HTML"
], function (
    Dialog,
    Button,
    Input,
    Label,
    VBox,
    HBox,
    Text,
    MessageToast,
    HTML
) {
    "use strict";

    var _fnHardwareCallback = null;
    var _sKeyBuffer = "";
    var _nLastKeyTime = 0;
    var _nMaxInterKeyDelay = 50; // ms between keys for laser hardware scanners
    var _bListenerAttached = false;
    var _oActiveCameraStream = null;
    var _oActiveCameraDialog = null;
    var _nAnimationId = null;

    /**
     * Internal keydown listener to capture Zebra hardware laser scans in keystroke wedge mode
     */
    function _onKeyDown(oEvent) {
        if (!_fnHardwareCallback) return;

        var nNow = Date.now();
        var sKey = oEvent.key;

        // Reset buffer if inter-key delay exceeds hardware laser threshold (> 50ms)
        if (nNow - _nLastKeyTime > _nMaxInterKeyDelay && _sKeyBuffer.length > 0) {
            _sKeyBuffer = "";
        }
        _nLastKeyTime = nNow;

        if (sKey === "Enter") {
            if (_sKeyBuffer.length >= 3) {
                var sScanned = _sKeyBuffer.trim();
                _sKeyBuffer = "";
                // If focus is not inside an active input, prevent standard enter navigation
                var oActive = document.activeElement;
                if (!oActive || oActive.tagName !== "INPUT") {
                    oEvent.preventDefault();
                }
                try {
                    _fnHardwareCallback(sScanned, "ZEBRA_KEYSTROKE_WEDGE");
                } catch (e) {
                    console.error("[BarcodeScanService] Hardware scan callback error:", e);
                }
            } else {
                _sKeyBuffer = "";
            }
        } else if (sKey && sKey.length === 1) {
            _sKeyBuffer += sKey;
        }
    }

    /**
     * Custom DOM event listener for Zebra DataWedge Web intents
     */
    function _onDataWedgeCustomEvent(oEvent) {
        if (!_fnHardwareCallback) return;
        var sBarcode = (oEvent.detail && (oEvent.detail.data || oEvent.detail.barcode || oEvent.detail.value)) || "";
        if (sBarcode) {
            _fnHardwareCallback(sBarcode.trim(), "ZEBRA_DATAWEDGE_EVENT");
        }
    }

    var BarcodeScanService = {
        /**
         * Attach a global listener for Zebra hardware laser scanners (both DataWedge events and keystroke wedge)
         * @param {Function} fnCallback - Function receiving (sBarcode, sSource)
         */
        attachHardwareScanner: function (fnCallback) {
            _fnHardwareCallback = fnCallback;
            _sKeyBuffer = "";
            _nLastKeyTime = 0;

            if (!_bListenerAttached && typeof window !== "undefined") {
                window.addEventListener("keydown", _onKeyDown, true);
                window.addEventListener("datawedge:scan", _onDataWedgeCustomEvent);
                document.addEventListener("barcodeScan", _onDataWedgeCustomEvent);
                _bListenerAttached = true;
            }
        },

        /**
         * Detach the hardware scanner listener
         */
        detachHardwareScanner: function () {
            _fnHardwareCallback = null;
            _sKeyBuffer = "";
            if (_bListenerAttached && typeof window !== "undefined") {
                window.removeEventListener("keydown", _onKeyDown, true);
                window.removeEventListener("datawedge:scan", _onDataWedgeCustomEvent);
                document.removeEventListener("barcodeScan", _onDataWedgeCustomEvent);
                _bListenerAttached = false;
            }
        },

        /**
         * Check whether hardware scanner listener is currently registered
         * @returns {boolean}
         */
        isHardwareScannerAttached: function () {
            return !!_fnHardwareCallback;
        },

        /**
         * Open Camera Barcode Scanner dialog
         * @param {Object} [mOptions]
         * @param {string} [mOptions.title]
         * @returns {Promise<string>} Resolves with scanned barcode string, rejects on cancel
         */
        scanWithCamera: function (mOptions) {
            var oOptions = mOptions || {};
            var sTitle = oOptions.title || "Scan Barcode";

            // 1. If running in Cordova / SAP Fiori Client container, use sap.ndc.BarcodeScanner if available
            if (sap.ui.require && sap.ui.require("sap/ndc/BarcodeScanner")) {
                var BarcodeScanner = sap.ui.require("sap/ndc/BarcodeScanner");
                if (BarcodeScanner && typeof BarcodeScanner.scan === "function") {
                    return new Promise(function (resolve, reject) {
                        BarcodeScanner.scan(
                            function (mResult) {
                                if (!mResult.cancelled && mResult.text) {
                                    resolve(mResult.text);
                                } else {
                                    reject(new Error("Scan cancelled"));
                                }
                            },
                            function (err) {
                                reject(err);
                            }
                        );
                    });
                }
            }

            // 2. Modern HTML5 Camera Scan via MediaDevices & BarcodeDetector
            return new Promise(function (resolve, reject) {
                var bResolved = false;
                var oVideoTrack = null;
                var bTorchOn = false;

                function _cleanup() {
                    if (_nAnimationId && typeof cancelAnimationFrame === "function") {
                        cancelAnimationFrame(_nAnimationId);
                        _nAnimationId = null;
                    }
                    if (_oActiveCameraStream) {
                        _oActiveCameraStream.getTracks().forEach(function (track) {
                            track.stop();
                        });
                        _oActiveCameraStream = null;
                    }
                    if (_oActiveCameraDialog) {
                        _oActiveCameraDialog.destroy();
                        _oActiveCameraDialog = null;
                    }
                }

                function _close(bSuccess, sValue) {
                    _cleanup();
                    if (!bResolved) {
                        bResolved = true;
                        if (bSuccess && sValue) {
                            resolve(sValue);
                        } else {
                            reject(new Error("Scan cancelled by operator"));
                        }
                    }
                }

                // Check browser mediaDevices support
                var bHasCameraApi = !!(typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
                var bHasBarcodeDetector = !!(typeof window !== "undefined" && window.BarcodeDetector);

                // Fallback simulation dialog if camera is unavailable in current browser environment (e.g. desktop dev or HTTP)
                if (!bHasCameraApi) {
                    var oSimInput = new Input({
                        placeholder: "Enter or select barcode to simulate...",
                        width: "100%"
                    });
                    var oSimDialog = new Dialog({
                        title: sTitle + " (Camera Simulation)",
                        contentWidth: "360px",
                        content: [
                            new VBox({
                                class: "sapUiSmallMargin",
                                items: [
                                    new Text({ text: "Camera stream is unavailable in this browser session. You can enter or simulate a barcode scan below:" }),
                                    new Label({ text: "Barcode Value:", class: "sapUiTinyMarginTop" }),
                                    oSimInput
                                ]
                            })
                        ],
                        beginButton: new Button({
                            text: "Submit Scan",
                            type: "Emphasized",
                            press: function () {
                                var sVal = (oSimInput.getValue() || "").trim();
                                oSimDialog.destroy();
                                if (sVal) {
                                    resolve(sVal);
                                } else {
                                    reject(new Error("No barcode entered"));
                                }
                            }
                        }),
                        endButton: new Button({
                            text: "Cancel",
                            press: function () {
                                oSimDialog.destroy();
                                reject(new Error("Scan cancelled"));
                            }
                        })
                    });
                    oSimDialog.open();
                    return;
                }

                // Create Live Video Viewfinder Dialog
                var sVideoId = "cam_feed_" + Date.now();
                var oVideoHtml = new HTML({
                    content: "<div style='position:relative; width:100%; height:260px; background:#000; overflow:hidden; border-radius:8px; display:flex; align-items:center; justify-content:center;'>" +
                             "<video id='" + sVideoId + "' autoplay playsinline muted style='width:100%; height:100%; object-fit:cover;'></video>" +
                             "<div style='position:absolute; width:80%; height:50%; border:2px dashed #00ffaa; border-radius:6px; pointer-events:none; box-shadow:0 0 15px rgba(0,255,170,0.5);'></div>" +
                             "<div style='position:absolute; width:100%; height:2px; background:rgba(255,0,0,0.8); top:50%; box-shadow:0 0 8px red;'></div>" +
                             "</div>"
                });

                var oBtnTorch = new Button({
                    icon: "sap-icon://lightbulb",
                    text: "Flashlight",
                    type: "Transparent",
                    press: function () {
                        if (oVideoTrack && typeof oVideoTrack.applyConstraints === "function") {
                            bTorchOn = !bTorchOn;
                            oVideoTrack.applyConstraints({
                                advanced: [{ torch: bTorchOn }]
                            }).catch(function () {
                                MessageToast.show("Flashlight not supported on this device");
                            });
                        } else {
                            MessageToast.show("Flashlight not supported");
                        }
                    }
                });

                var oManualInput = new Input({
                    placeholder: "Or type barcode manually...",
                    width: "100%",
                    submit: function () {
                        var sManual = (oManualInput.getValue() || "").trim();
                        if (sManual) {
                            _close(true, sManual);
                        }
                    }
                });

                var oDialog = new Dialog({
                    title: sTitle,
                    contentWidth: "380px",
                    content: [
                        new VBox({
                            class: "sapUiSmallMargin",
                            items: [
                                oVideoHtml,
                                new HBox({
                                    justifyContent: "SpaceBetween",
                                    alignItems: "Center",
                                    class: "sapUiTinyMarginTop sapUiTinyMarginBottom",
                                    items: [
                                        new Text({ text: "Align barcode inside the reticle", class: "textMuted" }),
                                        oBtnTorch
                                    ]
                                }),
                                new Label({ text: "Manual Entry (Fallback):" }),
                                new HBox({
                                    width: "100%",
                                    items: [
                                        oManualInput,
                                        new Button({
                                            icon: "sap-icon://accept",
                                            type: "Transparent",
                                            press: function () {
                                                var sManual = (oManualInput.getValue() || "").trim();
                                                if (sManual) {
                                                    _close(true, sManual);
                                                }
                                            }
                                        })
                                    ]
                                })
                            ]
                        })
                    ],
                    endButton: new Button({
                        text: "Cancel",
                        press: function () {
                            _close(false);
                        }
                    }),
                    afterClose: function () {
                        _cleanup();
                    }
                });

                _oActiveCameraDialog = oDialog;
                oDialog.open();

                // Initialize camera stream
                navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: "environment",
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    }
                }).then(function (stream) {
                    _oActiveCameraStream = stream;
                    oVideoTrack = stream.getVideoTracks()[0];

                    var videoEl = document.getElementById(sVideoId);
                    if (videoEl) {
                        videoEl.srcObject = stream;
                        videoEl.play().catch(function () {});
                    }

                    // If BarcodeDetector is available, initiate frame scanning loop
                    if (bHasBarcodeDetector && window.BarcodeDetector) {
                        var detector = new window.BarcodeDetector({
                            formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code", "data_matrix"]
                        });

                        function _scanFrame() {
                            if (bResolved || !_oActiveCameraDialog) return;
                            var v = document.getElementById(sVideoId);
                            if (v && v.readyState === v.HAVE_ENOUGH_DATA) {
                                detector.detect(v)
                                    .then(function (barcodes) {
                                        if (barcodes && barcodes.length > 0) {
                                            var sVal = barcodes[0].rawValue || "";
                                            if (sVal) {
                                                MessageToast.show("Barcode captured: " + sVal);
                                                _close(true, sVal);
                                                return;
                                            }
                                        }
                                        _nAnimationId = requestAnimationFrame(_scanFrame);
                                    })
                                    .catch(function () {
                                        _nAnimationId = requestAnimationFrame(_scanFrame);
                                    });
                            } else {
                                _nAnimationId = requestAnimationFrame(_scanFrame);
                            }
                        }

                        _nAnimationId = requestAnimationFrame(_scanFrame);
                    }
                }).catch(function (err) {
                    console.warn("[BarcodeScanService] Camera access denied or failed:", err);
                    MessageToast.show("Camera access unavailable. Please use manual entry.");
                });
            });
        }
    };

    return BarcodeScanService;
});
