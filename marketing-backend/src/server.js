require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const app = require('./app');
const PORT = process.env.PORT || 5001;
if (process.env.NODE_ENV === 'production') {
  console.error('[MEA] Standalone Marketing server is disabled in production. Deploy the root ScholarshipHive ERP server.');
  process.exit(1);
}
require('./jobs/ad-sync.job').startScheduler();
app.listen(PORT, () => console.log(`[MEA] Local-only legacy test server on port ${PORT}; production uses ScholarshipHive ERP /api/v1.`));
