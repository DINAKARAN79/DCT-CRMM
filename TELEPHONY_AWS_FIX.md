# Telephony permission repair

The application stores `TELEPHONY_CALL` as a row in `public."Permission"` (`"name"`), not as a PostgreSQL enum. Profile grants are rows in `public."UserProfilePermission"` (`"profileId"`, `"permissionId"`). This repair is additive and idempotent; it does not run or repair the broader Prisma migration baseline.

## AWS steps

1. **[BACKUP REQUIRED]** Take an RDS snapshot and wait until it is available before proceeding.
2. **[SAFE / READ-ONLY]** Configure `DATABASE_URL` in the secure shell environment to use the RDS instance's direct database endpoint, then connect with `psql`. Do not use RDS Proxy or PgBouncer. Keep credentials in the configured environment, not in command history.
3. **[SAFE / READ-ONLY]** Run `npm run postdeploy:check-telephony` and save its output securely. It invokes `psql` with `scripts/check-telephony-permission.sql`, reporting table/permission presence, profile grants, enum labels, and tenants without settings; it does not select credentials or URLs.
4. **[CHANGES DATA]** Run `npm run db:repair-telephony`. This invokes `psql` with `scripts/repair-telephony-permission.sql` (not Prisma migrations). The transaction adds missing telephony, API-key, session, and dialpad schema; inserts the permission and missing default-profile grants; and inserts only missing inactive tenant settings. It does not update saved URLs or keys and never deletes data.
5. **[SAFE / READ-ONLY]** Run `npm run postdeploy:check-telephony` again and save the output. It exits with an error and a repair instruction if `TELEPHONY_CALL` is still missing.
6. **[OPERATIONAL CHANGE]** Restart the API to clear process-local permission state and cached client configuration.
7. **[CHANGES DATA]** Hard-refresh the CRM, open **Setup > Integrations > Telephony > Agents**, and click **Grant** for the required agents or **Grant telephony to these profiles**.
8. **[SAFE / READ-ONLY]** Open a lead and verify its phone number is clickable for a granted user when company telephony is active and its key is configured.

The Grant API never creates database schema. If it reports that the permission definition is unavailable, follow the SQL repair steps above and then retry.

## Deploy check

After deployments, run `npm run postdeploy:check-telephony` with `DATABASE_URL` set to the target database. The command runs the read-only check and fails with a direct repair instruction if the permission row is missing. Do not substitute `prisma migrate deploy` or `prisma migrate reset` for this repair.
