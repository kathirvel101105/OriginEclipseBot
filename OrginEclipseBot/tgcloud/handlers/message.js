import { db, api } from 'sdk';
import { eq, asc } from 'sdk/db';
import { rules, settings, admins, topics, users, groups } from '../schema.js';
import { renderRules } from '../lib/table.js';

// Configure Telegram owner IDs here. Owners can manage admins.
const OWNER_IDS = [6856118779];

const DEFAULT_WELCOME =
  '👋 Welcome, <b>{name}</b>!\n\n' +
  'This is the official bot of our tournament. Rules, schedules, and announcements ' +
  'are posted in the tournament group. Join using the button below and watch your topic.';

const DEFAULTS = [
  ['Team Type', 'Ghost-type Pokémon only'],
  ['Team Size', '6 Pokémon'],
  ['Battle Format', 'Singles'],
  ['Match Format', 'BO3 for semifinals, BO5 for final'],
  ['Team Changes', 'No switching Pokémon between games in a series'],
  ['Legendary Pokémon', 'Restricted or limited'],
  ['Disconnection', 'Rematch only if both players agree or an admin verifies'],
  ['Cheating', 'Immediate disqualification'],
  ['Tie', 'One decisive rematch'],
];

const HELP =
  '<b>Admin Panel — commands</b>\n\n' +
  '<b>Groups</b>\n' +
  '/registergroup — register this group and make it active\n' +
  '/setgroup — legacy alias for /registergroup\n' +
  '/groups — list registered groups\n' +
  '/switchgroup ID — change active group\n\n' +
  '<b>Topics (run inside the target group/topic)</b>\n' +
  '/settopic Name — register/update this topic\n' +
  '/topics — list topics in the active group\n' +
  '/deltopic N — remove topic #N from the active group\n' +
  'In a group: /rules or /rules pin — post rules in this topic\n\n' +
  '<b>Rules</b>\n' +
  '/rules — preview rules\n' +
  '/addrule Criteria | Rule — add a rule\n' +
  '/editrule N Criteria | Rule — edit rule #N\n' +
  '/delrule N — delete rule #N\n' +
  '/defaults — replace rules with tournament defaults\n' +
  '/settitle Title — set title; /settitle reset — restore default\n' +
  '/setnote Text — add note below rules; /setnote reset — clear note\n\n' +
  '<b>Posting</b>\n' +
  '/sendrules — post to active group General\n' +
  '/sendrules 2 — post to topic #2\n' +
  '/sendrules all — post to all registered topics\n' +
  'Add pin to pin posts, e.g. /sendrules 2 pin\n\n' +
  '<b>Welcome & players</b>\n' +
  '/welcome — preview welcome\n' +
  '/setwelcome Text — edit ({name} is replaced by player name); reset restores default\n' +
  '/setwelcomeimage HTTPS_URL — set welcome image; reset removes it\n' +
  '/setlink HTTPS_URL — set tournament invite link\n' +
  'Reply to a message with /broadcast — copy it to registered users\n\n' +
  '<b>Admins (owners only)</b>\n' +
  '/admins — list owners and admins\n' +
  '/addadmin USER_ID — add admin\n' +
  '/rmadmin USER_ID — remove admin';

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function getSetting(key) {
  const row = await db.select().from(settings).where(eq(settings.key, key)).get();
  return row ? row.value : null;
}

