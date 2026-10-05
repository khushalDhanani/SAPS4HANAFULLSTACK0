/**
 * Unit test for SAPUI5 MessageToast dock position normalization (SAP DINC0487249).
 * Verifies that legacy "center bottom" dock positions are normalized to
 * "CenterBottom" to align with sap.ui.core.Popup.Dock enum and prevent
 * console validation errors.
 */

describe('MessageToast Dock Position Normalization (SAP DINC0487249)', () => {
    let mockMessageToast;

    beforeEach(() => {
        mockMessageToast = {
            _mSettings: {
                duration: 3000,
                width: '15em',
                my: 'center bottom',
                at: 'center bottom'
            },
            show: jest.fn(function (sMessage, mOptions) {
                return { sMessage, mOptions };
            })
        };
    });

    function applyNormalization(MessageToast) {
        if (MessageToast && typeof MessageToast.show === 'function' && !MessageToast._dockPatched) {
            MessageToast._dockPatched = true;
            if (MessageToast._mSettings) {
                if (MessageToast._mSettings.my === 'center bottom') {
                    MessageToast._mSettings.my = 'CenterBottom';
                }
                if (MessageToast._mSettings.at === 'center bottom') {
                    MessageToast._mSettings.at = 'CenterBottom';
                }
            }
            const fnOrigShow = MessageToast.show;
            MessageToast.show = function (sMessage, mOptions) {
                if (mOptions) {
                    if (mOptions.my === 'center bottom') {
                        mOptions.my = 'CenterBottom';
                    }
                    if (mOptions.at === 'center bottom') {
                        mOptions.at = 'CenterBottom';
                    }
                }
                return fnOrigShow.apply(this, arguments);
            };
        }
    }

    test('should normalize _mSettings default dock values from lowercase to PascalCase', () => {
        expect(mockMessageToast._mSettings.my).toBe('center bottom');
        expect(mockMessageToast._mSettings.at).toBe('center bottom');

        applyNormalization(mockMessageToast);

        expect(mockMessageToast._mSettings.my).toBe('CenterBottom');
        expect(mockMessageToast._mSettings.at).toBe('CenterBottom');
    });

    test('should normalize explicit options passed to MessageToast.show', () => {
        applyNormalization(mockMessageToast);

        const options = {
            duration: 2000,
            my: 'center bottom',
            at: 'center bottom'
        };

        mockMessageToast.show('Hello World', options);

        expect(options.my).toBe('CenterBottom');
        expect(options.at).toBe('CenterBottom');
    });

    test('should leave custom non-center-bottom dock positions intact', () => {
        applyNormalization(mockMessageToast);

        const options = {
            my: 'BeginTop',
            at: 'BeginTop'
        };

        mockMessageToast.show('Top Message', options);

        expect(options.my).toBe('BeginTop');
        expect(options.at).toBe('BeginTop');
    });

    test('should be idempotent and not re-wrap on repeated initialization', () => {
        applyNormalization(mockMessageToast);
        const wrappedShow = mockMessageToast.show;

        applyNormalization(mockMessageToast);
        expect(mockMessageToast.show).toBe(wrappedShow);
    });
});
