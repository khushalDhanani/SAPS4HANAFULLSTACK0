const BaseGoodsIssueClient = require('./BaseGoodsIssueClient');
const GoodsIssueReservationsClient = require('./GoodsIssueReservationsClient');
const GoodsIssueBatchesClient = require('./GoodsIssueBatchesClient');
const GoodsIssueStockUnitClient = require('./GoodsIssueStockUnitClient');
const GoodsIssuePostingClient = require('./GoodsIssuePostingClient');
const GoodsIssueDashboardClient = require('./GoodsIssueDashboardClient');
const GoodsIssueMapper = require('./GoodsIssueMapper');
const GoodsIssue261Mapper = require('./GoodsIssue261Mapper');

module.exports = {
  BaseGoodsIssueClient,
  GoodsIssueReservationsClient,
  GoodsIssueBatchesClient,
  GoodsIssueStockUnitClient,
  GoodsIssuePostingClient,
  GoodsIssueDashboardClient,
  GoodsIssueMapper,
  GoodsIssue261Mapper
};
