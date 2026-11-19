// PostgreSQL runtime never loads development mock state.
module.exports = (process.env.PERSISTENCE_DRIVER || 'memory').toLowerCase() === 'postgres'
  ? require('./pg/dashboard.service')
  : require('./dashboard.service.legacy');
