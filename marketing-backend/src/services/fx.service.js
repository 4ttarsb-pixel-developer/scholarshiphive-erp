// PostgreSQL runtime never loads development mock state.
module.exports = (process.env.PERSISTENCE_DRIVER || 'memory').toLowerCase() === 'postgres'
  ? require('./pg/fx.service')
  : require('./fx.service.legacy');
