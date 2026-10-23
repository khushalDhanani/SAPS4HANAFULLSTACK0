'use strict';

const parseRackBinName = require('../../../srv/integration/s4hana/wm/parseRackBinName');

describe('parseRackBinName', () => {
  test('parses the approved floor-rack-position pattern without assigning physical meaning', () => {
    expect(parseRackBinName('1-L0001-04')).toEqual({
      Floor: '1', Rack: 'L0001', Position: '04', IsRackBin: true
    });
  });

  test.each(['', 'WE-ZONE', '0001002750', '1-L0001-4', '12-L0001-04', '1-L001-04'])('%s is not a rack bin', (binName) => {
    expect(parseRackBinName(binName)).toEqual({
      Floor: '', Rack: '', Position: '', IsRackBin: false
    });
  });
});
