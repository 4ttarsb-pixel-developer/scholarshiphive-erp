'use strict';

exports.up = async function up(knex) {
  await knex.schema.withSchema('workforce').alterTable('users', (t) => {
    t.boolean('erp_managed_disabled').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.withSchema('workforce').alterTable('users', (t) => {
    t.dropColumn('erp_managed_disabled');
  });
};
