sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "saps4hana/fiori/modules/wm/goods-issue/service/GoodsIssueService",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    BaseController,
    JSONModel,
    Fragment,
    GoodsIssueService,
    MessageToast,
    MessageBox
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.goods-issue.controller.GoodsIssue", {
        onInit: function () {
            var oViewModel = new JSONModel({
                openReservations: [],
                selectedReservation: "",
                currentStep: 1, // 1: Select Resv & Comp, 2: Configure & Validate, 3: Review, 4: Results
                canProceedNext: false,
                audioEnabled: true,
                resolved: null,      // GoodsIssueResolution object from SAP
                activeItem: null,    // Selected component for issue
                availableStock: 0,
                issueQty: 0,
                issueQtyState: "None",
                issueQtyStateText: "",
                differenceQty: 0,
                differenceReason: "01",
                finalIssue: false,
                isValid: false,
                validationChecks: [],
                postResult: null,
                queuedCount: 0
            });
            this.getView().setModel(oViewModel, "giView");

            var oBatchModel = new JSONModel({
                material: "",
                materialDesc: "",
                plant: "",
                storageLocation: "",
                batches: [],
                rawBatches: [],
                noDataReason: "",
                selectedBatch: null
            });
            this.getView().setModel(oBatchModel, "giBatchSelection");

            var oRouter = this.getRouter();
            if (oRouter) {
                var oRoute = oRouter.getRoute("wmGoodsIssue");
                if (oRoute) {
                    oRoute.attachPatternMatched(this._onPatternMatched, this);
                }
            }

            // Load open reservations directly from live SAP S/4HANA & refresh Dispatch Queue
            this.loadOpenReservations();
            this._refreshQueueCount();
        },

        onExit: function () {
            if (this._oBatchSelectionDialog) {
                this._oBatchSelectionDialog.destroy();
                this._oBatchSelectionDialog = null;
            }
            if (this._oQueueTrayDialog) {
                this._oQueueTrayDialog.destroy();
                this._oQueueTrayDialog = null;
            }
            if (this._oResvValueHelpDialog) {
                this._oResvValueHelpDialog.destroy();
                this._oResvValueHelpDialog = null;
            }
        },

        onNavBack: function () {
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.navTo("dashboard", {}, true);
            }
        },

        _onPatternMatched: function () {
            this.loadOpenReservations();
            this._refreshQueueCount();
        },

        onToggleAudio: function () {
            var oModel = this.getView().getModel("giView");
            var bCurrent = oModel.getProperty("/audioEnabled");
            oModel.setProperty("/audioEnabled", !bCurrent);
            MessageToast.show(bCurrent ? "Audio cues muted" : "Audio cues enabled");
        },

        onResetWorkflow: function () {
            var oModel = this.getView().getModel("giView");
            oModel.setProperty("/selectedReservation", "");
            oModel.setProperty("/currentStep", 1);
            oModel.setProperty("/canProceedNext", false);
            oModel.setProperty("/resolved", null);
            oModel.setProperty("/activeItem", null);
            oModel.setProperty("/availableStock", 0);
            oModel.setProperty("/issueQty", 0);
            oModel.setProperty("/issueQtyState", "None");
            oModel.setProperty("/issueQtyStateText", "");
            oModel.setProperty("/differenceQty", 0);
            oModel.setProperty("/differenceReason", "01");
            oModel.setProperty("/finalIssue", false);
            oModel.setProperty("/isValid", false);
            oModel.setProperty("/validationChecks", []);
            oModel.setProperty("/postResult", null);

            var oWizard = this.byId("giWizard");
            if (oWizard) {
                var oStep1 = this.byId("stepResvComponent");
                if (oStep1) {
                    oWizard.discardProgress(oStep1);
                    oWizard.goToStep(oStep1);
                }
            }
            MessageToast.show("Goods Issue workflow reset");
        },

        _playBeep: function (bSuccess) {
            var oModel = this.getView().getModel("giView");
            if (!oModel.getProperty("/audioEnabled")) return;

            try {
                var AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!AudioContext) return;
                var ctx = new AudioContext();
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);

                if (bSuccess) {
                    osc.frequency.setValueAtTime(880, ctx.currentTime);
                    gain.gain.setValueAtTime(0.1, ctx.currentTime);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.15);
                } else {
                    osc.frequency.setValueAtTime(220, ctx.currentTime);
                    gain.gain.setValueAtTime(0.2, ctx.currentTime);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.35);
                }
            } catch (_) {
                // Ignore audio context errors
            }
        },

        // =============================================================
        // STEP 1: SCAN & IDENTIFY
        // =============================================================

        loadOpenReservations: function (sPlant) {
            var oModel = this.getView().getModel("giView");
            var that = this;
            this.setBusy(true);
            return GoodsIssueService.fetchOpenReservations(sPlant)
                .then(function (aReservations) {
                    var aResvs = aReservations || [];
                    oModel.setProperty("/openReservations", aResvs);
                    return aResvs;
                })
                .catch(function (err) {
                    MessageBox.error("Failed to load open reservations from SAP: " + (err.message || err));
                    return [];
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        onRefreshReservations: function () {
            var that = this;
            return this.loadOpenReservations().then(function (aReservations) {
                MessageToast.show(aReservations.length + " open reservations loaded from SAP");
            });
        },

        onReservationSelected: function (oEvent) {
            var oSelectedItem = oEvent ? oEvent.getParameter("selectedItem") : null;
            var sReservationNo = oSelectedItem ? oSelectedItem.getKey() : "";
            if (!sReservationNo && oEvent && oEvent.getSource && oEvent.getSource().getSelectedKey) {
                sReservationNo = oEvent.getSource().getSelectedKey();
            }
            if (!sReservationNo && oEvent && oEvent.getSource && oEvent.getSource().getValue) {
                var sVal = (oEvent.getSource().getValue() || "").trim();
                var aOpen = this.getView().getModel("giView").getProperty("/openReservations") || [];
                var oFound = aOpen.find(function (r) {
                    return r.ReservationNo === sVal || (r.DisplayText && r.DisplayText.indexOf(sVal) !== -1);
                });
                if (oFound) {
                    sReservationNo = oFound.ReservationNo;
                }
            }
            if (!sReservationNo) {
                return Promise.resolve();
            }

            return this._loadReservationDetails(sReservationNo);
        },

        onOpenReservationValueHelp: function () {
            var oView = this.getView();
            var that = this;

            if (!this._oResvValueHelpDialog) {
                Fragment.load({
                    id: oView.getId(),
                    name: "saps4hana.fiori.modules.wm.goods-issue.view.ReservationValueHelpDialog",
                    controller: this
                }).then(function (oDialog) {
                    that._oResvValueHelpDialog = oDialog;
                    oView.addDependent(oDialog);
                    oDialog.open();
                });
            } else {
                this._oResvValueHelpDialog.open();
            }
        },

        onSearchReservationValueHelp: function (oEvt) {
            var sQuery = (oEvt.getParameter("value") || "").trim().toLowerCase();
            var oBinding = oEvt.getSource().getBinding("items");
            if (!oBinding) return;

            if (!sQuery) {
                oBinding.filter([]);
                return;
            }

            sap.ui.require(["sap/ui/model/Filter", "sap/ui/model/FilterOperator"], function (Filter, FilterOperator) {
                var aFilters = [
                    new Filter("DisplayText", FilterOperator.Contains, sQuery),
                    new Filter("ReservationNo", FilterOperator.Contains, sQuery),
                    new Filter("OrderNo", FilterOperator.Contains, sQuery),
                    new Filter("SampleMaterial", FilterOperator.Contains, sQuery)
                ];
                oBinding.filter(new Filter({
                    filters: aFilters,
                    and: false
                }));
            });
        },

        onConfirmReservationValueHelp: function (oEvt) {
            var oSelectedItem = oEvt.getParameter("selectedItem");
            if (oSelectedItem) {
                var oContext = oSelectedItem.getBindingContext("giView");
                var sKey = oContext ? oContext.getProperty("ReservationNo") : "";
                if (sKey) {
                    return this._loadReservationDetails(sKey);
                }
            }
            return Promise.resolve();
        },

        onCancelReservationValueHelp: function () {
            // Dialog closes automatically
        },

        /**
         * Load open reservation components directly from live SAP S/4HANA
         * @param {string} sReservationNo - Authentic SAP Reservation Number
         */
        _loadReservationDetails: function (sReservationNo) {
            var oModel = this.getView().getModel("giView");
            var that = this;

            var aOpen = oModel.getProperty("/openReservations") || [];
            var oResv = aOpen.find(function (r) { return r.ReservationNo === sReservationNo; });

            oModel.setProperty("/selectedReservation", sReservationNo);
            oModel.setProperty("/activeItem", null);
            oModel.setProperty("/canProceedNext", false);

            var oWizard = this.byId("giWizard");
            if (oWizard) {
                var oStep1 = this.byId("stepResvComponent");
                if (oStep1) oWizard.invalidateStep(oStep1);
            }

            this.setBusy(true);
            var sOrderNo = (oResv && oResv.OrderNo) ? oResv.OrderNo : "";
            return GoodsIssueService.fetchOpenItems(sOrderNo, sReservationNo)
                .then(function (aItems) {
                    that._playBeep(true);
                    var oResolved = {
                        ReservationNo: sReservationNo,
                        OrderNo: sOrderNo || (aItems && aItems[0] ? aItems[0].OrderNo : ""),
                        Plant: (oResv && oResv.Plant) ? oResv.Plant : (aItems && aItems[0] ? aItems[0].Plant : ""),
                        MovementType: (oResv && oResv.MovementType) ? oResv.MovementType : "261",
                        MovementTypeName: (oResv && oResv.MovementTypeName) ? oResv.MovementTypeName : "GI for order",
                        Items: aItems || []
                    };
                    oModel.setProperty("/resolved", oResolved);
                    MessageToast.show("Reservation " + sReservationNo + " loaded (" + (aItems ? aItems.length : 0) + " open components)");
                    return oResolved;
                })
                .catch(function (err) {
                    that._playBeep(false);
                    MessageBox.error("Failed to load components for Reservation " + sReservationNo + ": " + (err.message || err));
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        // =============================================================
        // STEP 2: SAP RESOLVE & COMPONENT SELECTION
        // =============================================================

        onSearchComponents: function (oEvent) {
            var sQuery = (oEvent.getParameter("newValue") || oEvent.getParameter("query") || "").trim().toLowerCase();
            var oTable = this.byId("tblComponentItems");
            if (!oTable) return;
            var oBinding = oTable.getBinding("items");
            if (!oBinding) return;

            if (!sQuery) {
                oBinding.filter([]);
                return;
            }

            sap.ui.require(["sap/ui/model/Filter", "sap/ui/model/FilterOperator"], function (Filter, FilterOperator) {
                var aFilters = [
                    new Filter("ReservationItem", FilterOperator.Contains, sQuery),
                    new Filter("Material", FilterOperator.Contains, sQuery),
                    new Filter("MaterialDesc", FilterOperator.Contains, sQuery),
                    new Filter("StorageBin", FilterOperator.Contains, sQuery)
                ];
                oBinding.filter(new Filter({
                    filters: aFilters,
                    and: false
                }));
            });
        },

        onSelectComponentForValidation: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("giView");
            if (!oContext) return;
            var oItem = oContext.getObject();

            if (!oItem || Number(oItem.OpenQty) <= 0) {
                MessageToast.show("This component line is already completed");
                return;
            }

            var oModel = this.getView().getModel("giView");
            var oResolved = oModel.getProperty("/resolved");

            // Set active item
            oModel.setProperty("/activeItem", Object.assign({}, oItem));

            // Determine available stock
            var nStock = 0;
            var aBatches = (oResolved && oResolved.AvailableBatches) || [];
            if (oItem.Batch && aBatches.length > 0) {
                var oMatchedBatch = aBatches.find(function (b) { return b.Batch === oItem.Batch; });
                if (oMatchedBatch && oMatchedBatch.AvailableStock !== null && oMatchedBatch.AvailableStock !== undefined) {
                    nStock = Number(oMatchedBatch.AvailableStock);
                }
            }
            if (!nStock && oResolved) {
                nStock = Number(oResolved.AvailableStock) || Number(oItem.OpenQty);
            }
            if (!nStock) {
                nStock = Number(oItem.OpenQty);
            }
            oModel.setProperty("/availableStock", nStock);

            // Reset validation fields
            oModel.setProperty("/issueQty", Number(oItem.OpenQty) || 0);
            oModel.setProperty("/differenceQty", 0);
            oModel.setProperty("/differenceReason", "01");
            oModel.setProperty("/finalIssue", false);

            // Run initial validation
            this._validateInputs();

            // Validate Step 1 and enable proceed
            var oWizard = this.byId("giWizard");
            if (oWizard) {
                var oStep1 = this.byId("stepResvComponent");
                if (oStep1) oWizard.validateStep(oStep1);
            }
            oModel.setProperty("/canProceedNext", true);
            this._goToStep(2);
        },

        // =============================================================
        // STEP 2: CONFIGURE & VALIDATE
        // =============================================================

        onIssueQtyChange: function (oEvent) {
            if (oEvent && oEvent.getParameter) {
                var sVal = oEvent.getParameter("value");
                if (sVal !== undefined) {
                    this.getView().getModel("giView").setProperty("/issueQty", sVal);
                }
            }
            this._validateInputs();
        },

        onDifferenceQtyChange: function (oEvent) {
            if (oEvent && oEvent.getParameter) {
                var sVal = oEvent.getParameter("value");
                if (sVal !== undefined) {
                    this.getView().getModel("giView").setProperty("/differenceQty", sVal);
                }
            }
            this._validateInputs();
        },

        onFillOpenQty: function () {
            var oModel = this.getView().getModel("giView");
            var oActive = oModel.getProperty("/activeItem");
            if (oActive) {
                oModel.setProperty("/issueQty", Number(oActive.OpenQty) || 0);
                oModel.setProperty("/differenceQty", 0);
                this._validateInputs();
                MessageToast.show("Issue quantity set to full open quantity: " + oActive.OpenQty + " " + oActive.Unit);
            }
        },

        /**
         * Central validation engine: validates all inputs and updates the validation checklist
         * Disables the "Proceed to Review" CTA until all checks pass
         */
        _validateInputs: function () {
            var oModel = this.getView().getModel("giView");
            var oActive = oModel.getProperty("/activeItem");
            if (!oActive) {
                oModel.setProperty("/isValid", false);
                return;
            }

            var nIssueQty = Number(oModel.getProperty("/issueQty")) || 0;
            var nOpenQty = Number(oActive.OpenQty) || 0;
            var nStock = Number(oModel.getProperty("/availableStock")) || 0;
            var sBatch = oActive.Batch || "";
            var sBatchState = oActive.BatchStatusState || "None";
            var nDiffQty = Number(oModel.getProperty("/differenceQty")) || 0;

            var aChecks = [];
            var bAllPassed = true;

            // Check 1: Document verified in SAP
            var oResolved = oModel.getProperty("/resolved");
            var bDocVerified = !!(oResolved && oResolved.ReservationNo);
            aChecks.push({ label: "Document verified in SAP S/4HANA", passed: bDocVerified });
            if (!bDocVerified) bAllPassed = false;

            // Check 2: Issue Qty > 0
            var bQtyPositive = nIssueQty > 0;
            aChecks.push({ label: "Issue quantity is greater than zero (" + nIssueQty + " " + (oActive.Unit || "") + ")", passed: bQtyPositive });
            if (!bQtyPositive) bAllPassed = false;

            // Check 3: Issue Qty <= Open Qty
            var bQtyWithinOpen = nIssueQty <= nOpenQty;
            aChecks.push({ label: "Issue quantity does not exceed open requirement (" + nIssueQty + " ≤ " + nOpenQty + ")", passed: bQtyWithinOpen });
            if (!bQtyWithinOpen) bAllPassed = false;

            // Check 4: Issue Qty <= Available Stock (if stock is known and > 0)
            var bQtyWithinStock = true;
            if (nStock > 0) {
                bQtyWithinStock = nIssueQty <= nStock;
                aChecks.push({ label: "Issue quantity does not exceed confirmed SAP stock (" + nIssueQty + " ≤ " + nStock + ")", passed: bQtyWithinStock });
                if (!bQtyWithinStock) bAllPassed = false;
            }

            // Check 5: Batch validity (if batch is assigned)
            var bBatchValid = true;
            if (sBatch) {
                bBatchValid = sBatchState !== "Error";
                aChecks.push({ label: "Batch " + sBatch + " is valid and unexpired (SLED verified)", passed: bBatchValid });
                if (!bBatchValid) bAllPassed = false;
            } else {
                aChecks.push({ label: "Batch selection (optional — no batch assigned)", passed: true });
            }

            // Check 6: Required fields populated
            var bFieldsOk = !!(oActive.Material && oActive.Plant);
            aChecks.push({ label: "Required fields populated (Material, Plant)", passed: bFieldsOk });
            if (!bFieldsOk) bAllPassed = false;

            // Check 7: Difference validation (if difference > 0, issue + diff should equal open)
            if (nDiffQty > 0) {
                var bDiffValid = (nIssueQty + nDiffQty) <= nOpenQty;
                aChecks.push({ label: "Issue + Difference does not exceed open quantity (" + nIssueQty + " + " + nDiffQty + " ≤ " + nOpenQty + ")", passed: bDiffValid });
                if (!bDiffValid) bAllPassed = false;
            }

            // Update quantity validation state
            var sQtyState = "None";
            var sQtyStateText = "";
            if (nIssueQty <= 0) {
                sQtyState = "Error";
                sQtyStateText = "Issue quantity must be greater than zero";
            } else if (nIssueQty > nOpenQty) {
                sQtyState = "Error";
                sQtyStateText = "Issue quantity (" + nIssueQty + ") exceeds open requirement (" + nOpenQty + " " + (oActive.Unit || "") + ")";
            } else if (nStock > 0 && nIssueQty > nStock) {
                sQtyState = "Warning";
                sQtyStateText = "Issue quantity (" + nIssueQty + ") exceeds confirmed SAP stock (" + nStock + " " + (oActive.Unit || "") + ")";
            } else {
                sQtyState = "Success";
                sQtyStateText = "";
            }

            oModel.setProperty("/issueQtyState", sQtyState);
            oModel.setProperty("/issueQtyStateText", sQtyStateText);
            oModel.setProperty("/validationChecks", aChecks);
            oModel.setProperty("/isValid", bAllPassed);

            if (oModel.getProperty("/currentStep") === 2) {
                oModel.setProperty("/canProceedNext", bAllPassed);
            }
            var oWizard = this.byId("giWizard");
            if (oWizard) {
                var oStepConfigure = this.byId("stepConfigure");
                if (oStepConfigure) {
                    if (bAllPassed) {
                        oWizard.validateStep(oStepConfigure);
                    } else {
                        oWizard.invalidateStep(oStepConfigure);
                    }
                }
            }
        },

        // Batch Selection Dialog
        onOpenBatchSelectionDialog: function () {
            var oModel = this.getView().getModel("giView");
            var oActive = oModel.getProperty("/activeItem");
            if (!oActive || !oActive.Material) {
                MessageBox.error("No active component line selected for batch lookup");
                return;
            }

            var oBatchModel = this.getView().getModel("giBatchSelection");
            oBatchModel.setProperty("/material", oActive.Material);
            oBatchModel.setProperty("/materialDesc", oActive.MaterialDesc || "");
            oBatchModel.setProperty("/plant", oActive.Plant || "");
            oBatchModel.setProperty("/storageLocation", oActive.StorageLocation || "");
            oBatchModel.setProperty("/batches", []);
            oBatchModel.setProperty("/rawBatches", []);
            oBatchModel.setProperty("/noDataReason", "Loading authentic batches from SAP S/4HANA...");

            var that = this;
            var oView = this.getView();
            this.setBusy(true);

            return GoodsIssueService.fetchMaterialBatches(oActive.Material, oActive.Plant, oActive.StorageLocation)
                .then(function (aBatches) {
                    var aList = Array.isArray(aBatches) ? aBatches : [];
                    oBatchModel.setProperty("/rawBatches", aList);
                    oBatchModel.setProperty("/batches", aList);

                    if (aList.length === 0) {
                        var sEmptyReason = "No usable, unexpired batches available in SAP for material " + oActive.Material +
                                           " (Plant " + (oActive.Plant || "-") + ").";
                        oBatchModel.setProperty("/noDataReason", sEmptyReason);
                    } else {
                        oBatchModel.setProperty("/noDataReason", "");
                    }

                    if (!that._oBatchSelectionDialog) {
                        return Fragment.load({
                            id: oView.getId(),
                            name: "saps4hana.fiori.modules.wm.goods-issue.view.BatchSelectionDialog",
                            controller: that
                        }).then(function (oDialog) {
                            that._oBatchSelectionDialog = oDialog;
                            oView.addDependent(oDialog);
                            oDialog.open();
                        });
                    } else {
                        that._oBatchSelectionDialog.open();
                    }
                })
                .catch(function (err) {
                    MessageBox.error("Failed to load batches: " + (err.message || err));
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        onSearchBatches: function (oEvent) {
            var sQuery = (oEvent.getParameter("newValue") !== undefined ? oEvent.getParameter("newValue") : oEvent.getParameter("query")) || "";
            sQuery = sQuery.trim().toLowerCase();
            var oBatchModel = this.getView().getModel("giBatchSelection");
            var aRaw = oBatchModel.getProperty("/rawBatches") || [];

            if (!sQuery) {
                oBatchModel.setProperty("/batches", aRaw);
                return;
            }

            var aFiltered = aRaw.filter(function (b) {
                var sBatch = (b.Batch || "").toLowerCase();
                var sExp = (b.ExpiryDate || "").toLowerCase();
                var sStatus = (b.StatusText || "").toLowerCase();
                var sBin = (b.StorageBin || "").toLowerCase();
                var sSLoc = (b.StorageLocation || "").toLowerCase();
                var sPlant = (b.Plant || "").toLowerCase();
                return sBatch.indexOf(sQuery) !== -1 ||
                       sExp.indexOf(sQuery) !== -1 ||
                       sStatus.indexOf(sQuery) !== -1 ||
                       sBin.indexOf(sQuery) !== -1 ||
                       sSLoc.indexOf(sQuery) !== -1 ||
                       sPlant.indexOf(sQuery) !== -1;
            });

            oBatchModel.setProperty("/batches", aFiltered);
        },

        onSelectBatch: function (oEvent) {
            var oItem = oEvent.getSource();
            var oContext = oItem ? oItem.getBindingContext("giBatchSelection") : null;
            if (!oContext) return;

            var oBatch = oContext.getObject();
            if (!oBatch) return;

            // HARD-STOP: Expired batch cannot be issued
            if (oBatch.StatusState === "Error" || oBatch.StatusText === "EXPIRED") {
                this._playBeep(false);
                var sMsg = "Batch " + oBatch.Batch + " has expired on " + (oBatch.ExpiryDate || "unknown date") +
                           " (SLED exceeded).\n\nIssuing expired chemicals or ingredients to production orders is strictly prohibited by quality control rules.";
                MessageBox.error(sMsg, {
                    title: "Expired Batch Selection Blocked"
                });
                return;
            }

            var oModel = this.getView().getModel("giView");
            var oActive = oModel.getProperty("/activeItem");
            if (oActive) {
                var oUpdated = Object.assign({}, oActive, {
                    Batch: oBatch.Batch,
                    ExpiryDate: oBatch.ExpiryDate,
                    BatchStatusState: oBatch.StatusState,
                    BatchStatusText: oBatch.StatusText
                });
                if (oBatch.StorageBin) {
                    oUpdated.StorageBin = oBatch.StorageBin;
                }
                oModel.setProperty("/activeItem", oUpdated);

                // Update available stock from batch
                if (oBatch.AvailableStock !== null && oBatch.AvailableStock !== undefined) {
                    oModel.setProperty("/availableStock", Number(oBatch.AvailableStock));
                }
            }

            this._playBeep(true);
            MessageToast.show("Batch " + oBatch.Batch + " selected (" + oBatch.StatusText + ")");
            this.onCloseBatchSelectionDialog();

            // Re-validate after batch selection
            this._validateInputs();
        },

        onCloseBatchSelectionDialog: function () {
            if (this._oBatchSelectionDialog) {
                this._oBatchSelectionDialog.close();
            }
        },

        // =============================================================
        // STEP NAVIGATION (Fiori Wizard Integration)
        // =============================================================

        _goToStep: function (nStep) {
            var oModel = this.getView().getModel("giView");
            var nCurrent = oModel.getProperty("/currentStep") || 1;
            oModel.setProperty("/currentStep", nStep);

            if (nStep === 1) {
                oModel.setProperty("/canProceedNext", Boolean(oModel.getProperty("/activeItem")));
            } else if (nStep === 2) {
                oModel.setProperty("/canProceedNext", Boolean(oModel.getProperty("/isValid")));
            } else {
                oModel.setProperty("/canProceedNext", false);
            }

            var oWizard = this.byId("giWizard");
            if (oWizard) {
                var oStep1 = this.byId("stepResvComponent");
                var oStep2 = this.byId("stepConfigure");
                var oStep3 = this.byId("stepReview");
                var oTarget = nStep === 1 ? oStep1 : (nStep === 2 ? oStep2 : oStep3);

                if (oTarget) {
                    if (nStep > nCurrent) {
                        // Validate preceding step before advancing
                        if (nCurrent === 1 && oStep1) oWizard.validateStep(oStep1);
                        if (nCurrent === 2 && oStep2) oWizard.validateStep(oStep2);

                        var nProgress = (typeof oWizard.getProgress === "function") ? oWizard.getProgress() : 1;
                        if (nStep > nProgress) {
                            for (var i = nProgress; i < nStep; i++) {
                                if (i === 1 && oStep1) oWizard.validateStep(oStep1);
                                if (i === 2 && oStep2) oWizard.validateStep(oStep2);
                                if (typeof oWizard.nextStep === "function") {
                                    oWizard.nextStep();
                                }
                            }
                        } else if (typeof oWizard.goToStep === "function") {
                            oWizard.goToStep(oTarget);
                        }
                    } else if (nStep < nCurrent && typeof oWizard.goToStep === "function") {
                        oWizard.goToStep(oTarget);
                    }
                }
            }
        },

        onWizardStepActivate: function (oEvent) {
            var oStep = oEvent ? oEvent.getParameter("step") : null;
            if (!oStep) return;
            var sId = (oStep.getId && typeof oStep.getId === "function") ? oStep.getId() : "";
            var nStep = 1;
            if (sId.indexOf("stepConfigure") !== -1) {
                nStep = 2;
            } else if (sId.indexOf("stepReview") !== -1) {
                nStep = 3;
            }
            var oModel = this.getView().getModel("giView");
            oModel.setProperty("/currentStep", nStep);
            if (nStep === 1) {
                oModel.setProperty("/canProceedNext", Boolean(oModel.getProperty("/activeItem")));
            } else if (nStep === 2) {
                oModel.setProperty("/canProceedNext", Boolean(oModel.getProperty("/isValid")));
            } else {
                oModel.setProperty("/canProceedNext", false);
            }
        },

        onWizardNextStep: function () {
            var oModel = this.getView().getModel("giView");
            var nCurrent = oModel.getProperty("/currentStep");
            if (nCurrent === 1 && oModel.getProperty("/activeItem")) {
                this._goToStep(2);
            } else if (nCurrent === 2) {
                this.onProceedToReview();
            }
        },

        onWizardPreviousStep: function () {
            var oModel = this.getView().getModel("giView");
            var nCurrent = oModel.getProperty("/currentStep");
            if (nCurrent === 2) {
                this._goToStep(1);
            } else if (nCurrent === 3) {
                this._goToStep(2);
            }
        },

        onWizardCompleted: function () {
            this.onProceedToReview();
        },

        onBackToStep1: function () {
            this._goToStep(1);
        },

        onBackToStep2: function () {
            this._goToStep(2);
        },

        onBackToStep3: function () {
            this._goToStep(3);
        },

        onProceedToReview: function () {
            // Final validation gate before entering review
            this._validateInputs();
            var oModel = this.getView().getModel("giView");
            if (!oModel.getProperty("/isValid")) {
                this._playBeep(false);
                MessageBox.error("Cannot proceed to review. Please fix all validation errors first.");
                return;
            }

            this._goToStep(3);
        },

        // =============================================================
        // STEP 3: REVIEW (read-only — no logic needed, bindings only)
        // =============================================================

        // =============================================================
        // STEP 4: POST GOODS ISSUE & OUTCOME
        // =============================================================

        onPostGoodsIssue: function () {
            var oModel = this.getView().getModel("giView");
            var oActive = oModel.getProperty("/activeItem");
            var oResolved = oModel.getProperty("/resolved");
            var that = this;

            if (!oActive || !oResolved) {
                MessageBox.error("No active item or resolved document for posting");
                return;
            }

            var nIssueQty = Number(oModel.getProperty("/issueQty")) || 0;
            if (nIssueQty <= 0) {
                MessageBox.error("Issue quantity must be greater than zero");
                return;
            }

            // Final SLED hard-stop
            if (oActive.BatchStatusState === "Error" || oActive.BatchStatusText === "EXPIRED") {
                this._playBeep(false);
                MessageBox.error("Cannot issue expired batch " + oActive.Batch + " (SLED exceeded). Please select a valid batch.");
                return;
            }

            var oPayload = {
                ReservationNo: oResolved.ReservationNo,
                ReservationItem: oActive.ReservationItem,
                Material: oActive.Material,
                IssueQty: nIssueQty,
                Unit: oActive.Unit,
                Batch: oActive.Batch || "",
                DifferenceQty: Number(oModel.getProperty("/differenceQty")) || 0,
                DifferenceReason: oModel.getProperty("/differenceReason") || "",
                DifferenceStorageType: "999",
                FinalIssue: Boolean(oModel.getProperty("/finalIssue"))
            };

            // Move to Step 4 with busy indicator
            oModel.setProperty("/currentStep", 4);
            oModel.setProperty("/canProceedNext", false);
            oModel.setProperty("/postResult", null);
            this.setBusy(true);

            return GoodsIssueService.postGoodsIssue(oPayload)
                .then(function (oResult) {
                    that._playBeep(true);
                    if (oResult && oResult.Queued) {
                        oModel.setProperty("/postResult", {
                            Success: true,
                            Queued: true,
                            QueueReference: oResult.QueueReference || "",
                            SyncStatus: oResult.SyncStatus || "QUEUED",
                            ReservationNo: oPayload.ReservationNo,
                            ReservationItem: oPayload.ReservationItem,
                            Material: oPayload.Material,
                            IssueQty: nIssueQty,
                            Unit: oPayload.Unit,
                            Batch: oPayload.Batch,
                            MaterialDocument: "",
                            MaterialDocYear: "",
                            TransferOrder: "",
                            DifferenceCleared: oResult.DifferenceCleared || false,
                            DifferenceQty: oResult.DifferenceQty || 0,
                            Message: oResult.Message || "Transaction safely recorded in local CAP Dispatch Queue."
                        });
                        that._refreshQueueCount();
                        MessageToast.show("Queued in Dispatch Queue (" + oResult.QueueReference + ")");
                    } else {
                        oModel.setProperty("/postResult", {
                            Success: true,
                            Queued: false,
                            QueueReference: "",
                            SyncStatus: "POSTED_IN_SAP",
                            MaterialDocument: oResult.MaterialDocument || "",
                            MaterialDocYear: oResult.MaterialDocYear || "",
                            TransferOrder: oResult.TransferOrder || "",
                            DifferenceCleared: oResult.DifferenceCleared || false,
                            DifferenceQty: oResult.DifferenceQty || 0,
                            Message: oResult.Message || "Goods Issue 261 posted successfully in S/4HANA."
                        });
                    }
                })
                .catch(function (err) {
                    that._playBeep(false);
                    oModel.setProperty("/postResult", {
                        Success: false,
                        Queued: false,
                        MaterialDocument: "",
                        MaterialDocYear: "",
                        TransferOrder: "",
                        DifferenceCleared: false,
                        DifferenceQty: 0,
                        Message: err.message || "Posting failed. Check SAP Gateway connectivity and service activation."
                    });
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        _refreshQueueCount: function () {
            var oModel = this.getView().getModel("giView");
            return GoodsIssueService.getQueueSummary()
                .then(function (oSummary) {
                    var nCount = (oSummary && typeof oSummary.QueuedCount === "number") ? oSummary.QueuedCount : 0;
                    oModel.setProperty("/queuedCount", nCount);
                    return nCount;
                })
                .catch(function () {
                    oModel.setProperty("/queuedCount", 0);
                    return 0;
                });
        },

        onRetrySync: function () {
            var oModel = this.getView().getModel("giView");
            var oPostResult = oModel.getProperty("/postResult");
            if (!oPostResult || !oPostResult.QueueReference) {
                MessageBox.error("No queued transaction to retry");
                return Promise.resolve();
            }

            var sQueueRef = oPostResult.QueueReference;
            var that = this;
            this.setBusy(true);

            return GoodsIssueService.retryQueuedGoodsIssue(sQueueRef)
                .then(function (oResult) {
                    that.setBusy(false);
                    that._playBeep(true);
                    if (oResult.Success && oResult.MaterialDocument) {
                        oModel.setProperty("/postResult", {
                            Success: true,
                            Queued: false,
                            QueueReference: sQueueRef,
                            SyncStatus: "POSTED_IN_SAP",
                            MaterialDocument: oResult.MaterialDocument,
                            MaterialDocYear: oResult.MaterialDocYear || String(new Date().getFullYear()),
                            TransferOrder: oResult.TransferOrder || "",
                            DifferenceCleared: oResult.DifferenceCleared || false,
                            DifferenceQty: oResult.DifferenceQty || 0,
                            Message: oResult.Message || "Goods Issue successfully synchronized to SAP S/4HANA!"
                        });
                        that._refreshQueueCount();
                        MessageBox.success("Successfully synced to SAP! Material Document: " + oResult.MaterialDocument);
                    } else {
                        oModel.setProperty("/postResult/Message", oResult.Message || "SAP Gateway rejected retry request.");
                        MessageBox.warning(oResult.Message || "Retry did not post to SAP. Transaction remains in Dispatch Queue.");
                    }
                })
                .catch(function (err) {
                    that.setBusy(false);
                    that._playBeep(false);
                    MessageBox.error("Retry failed: " + (err.message || "Unknown error"));
                });
        },

        onOpenQueueTray: function () {
            var oView = this.getView();
            var that = this;

            var oQueueModel = oView.getModel("giQueue");
            if (!oQueueModel) {
                oQueueModel = new JSONModel({ items: [], queuedCount: 0 });
                oView.setModel(oQueueModel, "giQueue");
            }

            if (!this._oQueueTrayDialog) {
                Fragment.load({
                    id: oView.getId(),
                    name: "saps4hana.fiori.modules.wm.goods-issue.view.QueueTrayDialog",
                    controller: this
                }).then(function (oDialog) {
                    that._oQueueTrayDialog = oDialog;
                    oView.addDependent(oDialog);
                    that.onRefreshQueueTray();
                    oDialog.open();
                });
            } else {
                this.onRefreshQueueTray();
                this._oQueueTrayDialog.open();
            }
        },

        onCloseQueueTray: function () {
            if (this._oQueueTrayDialog) {
                this._oQueueTrayDialog.close();
            }
        },

        onRefreshQueueTray: function () {
            var oView = this.getView();
            var oQueueModel = oView.getModel("giQueue");
            var that = this;

            return GoodsIssueService.getQueueSummary()
                .then(function (oSummary) {
                    var aItems = (oSummary && oSummary.Items) ? oSummary.Items : [];
                    var nCount = (oSummary && typeof oSummary.QueuedCount === "number") ? oSummary.QueuedCount : aItems.length;
                    if (oQueueModel) {
                        oQueueModel.setData({
                            items: aItems,
                            queuedCount: nCount
                        });
                    }
                    that.getView().getModel("giView").setProperty("/queuedCount", nCount);
                    return oSummary;
                })
                .catch(function (err) {
                    MessageToast.show("Failed to refresh queue: " + (err.message || ""));
                });
        },

        onRetryQueueItem: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("giQueue");
            if (!oContext) return Promise.resolve();
            var oItem = oContext.getObject();
            var sQueueRef = oItem.QueueReference;
            var that = this;

            this.setBusy(true);
            return GoodsIssueService.retryQueuedGoodsIssue(sQueueRef)
                .then(function (oResult) {
                    that.setBusy(false);
                    if (oResult.Success && oResult.MaterialDocument) {
                        MessageBox.success("Item " + sQueueRef + " successfully posted to SAP! Material Document: " + oResult.MaterialDocument);
                    } else {
                        MessageBox.warning(oResult.Message || "Retry completed with warnings. Status: " + oResult.SyncStatus);
                    }
                    return that.onRefreshQueueTray();
                })
                .catch(function (err) {
                    that.setBusy(false);
                    MessageBox.error("Retry failed: " + (err.message || "Unknown error"));
                });
        },

        onClearQueueItem: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("giQueue");
            if (!oContext) return;
            var oItem = oContext.getObject();
            var sQueueRef = oItem.QueueReference;
            var that = this;

            MessageBox.confirm("Are you sure you want to dismiss queued transaction " + sQueueRef + "?", {
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        GoodsIssueService.clearQueuedGoodsIssue(sQueueRef)
                            .then(function () {
                                MessageToast.show("Queue item dismissed");
                                return that.onRefreshQueueTray();
                            })
                            .catch(function (err) {
                                MessageBox.error("Failed to clear item: " + (err.message || ""));
                            });
                    }
                }
            });
        },

        onSyncAllQueued: function () {
            var oQueueModel = this.getView().getModel("giQueue");
            var aItems = (oQueueModel && oQueueModel.getProperty("/items")) || [];
            var aPending = aItems.filter(function (it) {
                return it.SyncStatus === "QUEUED" || it.SyncStatus === "FAILED";
            });

            if (aPending.length === 0) {
                MessageToast.show("No pending items to synchronize");
                return Promise.resolve();
            }

            var that = this;
            this.setBusy(true);

            var p = Promise.resolve();
            var nSuccess = 0;
            var nFailed = 0;

            aPending.forEach(function (it) {
                p = p.then(function () {
                    return GoodsIssueService.retryQueuedGoodsIssue(it.QueueReference)
                        .then(function (res) {
                            if (res.Success && res.MaterialDocument) {
                                nSuccess++;
                            } else {
                                nFailed++;
                            }
                        })
                        .catch(function () {
                            nFailed++;
                        });
                });
            });

            return p.then(function () {
                that.setBusy(false);
                MessageBox.information("Sync complete. " + nSuccess + " posted to SAP, " + nFailed + " remained in queue.");
                return that.onRefreshQueueTray();
            });
        }
    });
});
