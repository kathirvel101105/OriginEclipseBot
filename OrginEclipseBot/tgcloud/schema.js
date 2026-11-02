import { table, integer, text } from 'sdk/db';

export const rules = table('rules', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  criteria: text('criteria').notNull(),
  rule:     text('rule').notNull(),
});

export const settings = table('settings', {
  key:   text('key').primaryKey(),
  value: text('value'),
});

export const admins = table('admins', {
  userId: integer('user_id').primaryKey(),
});

export const topics = table('topics', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  groupId:  integer('group_id'), // Links this topic to a specific group
  name:     text('name').notNull(),
  threadId: integer('thread_id').notNull().unique(), // 0 = General / main chat
});

export const users = table('users', {
  id:        integer('id').primaryKey(),
  firstName: text('first_name'),
});

export const groups = table('groups', {
  id:    integer('id').primaryKey(),
  title: text('title'),
});