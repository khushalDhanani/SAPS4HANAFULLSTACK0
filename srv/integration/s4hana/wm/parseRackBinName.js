'use strict';

/**
 * Parse only the approved floor-rack-position storage-bin convention.
 * Physical level/bay meaning is intentionally not inferred here.
 */
function parseRackBinName(binName) {
  const value = String(binName || '').trim();
  const match = value.match(/^([A-Z0-9])-([A-Z0-9]{5})-(\d{2})$/i);
  if (!match) {
    return { Floor: '', Rack: '', Position: '', IsRackBin: false };
  }

  return {
    Floor: match[1],
    Rack: match[2],
    Position: match[3],
    IsRackBin: true
  };
}

module.exports = parseRackBinName;
