# BusinessConfig HU Storage Type Migration Notes

**Status:** The missing-table bootstrap was applied to the authorized local
SQLite database on 2026-10-26 at 12:50 IST after backup. The existing-table
column migration below was not run. No HANA/HDI deployment was performed.
No pickable, hold, or interim storage-type values are included.

## Command

### Missing BusinessConfig table

If the local application reports `no such table: saps4hana_wm_BusinessConfig`,
the column migration below does not apply. The complete table and its projection
must first exist. `db-bootstrap-20261026-business-config.sql` creates only those
two objects, using the current CDS-generated SQLite DDL. It inserts no rows and
does not choose pickable/hold/interim storage types.

After explicit approval for the active local database write, back up and apply:

```sh
sqlite3 db.sqlite ".backup 'db.sqlite.pre-business-config-bootstrap'"
sqlite3 -bail db.sqlite < db-bootstrap-20261026-business-config.sql
sqlite3 db.sqlite "PRAGMA integrity_check;"
```

Use this bootstrap only when both the table and projection are absent. It fails
if either already exists; `-bail` stops on the first SQL error and the transaction
rolls back. Do not run the column migration afterward: the bootstrap already
includes the HU policy columns. No full `cds deploy` or seed import is needed.
Restore the backup only after stopping the local server if rollback is needed.
This is not a HANA/HDI migration.

### Existing BusinessConfig table

For a local SQLite database, first create a backup, then run:

```sh
sqlite3 db.sqlite ".backup 'db.sqlite.pre-hu-storage-types'"
sqlite3 db.sqlite < db-migrate-20261026-business-config-hu-storage-types.sql
```

The SQL file is for the repository's local SQLite database. It is not a HANA
or HDI deployment command.

## Effect

The migration adds `PickableStorageTypes`, `HoldStorageTypes`, and
`InterimStorageTypes` as empty columns, adds the oversize-HU behavior column
with the schema default `BLOCK`, and recreates the generated
`BusinessConfigService_BusinessConfigs` projection view so it exposes the new
columns.

Oversize-HU setting: “default BLOCK, pending the user's confirmation”.

## Rollback

Restore the pre-migration backup:

```sh
cp db.sqlite.pre-hu-storage-types db.sqlite
```

This rollback restores the complete local database snapshot. Do not use this
SQLite procedure for HANA/HDI. No HANA rollback procedure is specified here;
that deployment path remains unverified.
