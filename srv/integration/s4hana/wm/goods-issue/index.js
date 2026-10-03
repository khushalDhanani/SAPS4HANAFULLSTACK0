const BaseGoodsIssueClient = require('./BaseGoodsIssueClient');
const GoodsIssueReservationsClient = require('./GoodsIssueReservationsClient');
const GoodsIssueBatchesClient = require('./GoodsIssueBatchesClient');
const GoodsIssueStockUnitClient = require('./GoodsIssueStockUnitClient');
const GoodsIssuePostingClient = require('./GoodsIssuePostingClient');
const GoodsIssueDashboardClient = require('./GoodsIssueDashboardClient');
const GoodsIssuePhase6StagingClient = require('./GoodsIssuePhase6StagingClient');
const GoodsIssueMapper = require('./GoodsIssueMapper');

module.exports = {
  BaseGoodsIssueClient,
  GoodsIssueReservationsClient,
  GoodsIssueBatchesClient,
  GoodsIssueStockUnitClient,
  GoodsIssuePostingClient,
  GoodsIssueDashboardClient,
  GoodsIssuePhase6StagingClient,
  GoodsIssueMapper
};
