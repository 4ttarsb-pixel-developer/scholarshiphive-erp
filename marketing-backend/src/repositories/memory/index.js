// Memory driver: repository facade backed by the in-process mock store arrays.
// Returns the SAME live arrays/objects the services used before, so behavior is
// byte-for-byte identical to the original in-memory implementation.
const store = require('../../data/mock.store');

const clone = (v) => v; // identity — callers mutate live objects as before

module.exports = {
  driver: 'memory',
  async hydrate() { /* nothing to load; store is already populated at require time */ },

  users: {
    async list() { return store.users; },
    async findById(id) { return store.users.find((u) => u.id === id) || null; },
    async insert(row) { store.users.push(row); return row; },
    async setStatus(id, status) {
      const u = store.users.find((x) => x.id === id);
      if (u) u.status = status;
      return u || null;
    },
  },

  categories: {
    async list() { return store.categories; },
    async insert(category) { store.categories.push(category); return category; },
    async rename(id, name) {
      const c = store.categories.find((x) => x.id === id);
      if (c) c.name = name;
      return c || null;
    },
    async remove(id) {
      const c = store.categories.find((x) => x.id === id);
      if (c) store.categories.splice(store.categories.indexOf(c), 1);
    },
    async addSubcategory(categoryId, sub) {
      const c = store.categories.find((x) => x.id === categoryId);
      if (c) c.subcategories.push(sub);
      return sub;
    },
    async removeSubcategory(categoryId, subId) {
      const c = store.categories.find((x) => x.id === categoryId);
      if (!c) return;
      const sub = c.subcategories.find((s) => s.id === subId);
      if (sub) c.subcategories.splice(c.subcategories.indexOf(sub), 1);
    },
  },

  budgets: {
    async list() { return store.budgets; },
    async findById(id) { return store.budgets.find((b) => b.id === id) || null; },
    async insert(row) { store.budgets.push(row); return row; },
    async setLimit(id, limit) {
      const b = store.budgets.find((x) => x.id === id);
      if (b) b.limit = limit;
      return b || null;
    },
  },

  allocations: {
    async list() { return store.employeeBudgets; },
    async findById(id) { return store.employeeBudgets.find((a) => a.id === id) || null; },
    async insert(row) { store.employeeBudgets.push(row); return row; },
    async setLimit(id, limit) {
      const a = store.employeeBudgets.find((x) => x.id === id);
      if (a) a.limit = limit;
      return a || null;
    },
  },

  expenses: {
    async list() { return store.expenses; },
    async findById(id) { return store.expenses.find((e) => e.id === id) || null; },
    async insert(row) { store.expenses.push(row); return row; },
    async patch(id, fields) {
      const e = store.expenses.find((x) => x.id === id);
      if (e) Object.assign(e, fields);
      return e || null;
    },
    async remove(id) {
      const e = store.expenses.find((x) => x.id === id);
      if (e) store.expenses.splice(store.expenses.indexOf(e), 1);
    },
  },

  audit: {
    async list(expenseId) {
      return store.auditEvents.filter((e) => !expenseId || e.expenseId === expenseId);
    },
    async insert(event, { prepend = true } = {}) {
      if (prepend) store.auditEvents.unshift(event);
      else store.auditEvents.push(event);
      return event;
    },
  },

  _clone: clone,
};
