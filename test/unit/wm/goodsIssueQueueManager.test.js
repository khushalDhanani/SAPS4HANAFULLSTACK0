const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  GoodsIssueQueueManager
} = require('../../../srv/wm/goods-issue/GoodsIssueQueueManager');

function makeTempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `giq-manager-${label}-`));
}

describe('GoodsIssueQueueManager', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = makeTempDir('root');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_) {
      // Ignore
    }
  });

  describe('storage location', () => {
    it('resolves the default store OUTSIDE the project tree so cds watch never restarts on enqueue', () => {
      const storage = GoodsIssueQueueManager.resolveStorageFile();
      expect(path.isAbsolute(storage)).toBe(true);
      expect(storage.includes(`${path.sep}data${path.sep}goods-issue-queue.json`)).toBe(false);
      expect(path.dirname(storage).startsWith(process.cwd())).toBe(false);
      expect(path.basename(storage)).toBe('goods-issue-queue.json');
      expect(path.basename(path.dirname(storage))).toBe('.saps4hana');
    });

    it('honors the GI_QUEUE_STORAGE_FILE environment override', () => {
      const override = path.join(tempRoot, 'override', 'queue.json');
      process.env.GI_QUEUE_STORAGE_FILE = override;
      try {
        const storage = GoodsIssueQueueManager.resolveStorageFile();
        expect(storage).toBe(override);
        const manager = new GoodsIssueQueueManager();
        expect(manager.storageFile).toBe(override);
      } finally {
        delete process.env.GI_QUEUE_STORAGE_FILE;
      }
    });

    it('accepts an explicit storageFile (isolated instances for tests)', () => {
      const storage = path.join(tempRoot, 'isolated', 'queue.json');
      const manager = new GoodsIssueQueueManager({ storageFile: storage });
      expect(manager.storageFile).toBe(storage);
      expect(fs.existsSync(storage)).toBe(true);
    });
  });

  describe('queue operations', () => {
    it('enqueues, persists across instances, updates, removes and summarizes', () => {
      const storage = path.join(tempRoot, 'queue.json');
      const managerA = new GoodsIssueQueueManager({ storageFile: storage });

      for (let i = 1; i <= 3; i++) {
        const record = managerA.enqueue({
          ReservationNo: `RTS${i}`,
          ReservationItem: `${i}`,
          Material: '4000000125',
          IssueQty: 10,
          Unit: 'KG',
          FinalIssue: true
        });
        expect(record.QueueReference).toMatch(new RegExp(`^GI-QUEUE-RTS${i}-000${i}-\\d{4}$`));
        expect(record.SyncStatus).toBe('QUEUED');
        expect(record.SyncAttempts).toBe(1);
      }

      const summary = managerA.getSummary();
      expect(summary.QueuedCount).toBe(3);
      expect(summary.TotalCount).toBe(3);

      const managerB = new GoodsIssueQueueManager({ storageFile: storage });
      expect(managerB.getAll()).toHaveLength(3);

      const updated = managerB.update(managerB.getAll()[0].QueueReference, {
        SyncStatus: 'POSTED_IN_SAP',
        SapMaterialDocument: '5000000012',
        SapMaterialDocYear: '2026'
      });
      expect(updated.SyncStatus).toBe('POSTED_IN_SAP');
      expect(updated.SapMaterialDocument).toBe('5000000012');
      expect(managerB.getSummary().QueuedCount).toBe(2);

      const reference = managerB.getAll()[0].QueueReference;
      expect(managerB.remove(reference)).toBe(true);
      expect(managerB.remove(reference)).toBe(false);
      expect(managerB.getAll()).toHaveLength(2);
    });

    it('updates and removes are persisted via atomic file replacement', () => {
      const storage = path.join(tempRoot, 'atomic.json');
      const manager = new GoodsIssueQueueManager({ storageFile: storage });

      const record = manager.enqueue({ ReservationNo: 'RTA1', ReservationItem: '1', IssueQty: 5, Unit: 'KG' });
      const leftover = fs.readdirSync(path.dirname(storage)).filter(f => f.includes('.tmp'));
      expect(leftover).toHaveLength(0);

      manager.update(record.QueueReference, { SyncStatus: 'FAILED', LastSyncError: 'sap unreachable' });
      const reloaded = new GoodsIssueQueueManager({ storageFile: storage });
      expect(reloaded.get(record.QueueReference).LastSyncError).toBe('sap unreachable');
    });

    it('clear() empties the store', () => {
      const storage = path.join(tempRoot, 'clear.json');
      const manager = new GoodsIssueQueueManager({ storageFile: storage });
      manager.enqueue({ ReservationNo: 'RTC1', ReservationItem: '1', IssueQty: 1, Unit: 'KG' });
      manager.clear();
      expect(manager.getSummary().TotalCount).toBe(0);
    });
  });

  describe('legacy store migration', () => {
    it('merges legacy ./data records once, idempotently, and leaves the legacy file untouched', () => {
      const legacyRoot = path.join(tempRoot, 'project');
      const legacyDir = path.join(legacyRoot, 'data');
      fs.mkdirSync(legacyDir, { recursive: true });
      const legacyFile = path.join(legacyDir, 'goods-issue-queue.json');
      const legacy = [
        { ID: '00000000-0000-0000-0000-000000000001', QueueReference: 'GI-QUEUE-LEG-0001-1111', ReservationNo: 'LEG', ReservationItem: '0001', SyncStatus: 'QUEUED', IssueQty: 3, Unit: 'KG' },
        { ID: '00000000-0000-0000-0000-000000000002', QueueReference: 'GI-QUEUE-LEG-0002-2222', ReservationNo: 'LEG', ReservationItem: '0002', SyncStatus: 'QUEUED', IssueQty: 7, Unit: 'KG' }
      ];
      fs.writeFileSync(legacyFile, JSON.stringify(legacy, null, 2), 'utf8');

      const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(legacyRoot);
      const storage = path.join(tempRoot, 'target', 'queue.json');
      process.env.GI_QUEUE_STORAGE_FILE = storage;
      try {
        const managerA = new GoodsIssueQueueManager();

        expect(managerA.getAll().map(i => i.QueueReference)).toEqual(
          expect.arrayContaining(['GI-QUEUE-LEG-0001-1111', 'GI-QUEUE-LEG-0002-2222'])
        );

        const managerB = new GoodsIssueQueueManager();
        expect(managerB.getAll()).toHaveLength(2);
      } finally {
        delete process.env.GI_QUEUE_STORAGE_FILE;
        cwdSpy.mockRestore();
      }
    });

    it('skips migration when there are no legacy records', () => {
      const legacyRoot = path.join(tempRoot, 'project-empty');
      const legacyFile = path.join(legacyRoot, 'data', 'goods-issue-queue.json');
      fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
      fs.writeFileSync(legacyFile, JSON.stringify([], null, 2), 'utf8');

      const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(legacyRoot);
      const storage = path.join(tempRoot, 'target-empty', 'queue.json');
      process.env.GI_QUEUE_STORAGE_FILE = storage;
      try {
        const manager = new GoodsIssueQueueManager();
        expect(manager.getAll()).toHaveLength(0);
      } finally {
        delete process.env.GI_QUEUE_STORAGE_FILE;
        cwdSpy.mockRestore();
      }
    });
  });
});