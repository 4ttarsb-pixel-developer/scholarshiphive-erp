'use strict';

exports.up = async function up(knex) {
  await knex.schema.withSchema('workforce').createTable('erp_user_links', (t) => {
    t.bigInteger('erp_user_id').primary();
    t.integer('workforce_user_id').notNullable().unique()
      .references('id').inTable('workforce.users').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function down(knex) {
  await knex.schema.withSchema('workforce').dropTableIfExists('erp_user_links');
};
