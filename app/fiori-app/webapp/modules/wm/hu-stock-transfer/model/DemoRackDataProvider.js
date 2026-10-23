sap.ui.define([], function () {
    "use strict";

    var mSectionColors = {
        "Section A": { index: 1, color: "#4389c7", label: "Demo blue" },
        "Section B": { index: 2, color: "#57934b", label: "Demo green" },
        "Section C": { index: 3, color: "#e06b3c", label: "Demo orange" }
    };

    function makeUnit(sNumber, sSuffix, sBatch, sQuantity) {
        return {
            unitNumber: sNumber,
            serialNumber: "DEMO-SERIAL-" + sSuffix,
            batch: sBatch,
            quantity: sQuantity,
            unit: "NOS",
            material: "000000008000009754",
            cardText: "HU\n" + sNumber.slice(-4)
        };
    }

    function makeRack(iRack, sStorageType) {
        var sRackId = "L" + String(iRack).padStart(4, "0");
        var mOccupied = {
            "1-L0001-04": [
                makeUnit("2000019369", "02", "DEMO-BATCH-A", "1.000"),
                makeUnit("2000019370", "03", "DEMO-BATCH-A", "1.000"),
                makeUnit("2000019371", "04", "DEMO-BATCH-A", "1.000"),
                makeUnit("2000019372", "05", "DEMO-BATCH-A", "1.000")
            ],
            "1-L0001-01": [makeUnit("2000019401", "11", "DEMO-BATCH-B", "1.000")],
            "1-L0001-11": [makeUnit("2000019411", "21", "DEMO-BATCH-C", "1.000")],
            "1-L0001-14": [makeUnit("2000019421", "31", "DEMO-BATCH-D", "1.000")]
        };
        var aBins = Array.from({ length: 14 }, function (_unused, iIndex) {
            var iPosition = iIndex + 1;
            var sBinId = "1-" + sRackId + "-" + String(iPosition).padStart(2, "0");
            var aUnits = iRack === 1 ? (mOccupied[sBinId] || []) :
                (iPosition === (iRack + 3) ? [makeUnit("20000" + (19400 + iRack), "R" + iRack, "DEMO-BATCH-R" + iRack, "1.000")] : []);
            var sSection = ["Section A", "Section B", "Section C"][(iPosition - 1) % 3];
            var sStatus = iRack === 2 && iPosition === 13 ? "Unavailable" :
                (iRack === 3 && iPosition === 6 ? "In Process" : (aUnits.length ? "Occupied" : "Available"));
            var mState = { Occupied: "Information", Available: "Success", "In Process": "Warning", Unavailable: "Error" };
            var oSectionColor = mSectionColors[sSection];
            return {
                floor: 1,
                rackId: sRackId,
                bayId: iPosition <= 7 ? "B1" : "B2",
                bayLabel: iPosition <= 7 ? "BAY 1" : "BAY 2",
                physicalLevelId: "PICK LEVEL",
                physicalLevelLabel: "PHYSICAL LEVEL 0",
                binPosition: String(iPosition).padStart(2, "0"),
                binId: sBinId,
                binLabel: sBinId,
                section: sSection,
                sectionColor: oSectionColor.color,
                sectionColorName: oSectionColor.label,
                status: sStatus,
                statusCode: sStatus.toUpperCase().replace(/ /g, "_"),
                statusState: mState[sStatus],
                units: aUnits,
                huCount: aUnits.length,
                material: aUnits.length ? aUnits[0].material : "",
                quantity: aUnits.reduce(function (iTotal, oUnit) { return iTotal + Number(oUnit.quantity); }, 0)
            };
        });
        var aBays = [1, 2].map(function (iBay) {
            return {
                bayId: "B" + iBay,
                bayLabel: "BAY " + iBay,
                bins: aBins.filter(function (oBin) { return oBin.bayId === "B" + iBay; })
            };
        });
        var oPhysicalLevel = {
            id: "PICK LEVEL",
            label: "PHYSICAL LEVEL 0",
            bays: aBays
        };
        return {
            rackId: sRackId,
            warehouse: "DEMO WAREHOUSE",
            floor: 1,
            storageType: sStorageType,
            title: "Rack " + sRackId,
            physicalLevels: [oPhysicalLevel],
            bins: aBins
        };
    }

    function getData() {
        var aRacks = [makeRack(1, "EN1"), makeRack(2, "EN1"), makeRack(3, "EN2")];
        return {
            demoOnly: true,
            material: "000000008000009754",
            warehouse: "DEMO WAREHOUSE",
            storageTypes: ["ALL", "EN1", "EN2"],
            racks: aRacks,
            sections: Object.keys(mSectionColors).map(function (sSection) {
                return { name: sSection, color: mSectionColors[sSection].color, colorName: mSectionColors[sSection].label };
            }),
            physicalInfo: { note: "Illustrative layout only; physical rack specifications are not modeled." }
        };
    }

    return { getData: getData };
});
