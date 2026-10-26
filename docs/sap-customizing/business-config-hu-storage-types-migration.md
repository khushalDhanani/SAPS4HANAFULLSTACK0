# BusinessConfig HU Storage Type Migration Notes

**Status: prepared only.** This migration has not been run or deployed. No
pickable, hold, or interim storage-type values are included.

## Command

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
