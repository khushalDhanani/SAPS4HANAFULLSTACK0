const { postGoodsReceipt, GR_MOVEMENT_TYPE } = require('./GoodsReceiptODataPoster');
const { _read101Docs, findReceiptForAttempt } = require('./GoodsReceiptDocFinder');
const { postGoodsReceiptWithStorageUnit } = require('./GoodsReceiptBapiPoster');

module.exports = {
  postGoodsReceipt,
  _read101Docs,
  findReceiptForAttempt,
  postGoodsReceiptWithStorageUnit,
  GR_MOVEMENT_TYPE
};
