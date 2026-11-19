# Marketing backend (embedded ScholarshipHive module)

This code is part of the unified ScholarshipHive ERP. For production, do not start this package independently. The root Node.js application mounts `src/router.js` at `/api/v1` after ERP session and CSRF middleware. `src/server.js` intentionally refuses production standalone startup.

All runtime and migrations use the **root** `DATABASE_URL`, with Marketing tables in the `marketing` schema of the same database as ERP and Workforce. Configure the project-root `.env`, then from project root run:

```bash
npm run migrate
npm run build
npm start
```

The standalone app and memory driver remain only for isolated test/development compatibility; do not use memory persistence or standalone demo accounts for production. No Marketing-specific credentials, second DB URL, or separate login should be configured.
