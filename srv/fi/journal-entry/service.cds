using { FAC_GL_JOURNALENTRY_VER_SRV as external } from '../../external/FAC_GL_JOURNALENTRY_VER_SRV';

@(requires: 'authenticated-user')
service JournalEntryService @(path: '/odata/v4/journal-entry') {
    @readonly
    @(requires: ['Viewer', 'FinanceViewer', 'Admin'])
    entity JournalEntryItems as projection on external.C_GLJrnlEntryItemToBeVerified {
        key AccountingDocument,
        key AccountingDocumentItem,
        key SourceCompanyCode,
        key FiscalYear,
        CompanyCode,
        GLAccount,
        GLAccountName,
        DocumentItemText,
        DebitCreditCode,
        DebitCreditCodeName,
        AmountInTransactionCurrency,
        TransactionCurrency,
        AmountInCompanyCodeCurrency,
        CompanyCodeCurrency,
        ProfitCenter,
        CostCenter
    };
}
