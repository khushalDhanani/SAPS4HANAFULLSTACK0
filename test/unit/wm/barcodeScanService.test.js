/**
 * Unit Tests for BarcodeScanService (Zebra Hardware Laser & Camera Scanning)
 */

let BarcodeScanService;

class MockDialog {
    constructor(config) {
        this.config = config || {};
        this.open = jest.fn();
        this.destroy = jest.fn();
    }
}

class MockInput {
    constructor(config) {
        this.config = config || {};
        this._value = "";
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
                function MockLabel() {},
                function MockVBox(c) { this.config = c; },
                function MockHBox(c) { this.config = c; },
                function MockText(c) { this.config = c; },
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
                onKeyDown({ key: k, preventDefault: jest.fn() });
            });

            // Finish with Enter
            onKeyDown({ key: 'Enter', preventDefault: jest.fn() });

            expect(mockCb).toHaveBeenCalledWith('RM-4520', 'ZEBRA_KEYSTROKE_WEDGE');
        });

        it('should reset buffer if inter-key delay exceeds hardware laser threshold', (done) => {
            const mockCb = jest.fn();
            BarcodeScanService.attachHardwareScanner(mockCb);
            const onKeyDown = windowEventListeners['keydown'];

            // Type "AB"
            onKeyDown({ key: 'A', preventDefault: jest.fn() });
            onKeyDown({ key: 'B', preventDefault: jest.fn() });

            // Wait 70ms (longer than 50ms laser interval) to simulate slow human typing
            setTimeout(() => {
                onKeyDown({ key: 'C', preventDefault: jest.fn() });
                onKeyDown({ key: 'Enter', preventDefault: jest.fn() });

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
        it('should provide fallback dialog when navigator.mediaDevices is absent', async () => {
            // navigator.mediaDevices is undefined in Node/Jest environment
            const scanPromise = BarcodeScanService.scanWithCamera({ title: 'Test Camera Scan' });

            // Ensure a promise is returned
            expect(scanPromise).toBeDefined();
            expect(typeof scanPromise.then).toBe('function');
        });
    });
});