async function setSetting(key, value) {
  await db.insert(settings).values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

async function delSetting(key) {
  await db.delete(settings).where(eq(settings.key, key)).run();
}

const isOwner = (uid) => OWNER_IDS.includes(Number(uid));

async function isAdmin(uid) {
  if (isOwner(uid)) return true;
  const row = await db.select().from(admins).where(eq(admins.userId, Number(uid))).get();
  return !!row;
}

async function botUsername() {
  let username = await getSetting('bot_username');

  if (!username) {
    const me = await api.getMe();
    username = me.username || '';
    await setSetting('bot_username', username);
  }

  return String(username).toLowerCase();
}

const getRules = () => db.select().from(rules).orderBy(asc(rules.id)).all();
const getGroups = () => db.select().from(groups).orderBy(asc(groups.id)).all();

async function getActiveGroupId() {
  const id = await getSetting('active_group_id');
  return id ? Number(id) : null;
}

async function getTopics(groupId) {
  if (groupId == null) return [];

  return db.select().from(topics)
    .where(eq(topics.groupId, Number(groupId)))
    .orderBy(asc(topics.id)).all();
}

async function buildTable() {
  const rows = await getRules();
  if (!rows.length) return null;

  const title = (await getSetting('title')) || '🏆 Tournament Rules';
  const note = await getSetting('rules_note');

  return renderRules(title, rows, note || undefined);
}

const sendText = (chatId, text, extra = {}) =>
  api.sendMessage({
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...extra,
  });

const sendTable = (chatId, html, threadId) =>
  api.sendRichMessage({
    chat_id: chatId,
    rich_message: { html },
    ...(threadId != null && Number(threadId) !== 0
      ? { message_thread_id: Number(threadId) }
      : {}),
  });

async function sendWelcome(chatId, user) {
  const template = (await getSetting('welcome')) || DEFAULT_WELCOME;

  const text = esc(template).replace(
    /\{name\}/gi,
    esc(user.first_name || 'player')
  );

  const link = await getSetting('group_link');
  const imageUrl = await getSetting('welcome_image');

  const replyMarkup = link
    ? {
        inline_keyboard: [[
          {
            text: '🏆 Join the tournament group',
            url: link,
          },
        ]],
      }
    : undefined;

  if (imageUrl) {
    return api.sendPhoto({
      chat_id: chatId,
      photo: imageUrl,
      caption: text,
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  return sendText(
    chatId,
    text,
    replyMarkup ? { reply_markup: replyMarkup } : {}
  );
}

function parseRule(text) {
  const separator = text.indexOf('|');

  if (separator < 0) return null;

  const criteria = text.slice(0, separator).trim();
  const rule = text.slice(separator + 1).trim();

  return criteria && rule ? { criteria, rule } : null;
}

function validHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function parsePositiveInteger(value) {
  if (!/^\d+$/.test(String(value).trim())) return null;

  const number = Number(value);

  return Number.isSafeInteger(number) && number > 0
    ? number
    : null;
}

async function registerGroup(chat) {
  await db.insert(groups).values({
    id: chat.id,
    title: chat.title || 'Tournament Group',
  }).onConflictDoUpdate({
    target: groups.id,
    set: {
      title: chat.title || 'Tournament Group',
    },
  }).run();

  await setSetting('active_group_id', String(chat.id));
}

export default async function (message, ctx) {
  const text = message.text || '';

  const match = text.match(
    /^\/(\w+)(?:@(\w+))?(?:\s+([\s\S]*))?$/
  );

  if (!match) return;

  const cmd = match[1].toLowerCase();
  const addressedBot = match[2];
  const args = (match[3] || '').trim();

  if (
    addressedBot &&
    addressedBot.toLowerCase() !== await botUsername()
  ) {
    return;
  }

  const chat = message.chat;
  const uid = message.from?.id;

  if (!uid) return;

  const isPrivate = chat.type === 'private';
  const inGroup = chat.type === 'group' || chat.type === 'supergroup';

  const threadId = message.is_topic_message
    ? Number(message.message_thread_id)
    : 0;

  const say = (replyText, extra = {}) =>
    sendText(chat.id, replyText, {
      ...(threadId ? { message_thread_id: threadId } : {}),
      ...extra,
    });

  // Player registration and welcome.
  if (isPrivate && cmd === 'start') {
    await db.insert(users).values({
      id: uid,
      firstName: message.from.first_name || 'Player',
    }).onConflictDoNothing({
      target: users.id,
    }).run();

    if (!(await isAdmin(uid))) {
      return sendWelcome(chat.id, message.from);
    }

    return say(HELP);
  }

  if (inGroup && cmd === 'start') return;

  if (!(await isAdmin(uid))) return;

  // Group commands.
  if (inGroup) {
    if (cmd === 'registergroup' || cmd === 'setgroup') {
      await registerGroup(chat);

      return say(
        '✅ Group registered and set as active. Run /settopic inside each topic you want to link.'
      );
    }

    if (cmd === 'settopic') {
      if (!args) {
        return say('Usage: /settopic Name (run inside the topic)');
      }

      const registered = await db.select()
        .from(groups)
        .where(eq(groups.id, chat.id))
        .get();

      if (!registered) {
        return say('This group is not registered. Run /registergroup first.');
      }

      const currentThreadId = threadId || 0;

      await db.insert(topics).values({
        groupId: chat.id,
        name: args,
        threadId: currentThreadId,
      }).onConflictDoUpdate({
        target: topics.threadId,
        set: {
          name: args,
          groupId: chat.id,
        },
      }).run();

      return say(`✅ Topic <b>${esc(args)}</b> linked to this group.`);
    }

    if (cmd === 'rules') {
      const table = await buildTable();

      if (!table) {
        return say('No rules set yet. Use /addrule or /defaults in private chat.');
      }

      try {
        const sent = await sendTable(chat.id, table, threadId);

        if (args.toLowerCase() === 'pin') {
          await api.pinChatMessage({
            chat_id: chat.id,
            message_id: sent.message_id,
            disable_notification: true,
          });
        }

        return sent;
      } catch (error) {
        return say(
          `❌ ${esc(error.description || error.message || 'Failed to send rules')}`
        );
      }
    }

    return;
  }

  // Admin panel in private chat.
  if (!isPrivate) return;

  switch (cmd) {
    case 'help':
      return say(HELP);

    case 'groups': {
      const rows = await getGroups();
      const activeId = await getActiveGroupId();

      if (!rows.length) {
        return say('No groups registered. Use /registergroup in a group.');
      }

      return say(
        '<b>Registered Groups</b>\n' +
        rows.map((group) =>
          `${Number(group.id) === activeId ? '✅' : '➖'} ` +
          `<code>${group.id}</code> — ${esc(group.title)}`
        ).join('\n') +
        '\n\nSwitch with /switchgroup ID.'
      );
    }

    case 'switchgroup': {
      const id = parsePositiveInteger(args);

      if (!id) {
        return say('Usage: /switchgroup GROUP_ID');
      }

      const group = await db.select()
        .from(groups)
        .where(eq(groups.id, id))
        .get();

      if (!group) {
        return say('That group is not registered. Use /groups.');
      }

      await setSetting('active_group_id', String(id));

      return say(`✅ Active group switched to <code>${id}</code>.`);
    }

    case 'rules': {
      const table = await buildTable();

      return table
        ? sendTable(chat.id, table)
        : say('No rules yet. Use /addrule or /defaults.');
    }

    case 'addrule': {
      const rule = parseRule(args);

      if (!rule) {
        return say('Usage: /addrule Criteria | Rule');
      }

      await db.insert(rules).values(rule).run();

      return say('✅ Rule added.');
    }

    case 'editrule': {
      const matchRule = args.match(/^(\d+)\s+([\s\S]+)$/);

      if (!matchRule) {
        return say('Usage: /editrule N Criteria | Rule');
      }

      const index = parsePositiveInteger(matchRule[1]);
      const replacement = parseRule(matchRule[2]);

      if (!index || !replacement) {
        return say('Usage: /editrule N Criteria | Rule');
      }

      const rows = await getRules();
      const existing = rows[index - 1];

      if (!existing) {
        return say(`No rule numbered ${index}. Use /rules to see the list.`);
      }

      await db.update(rules)
        .set(replacement)
        .where(eq(rules.id, existing.id))
        .run();

      return say(`✅ Rule #${index} updated.`);
    }

    case 'delrule': {
      const index = parsePositiveInteger(args);

      if (!index) {
        return say('Usage: /delrule N');
      }

      const rows = await getRules();
      const existing = rows[index - 1];

      if (!existing) {
        return say(`No rule numbered ${index}. Use /rules to see the list.`);
      }

      await db.delete(rules)
        .where(eq(rules.id, existing.id))
        .run();

      return say(`🗑 Rule #${index} deleted.`);
    }

    case 'defaults': {
      await db.delete(rules).run();

      await db.insert(rules).values(
        DEFAULTS.map(([criteria, rule]) => ({
          criteria,
          rule,
        }))
      ).run();

      return say('✅ Default tournament rules loaded. Check with /rules.');
    }

    case 'settitle': {
      if (!args) {
        return say('Usage: /settitle Title (or reset)');
      }

      if (args.toLowerCase() === 'reset') {
        await delSetting('title');

        return say('✅ Title reset to default.');
      }

      await setSetting('title', args);

      return say('✅ Title updated.');
    }

    case 'setnote': {
      if (!args || args.toLowerCase() === 'reset') {
        await delSetting('rules_note');

        return say('✅ Rules note cleared.');
      }

      await setSetting('rules_note', args);

      return say('✅ Note added below the rules table.');
    }

    case 'topics': {
      const activeId = await getActiveGroupId();

      if (!activeId) {
        return say('No active group. Register a group first with /registergroup.');
      }

      const rows = await getTopics(activeId);

      if (!rows.length) {
        return say('No topics registered for the active group. Run /settopic in the group.');
      }

      return say(
        '<b>Topics in active group</b>\n' +
        rows.map((topic, i) =>
          `${i + 1}. ${esc(topic.name)}` +
          `${Number(topic.threadId) === 0 ? ' (General)' : ''}`
        ).join('\n')
      );
    }

    case 'deltopic': {
      const index = parsePositiveInteger(args);

      if (!index) {
        return say('Usage: /deltopic N (see /topics)');
      }

      const activeId = await getActiveGroupId();

      if (!activeId) {
        return say('No active group. Register a group first.');
      }

      const rows = await getTopics(activeId);
      const topic = rows[index - 1];

      if (!topic) {
        return say(`No topic numbered ${index}. See /topics.`);
      }

      await db.delete(topics)
        .where(eq(topics.id, topic.id))
        .run();

      return say(`🗑 Topic #${index} removed.`);
    }

    case 'sendrules': {
      const activeId = await getActiveGroupId();

      if (!activeId) {
        return say('No active group. Use /registergroup in a group first.');
      }

      const table = await buildTable();

      if (!table) {
        return say('No rules to send. Use /addrule or /defaults.');
      }

      const tokens = args.toLowerCase().split(/\s+/).filter(Boolean);
      const pin = tokens.includes('pin');
      const target = tokens.find((token) => token !== 'pin');

      const topicRows = await getTopics(activeId);

      let targets;

      if (!target) {
        targets = [{ name: 'General', threadId: 0 }];
      } else if (target === 'all') {
        if (!topicRows.length) {
          return say('No topics registered for the active group. See /topics.');
        }

        targets = topicRows;
      } else {
        const index = parsePositiveInteger(target);
        const topic = index ? topicRows[index - 1] : null;

        if (!topic) {
          return say('Invalid topic number. Use /topics or /sendrules all.');
        }

        targets = [topic];
      }

      const results = [];

      for (const targetTopic of targets) {
        try {
          const sent = await sendTable(
            activeId,
            table,
            Number(targetTopic.threadId) || 0
          );

          if (pin) {
            try {
              await api.pinChatMessage({
                chat_id: activeId,
                message_id: sent.message_id,
                disable_notification: true,
              });
            } catch {
              results.push(
                `⚠️ ${esc(targetTopic.name)}: sent, but could not pin.`
              );

              continue;
            }
          }

          results.push(`✅ ${esc(targetTopic.name)}`);
        } catch (error) {
          results.push(
            `❌ ${esc(targetTopic.name)}: ` +
            `${esc(error.description || error.message || 'send failed')}`
          );
        }
      }

      return say(results.join('\n'));
    }

    case 'welcome':
      return sendWelcome(chat.id, message.from);

    case 'setwelcome': {
      if (!args || args.toLowerCase() === 'reset') {
        await delSetting('welcome');

        return say('✅ Welcome message reset to default.');
      }

      await setSetting('welcome', args);

      return say('✅ Welcome message updated. Preview with /welcome.');
    }

    case 'setwelcomeimage': {
      if (!args || args.toLowerCase() === 'reset') {
        await delSetting('welcome_image');

        return say('✅ Welcome image removed.');
      }

      if (!validHttpsUrl(args)) {
        return say(
          'Usage: /setwelcomeimage https://example.com/image.jpg (or reset)'
        );
      }

      await setSetting('welcome_image', args);

      return say('✅ Welcome image saved. Test with /welcome.');
    }

    case 'setlink': {
      if (!validHttpsUrl(args)) {
        return say('Usage: /setlink https://t.me/yourgroup');
      }

      await setSetting('group_link', args);

      return say('✅ Group invite link saved.');
    }

    case 'broadcast': {
      if (!message.reply_to_message) {
        return say('Reply to the message you want to broadcast with /broadcast.');
      }

      const registeredUsers = await db.select().from(users).all();

      let sentCount = 0;
      let failedCount = 0;

      for (const user of registeredUsers) {
        try {
          await api.copyMessage({
            chat_id: user.id,
            from_chat_id: chat.id,
            message_id: message.reply_to_message.message_id,
          });

          sentCount++;
        } catch {
          failedCount++;
        }
      }

      return say(
        `✅ Broadcast complete. Sent: ${sentCount}; failed/unreachable: ${failedCount}.`
      );
    }

    case 'admins': {
      const rows = await db.select().from(admins).all();

      return say(
        '<b>Owners</b>\n' +
        OWNER_IDS.join('\n') +
        '\n\n<b>Admins</b>\n' +
        (rows.length
          ? rows.map((row) => row.userId).join('\n')
          : '(none)')
      );
    }

    case 'addadmin': {
      if (!isOwner(uid)) {
        return say('Owners only.');
      }

      const id = parsePositiveInteger(args.split(/\s+/)[0]);

      if (!id) {
        return say('Usage: /addadmin USER_ID');
      }

      if (isOwner(id)) {
        return say('That user is already an owner.');
      }

      await db.insert(admins).values({
        userId: id,
      }).onConflictDoNothing({
        target: admins.userId,
      }).run();

      return say(`✅ ${id} is now an admin.`);
    }

    case 'rmadmin': {
      if (!isOwner(uid)) {
        return say('Owners only.');
      }

      const id = parsePositiveInteger(args.split(/\s+/)[0]);

      if (!id) {
        return say('Usage: /rmadmin USER_ID');
      }

      if (isOwner(id)) {
        return say('Owner IDs cannot be removed here.');
      }

      await db.delete(admins)
        .where(eq(admins.userId, id))
        .run();

      return say(`🗑 ${id} removed from admins.`);
    }

    default:
      return;
  }
}