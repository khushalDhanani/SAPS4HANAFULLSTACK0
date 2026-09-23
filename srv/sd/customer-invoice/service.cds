@(requires: 'authenticated-user')
service CustomerInvoiceService @(path: '/odata/v4/customer-invoice') {

    @readonly
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'FinanceViewer', 'Admin'])
    entity CustomerInvoices {
        key BillingDocument            : String(10);
            BillingDocumentType        : String(4);
            BillingDocumentTypeName    : String(40);
            SoldToParty                : String(10);
            SoldToPartyFullName        : String(80);
            PayerParty                 : String(10);
            PayerPartyName             : String(80);
            SDDocumentCategory         : String(4);
            AccountingTransferStatus   : String(1);
            AccountingDocument         : String(10);
            FiscalYear                 : String(4);
            CompanyCode                : String(4);
            SalesOrganization          : String(4);
            DistributionChannel        : String(2);
            Division                   : String(2);
            TotalNetAmount             : Decimal(15, 2);
            TaxAmount                  : Decimal(15, 2);
            TotalGrossAmount           : Decimal(15, 2);
            TransactionCurrency        : String(5);
            BillingDocumentDate        : Date;
            BillingDocumentIsCancelled : Boolean;
            CancelledBillingDocument   : String(10);
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'FinanceViewer', 'Admin'])
    function getInvoiceMetrics() returns {
        totalInvoices          : Integer;
        pendingAccountingCount : Integer;
        transferredCount       : Integer;
        cancelledCount         : Integer;
    };

    @(requires: ['SalesManager', 'FinanceManager', 'Admin'])
    action releaseInvoiceToAccounting(
        BillingDocument : String
    ) returns {
        BillingDocument          : String;
        AccountingDocument       : String;
        FiscalYear               : String;
        AccountingTransferStatus : String;
        Success                  : Boolean;
        Message                  : String;
    };

    @(requires: ['SalesManager', 'FinanceManager', 'Admin'])
    action cancelBillingDocument(
        BillingDocument : String
    ) returns {
        BillingDocument      : String;
        CancellationDocument : String;
        Success              : Boolean;
        Message              : String;
    };
}
