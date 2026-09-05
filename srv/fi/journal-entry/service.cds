using { FAC_GLV_GL_ACCOUNT_LINE_ITEMS_SRV as external } from '../../external/FAC_GLV_GL_ACCOUNT_LINE_ITEMS_SRV';

@(requires: 'authenticated-user')
service JournalEntryService @(path: '/odata/v4/journal-entry') {
    @readonly
    @(requires: ['Viewer', 'FinanceViewer', 'Admin'])
    entity JournalEntryItems as projection on external.C_JournalEntryItemBrowserResults {
        key ID,
        CompanyCode,
        CompanyCodeName,
        FiscalYear,
        AccountingDocument,
        LedgerGLLineItem,
        AccountingDocumentItem,
        GLAccount,
        GLAccountName,
        GLAccountLongName,
        PostingDate,
        DocumentDate,
        AccountingDocumentType,
        DebitCreditCode,
        AmountInTransactionCurrency,
        TransactionCurrency,
        AmountInCompanyCodeCurrency,
        CompanyCodeCurrency,
        CostCenter,
        ProfitCenter,
        AccountingDocCreatedByUser as CreatedByUser
    };
}
