/**
 * Unit Tests for BarcodeScanService (Zebra Hardware Laser & Camera Scanning)
 */

let BarcodeScanService;

const dialogs = [];
const inputs = [];

class MockDialog {
    constructor(config) {
        this.config = config || {};
        this.open = jest.fn();
        this.destroy = jest.fn();
        dialogs.push(this);
    }
}

class MockInput {
    constructor(config) {
        this.config = config || {};
        this._value = "";
        inputs.push(this);
    }
    getValue() { return this._value; }
    setValue(v) { this._value = v; }
}

class MockButton {
    constructor(config) {
        this.config = config || {};
    }
    firePress() {
        if (typeof this.config.press === 'function') {
            this.config.press();
        }
    }
}

class MockHTML {
    constructor(config) {
        this.config = config || {};
    }
}

const mockMessageToast = { show: jest.fn() };

global.sap = {
    ui: {
        define: (deps, factory) => {
            BarcodeScanService = factory(
                MockDialog,
                MockButton,
                MockInput,
                function MockLabel(c) { this.config = c; this.addStyleClass = function () { return this; }; },
                function MockVBox(c) { this.config = c; this.addStyleClass = function () { return this; }; },
                function MockHBox(c) { this.config = c; this.addStyleClass = function () { return this; }; },
                function MockText(c) { this.config = c; this.addStyleClass = function () { return this; }; },
                mockMessageToast,
                MockHTML
            );
        },
        require: jest.fn().mockReturnValue(null)
    }
};

// Require BarcodeScanService after mock definition
require('../../../app/fiori-app/webapp/service/BarcodeScanService');

describe('BarcodeScanService Unit Tests', () => {
    let windowEventListeners = {};

    beforeEach(() => {
        jest.clearAllMocks();
        windowEventListeners = {};

        // Mock window event listeners
        global.window = {
            addEventListener: jest.fn((evt, fn) => {
                windowEventListeners[evt] = fn;
            }),
            removeEventListener: jest.fn((evt) => {
                delete windowEventListeners[evt];
            })
        };
        global.document = {
            addEventListener: jest.fn((evt, fn) => {
                windowEventListeners[evt] = fn;
            }),
            removeEventListener: jest.fn((evt) => {
                delete windowEventListeners[evt];
            }),
            activeElement: { tagName: 'BODY' }
        };
    });

    afterEach(() => {
        BarcodeScanService.detachHardwareScanner();
    });

    describe('Hardware Scanner Listener (Zebra DataWedge & Keystroke Wedge)', () => {
        it('should attach and detach hardware scanner listener', () => {
            const mockCb = jest.fn();
            expect(BarcodeScanService.isHardwareScannerAttached()).toBe(false);

            BarcodeScanService.attachHardwareScanner(mockCb);
            expect(BarcodeScanService.isHardwareScannerAttached()).toBe(true);
            expect(global.window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);

            BarcodeScanService.detachHardwareScanner();
            expect(BarcodeScanService.isHardwareScannerAttached()).toBe(false);
            expect(global.window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
        });

        it('should capture rapid hardware laser keystrokes (< 50ms) ending with Enter', () => {
            const mockCb = jest.fn();
            BarcodeScanService.attachHardwareScanner(mockCb);

            const onKeyDown = windowEventListeners['keydown'];
            expect(onKeyDown).toBeDefined();

            // Simulate rapid keystrokes from laser engine: "RM-4520"
            const keys = ['R', 'M', '-', '4', '5', '2', '0'];
            keys.forEach(k => {
                onKeyDown({ key: k, preventDefault: jest.fn(), stopPropagation: jest.fn() });
            });

            // Finish with Enter
            onKeyDown({ key: 'Enter', preventDefault: jest.fn(), stopPropagation: jest.fn() });

            expect(mockCb).toHaveBeenCalledWith('RM-4520', 'ZEBRA_KEYSTROKE_WEDGE');
        });

        it('should reset buffer if inter-key delay exceeds hardware laser threshold', (done) => {
            const mockCb = jest.fn();
            BarcodeScanService.attachHardwareScanner(mockCb);
            const onKeyDown = windowEventListeners['keydown'];

            // Type "AB"
            onKeyDown({ key: 'A', preventDefault: jest.fn(), stopPropagation: jest.fn() });
            onKeyDown({ key: 'B', preventDefault: jest.fn(), stopPropagation: jest.fn() });

            // Wait 70ms (longer than 50ms laser interval) to simulate slow human typing
            setTimeout(() => {
                onKeyDown({ key: 'C', preventDefault: jest.fn(), stopPropagation: jest.fn() });
                onKeyDown({ key: 'Enter', preventDefault: jest.fn(), stopPropagation: jest.fn() });

                // Buffer was reset, only "C" remained which is < 3 characters, so not treated as laser scan
                expect(mockCb).not.toHaveBeenCalled();
                done();
            }, 70);
        });

        it('should receive Zebra DataWedge custom event broadcasts', () => {
            const mockCb = jest.fn();
            BarcodeScanService.attachHardwareScanner(mockCb);

            const onDataWedge = windowEventListeners['datawedge:scan'];
            expect(onDataWedge).toBeDefined();

            onDataWedge({
                detail: {
                    data: '000004000123'
                }
            });

            expect(mockCb).toHaveBeenCalledWith('000004000123', 'ZEBRA_DATAWEDGE_EVENT');
        });
    });

    describe('Camera Barcode Scanning', () => {
        // navigator.mediaDevices is undefined under Jest's node environment, so scanWithCamera takes the fallback path.
        beforeEach(() => {
            dialogs.length = 0;
            inputs.length = 0;
        });

        it('opens the simulation dialog titled after the caller when the camera API is absent', () => {
            BarcodeScanService.scanWithCamera({ title: 'Test Camera Scan' }).catch(() => {});

            expect(dialogs).toHaveLength(1);
            expect(dialogs[0].config.title).toBe('Test Camera Scan (Camera Simulation)');
            expect(dialogs[0].open).toHaveBeenCalledTimes(1);
        });

        it('resolves with the trimmed value when Submit Scan is pressed', async () => {
            const scan = BarcodeScanService.scanWithCamera({});
            inputs[0].setValue('  RM-4520 ');
            dialogs[0].config.beginButton.firePress();

            await expect(scan).resolves.toBe('RM-4520');
        });

        it('rejects when Submit Scan is pressed with an empty value', async () => {
            const scan = BarcodeScanService.scanWithCamera({});
            dialogs[0].config.beginButton.firePress();

            await expect(scan).rejects.toThrow('No barcode entered');
        });

        it('rejects when Cancel is pressed', async () => {
            const scan = BarcodeScanService.scanWithCamera({});
            dialogs[0].config.endButton.firePress();

            await expect(scan).rejects.toThrow('Scan cancelled');
        });
    });
});
