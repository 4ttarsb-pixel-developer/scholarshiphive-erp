'use strict';
const knex = require('../db');
const svc = require('../services/employee.service');
const { ctx, run, idParam } = require('./helpers');

const list = async (req, res) => res.json(await svc.list({
  search: req.query.search, status: req.query.status, department: req.query.department, includeInactive: req.query.includeInactive === 'true',
}));
const get = async (req, res) => res.json(await svc.get(idParam(req.params.id)));
const create = async (req, res) => { const c = ctx(req); await run(res, c, () => svc.create(req.body || {}, req.user, c), 201); };
const update = async (req, res) => { const c = ctx(req); await run(res, c, () => svc.update(idParam(req.params.id), req.body || {}, req.user, c)); };
const unmapped = async (_req, res) => res.json(await svc.unmappedUsers());
const linkUser = async (req, res) => { const c = ctx(req); await run(res, c, () => svc.linkUser(idParam(req.params.id), req.body || {}, req.user, c)); };
const createLogin = async (req, res) => { const c = ctx(req); await run(res, c, () => svc.createLogin(idParam(req.params.id), req.body || {}, req.user, c), 201); };
const departments = async (_req, res) => res.json(await knex('departments').orderBy('name'));
module.exports = { list, get, create, update, unmapped, linkUser, createLogin, departments };
