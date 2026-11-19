'use strict';
// All Workforce controllers, services, and the ERP SSO bridge share one
// PostgreSQL pool. The pool defaults to the isolated `workforce` schema and
// falls back to `public` only for the ERP users table / explicit cross-schema SQL.
module.exports = require('../db');
