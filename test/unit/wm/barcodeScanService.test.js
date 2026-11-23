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

    describe('Multiple consumers', () => {
        const scan = (text) => {
            const onKeyDown = windowEventListeners['keydown'];
            [...text, 'Enter'].forEach((key) => onKeyDown({ key, preventDefault: jest.fn(), stopPropagation: jest.fn() }));
        };

        it('a later consumer does not destroy the callback of an earlier one', () => {
            const first = jest.fn();
            const second = jest.fn();
            BarcodeScanService.attachHardwareScanner(first);
            BarcodeScanService.attachHardwareScanner(second);

            scan('SU-001');
            expect(second).toHaveBeenCalledWith('SU-001', 'ZEBRA_KEYSTROKE_WEDGE');
            expect(first).not.toHaveBeenCalled();

            BarcodeScanService.detachHardwareScanner(second);
            scan('SU-002');
            expect(first).toHaveBeenCalledWith('SU-002', 'ZEBRA_KEYSTROKE_WEDGE');
            expect(second).toHaveBeenCalledTimes(1);
        });

        it('an earlier consumer that detaches does not switch off the later one', () => {
            const first = jest.fn();
            const second = jest.fn();
            BarcodeScanService.attachHardwareScanner(first);
            BarcodeScanService.attachHardwareScanner(second);

            BarcodeScanService.detachHardwareScanner(first);

            expect(BarcodeScanService.isHardwareScannerAttached()).toBe(true);
            expect(global.window.removeEventListener).not.toHaveBeenCalled();
            scan('SU-003');
            expect(second).toHaveBeenCalledWith('SU-003', 'ZEBRA_KEYSTROKE_WEDGE');
        });

        it('each scan reaches exactly one consumer, also for DataWedge events', () => {
            const first = jest.fn();
            const second = jest.fn();
            BarcodeScanService.attachHardwareScanner(first);
            BarcodeScanService.attachHardwareScanner(second);

            windowEventListeners['datawedge:scan']({ detail: { data: '000004000123' } });

            expect(first).not.toHaveBeenCalled();
            expect(second).toHaveBeenCalledTimes(1);
        });

        it('attaching the same function twice registers it once and makes it the active consumer', () => {
            const first = jest.fn();
            const second = jest.fn();
            BarcodeScanService.attachHardwareScanner(first);
            BarcodeScanService.attachHardwareScanner(second);
            BarcodeScanService.attachHardwareScanner(first);

            scan('SU-004');
            expect(first).toHaveBeenCalledTimes(1);
            expect(second).not.toHaveBeenCalled();

            BarcodeScanService.detachHardwareScanner(first);
            scan('SU-005');
            expect(first).toHaveBeenCalledTimes(1);
            expect(second).toHaveBeenCalledTimes(1);
        });

        it('detaching a function that was never attached changes nothing', () => {
            const first = jest.fn();
            BarcodeScanService.attachHardwareScanner(first);

            BarcodeScanService.detachHardwareScanner(jest.fn());

            scan('SU-006');
            expect(first).toHaveBeenCalledTimes(1);
        });

        it('ignores an attach without a function', () => {
            BarcodeScanService.attachHardwareScanner(undefined);

            expect(BarcodeScanService.isHardwareScannerAttached()).toBe(false);
            expect(global.window.addEventListener).not.toHaveBeenCalled();
        });
    });

    describe('Lifecycle of the global listeners', () => {
        it('registers the listeners once however many consumers attach, and removes them with the last one', () => {
            const first = jest.fn();
            const second = jest.fn();
            BarcodeScanService.attachHardwareScanner(first);
            BarcodeScanService.attachHardwareScanner(second);

            expect(global.window.addEventListener.mock.calls.filter(([evt]) => evt === 'keydown')).toHaveLength(1);

            BarcodeScanService.detachHardwareScanner(first);
            expect(global.window.removeEventListener).not.toHaveBeenCalled();

            BarcodeScanService.detachHardwareScanner(second);
            expect(global.window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
            expect(global.window.removeEventListener).toHaveBeenCalledWith('datawedge:scan', expect.any(Function));
            expect(global.document.removeEventListener).toHaveBeenCalledWith('barcodeScan', expect.any(Function));
            expect(BarcodeScanService.isHardwareScannerAttached()).toBe(false);
        });

        it('listens again after a full detach and a new attach', () => {
            BarcodeScanService.attachHardwareScanner(jest.fn());
            BarcodeScanService.detachHardwareScanner();
            const again = jest.fn();

            BarcodeScanService.attachHardwareScanner(again);

            expect(global.window.addEventListener.mock.calls.filter(([evt]) => evt === 'keydown')).toHaveLength(2);
            windowEventListeners['datawedge:scan']({ detail: { barcode: 'X-1' } });
            expect(again).toHaveBeenCalledWith('X-1', 'ZEBRA_DATAWEDGE_EVENT');
        });

        it('does not carry half a scan from one consumer over to the next', () => {
            const first = jest.fn();
            const second = jest.fn();
            const onKey = (key) => windowEventListeners['keydown']({ key, preventDefault: jest.fn(), stopPropagation: jest.fn() });
            BarcodeScanService.attachHardwareScanner(first);
            ['A', 'B', 'C', 'D'].forEach(onKey);

            BarcodeScanService.attachHardwareScanner(second);
            onKey('Enter');

            expect(first).not.toHaveBeenCalled();
            expect(second).not.toHaveBeenCalled();
        });

        it('keeps working when a consumer callback throws', () => {
            const error = jest.spyOn(console, 'error').mockImplementation(() => {});
            const failing = jest.fn(() => { throw new Error('consumer bug'); });
            BarcodeScanService.attachHardwareScanner(failing);
            const onKey = (key) => windowEventListeners['keydown']({ key, preventDefault: jest.fn(), stopPropagation: jest.fn() });

            expect(() => ['A', 'B', 'C', 'Enter'].forEach(onKey)).not.toThrow();
            ['D', 'E', 'F', 'Enter'].forEach(onKey);

            expect(failing).toHaveBeenCalledTimes(2);
            error.mockRestore();
        });
    });

    describe('Scanner input versus ordinary keyboard input', () => {
        let now;
        let cb;
        const key = (k, gapMs, extra = {}) => {
            now += gapMs;
            const evt = { key: k, preventDefault: jest.fn(), stopPropagation: jest.fn(), ...extra };
            windowEventListeners['keydown'](evt);
            return evt;
        };

        beforeEach(() => {
            now = 1000000;
            jest.spyOn(Date, 'now').mockImplementation(() => now);
            cb = jest.fn();
            BarcodeScanService.attachHardwareScanner(cb);
        });
        afterEach(() => Date.now.mockRestore());

        it('treats keys at scanner speed ending with Enter as a scan', () => {
            [...'180000003'].forEach((k) => key(k, 10));
            key('Enter', 10);

            expect(cb).toHaveBeenCalledWith('180000003', 'ZEBRA_KEYSTROKE_WEDGE');
        });

        it('does not treat a person typing and pressing Enter as a scan', () => {
            [...'180000003'].forEach((k) => key(k, 180));
            key('Enter', 180);

            expect(cb).not.toHaveBeenCalled();
        });

        it('does not treat fast keys followed by a late Enter as a scan', () => {
            [...'ABCDEF'].forEach((k) => key(k, 10));
            key('Enter', 400);

            expect(cb).not.toHaveBeenCalled();
        });

        it('does not treat one or two fast keys and Enter as a scan', () => {
            key('O', 10);
            key('K', 10);
            key('Enter', 10);

            expect(cb).not.toHaveBeenCalled();
        });

        it('a key typed some time before a scan does not become part of the barcode', () => {
            key('x', 300);
            key('S', 300);
            [...'U-42'].forEach((k) => key(k, 10));
            key('Enter', 10);

            expect(cb).toHaveBeenCalledTimes(1);
            expect(cb).toHaveBeenCalledWith('SU-42', 'ZEBRA_KEYSTROKE_WEDGE');
        });

        it('ignores navigation and modifier keys inside a scan', () => {
            key('A', 10);
            key('Shift', 5);
            key('B', 5);
            key('ArrowLeft', 5);
            key('C', 5);
            key('Enter', 5);

            expect(cb).toHaveBeenCalledWith('ABC', 'ZEBRA_KEYSTROKE_WEDGE');
        });

        it('an ordinary Enter is left alone: not consumed and no callback', () => {
            const evt = key('Enter', 500);

            expect(evt.preventDefault).not.toHaveBeenCalled();
            expect(evt.stopPropagation).not.toHaveBeenCalled();
            expect(cb).not.toHaveBeenCalled();
        });

        it('consumes the Enter of a scan when focus is not in an input, so it cannot press a focused control', () => {
            global.document.activeElement = { tagName: 'LI' };
            [...'SU-77'].forEach((k) => key(k, 10));
            const enter = key('Enter', 10);

            expect(enter.preventDefault).toHaveBeenCalled();
            expect(enter.stopPropagation).toHaveBeenCalled();
            expect(cb).toHaveBeenCalledTimes(1);
        });

        it('leaves the Enter of a scan to a focused input (known: that input then also submits)', () => {
            global.document.activeElement = { tagName: 'INPUT' };
            [...'SU-78'].forEach((k) => key(k, 10));
            const enter = key('Enter', 10);

            expect(enter.preventDefault).not.toHaveBeenCalled();
            expect(cb).toHaveBeenCalledWith('SU-78', 'ZEBRA_KEYSTROKE_WEDGE');
        });

        it('does nothing at all once the consumer has detached', () => {
            BarcodeScanService.detachHardwareScanner(cb);
            const listener = windowEventListeners['keydown'];

            expect(listener).toBeUndefined();
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
