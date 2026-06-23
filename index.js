// ══════════════════════════════════════════
//   RTF Gaming Bot — Node.js + MongoDB
//   Render-ready, 40-50 concurrent users
// ══════════════════════════════════════════
require('dotenv').config();
const TelegramBot  = require('node-telegram-bot-api');
const express      = require('express');
const { connectDB, getSetting, setSetting, getUser, getBalance } = require('./db');
const { User, Bet, Transaction, Settings } = require('./models');
const {
  state, RESULT_SEQUENCE, ROUND_TIME, BREAK_TIME, WIN_MULT,
  getNextResult, timerBar, getRemainingSeconds
} = require('./game');

// ── Config ──
const TOKEN      = process.env.BOT_TOKEN;
const ADMIN_ID   = Number(process.env.ADMIN_ID);
const CHANNELS   = (process.env.CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean);
const PORT       = process.env.PORT || 3000;

// ── Bot init (polling — works on Render free tier) ──
const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: { timeout: 10, allowed_updates: ['message', 'callback_query'] }
  }
});

// ── Keep-alive server for Render ──
const app = express();
app.get('/', (_, res) => res.send('RTF Gaming Bot is running ✅'));
app.listen(PORT, () => console.log(`🌐 Keep-alive server on port ${PORT}`));

// ══════════════════════════════════════════
//   HELPERS
// ══════════════════════════════════════════

function calcDepositBonus(amt) {
  if (amt >= 100) return Math.floor(amt / 100) * 5;
  return 0;
}

function mainKb() {
  return {
    keyboard: [
      ['🎮 Play', '💰 Balance'],
      ['➕ Deposit', '➖ Withdraw'],
      ['👥 Refer', '🎁 Daily Bonus'],
      ['🏆 Leaderboard', '🛑 Stop Game Notifications']
    ],
    resize_keyboard: true
  };
}

function safe(fn) {
  return async (...args) => {
    try { await fn(...args); }
    catch (e) { console.error('Handler error:', e.message); }
  };
}

async function sendMsg(chatId, text, opts = {}) {
  try { return await bot.sendMessage(chatId, text, opts); }
  catch (e) { /* silently ignore blocked/deleted */ }
}

async function editMsg(chatId, msgId, text, opts = {}) {
  try { return await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...opts }); }
  catch (e) { /* silently ignore */ }
}

const WELCOME_TEXT = (name, uid, username) => `✨━━━━━━━━━━━━━━━━━━━━━━━━━━━✨
🎭  RTF GAMING COLOUR PREDICTION
✨━━━━━━━━━━━━━━━━━━━━━━━━━━━✨

👋 Welcome ${name} 🎉

🆔 ID: ${uid}
👤 Name: ${name}
🏷️ Username: @${username || 'N/A'}

━━━━━━━━━━━━━━━━━━━━━━
💎 DEPOSIT BONUS
━━━━━━━━━━━━━━━━━━━━━━
💰 Min ₹10  (no bonus)
💰 ₹100 → 🎁 ₹5 Bonus
💰 ₹200 → 🎁 ₹10 Bonus
💰 ₹500 → 🎁 ₹25 Bonus

━━━━━━━━━━━━━━━━━━━━━━
⚠️ RULES
━━━━━━━━━━━━━━━━━━━━━━
🎮 Min Bet: ₹1
💸 Min Withdrawal: ₹30
🛡️ Play responsibly

👑 OWNER: @RTFGAMMING
📢 CHANNEL: @RTFGAMINGHACK0
✨ READY TO WIN BIG ✨`;

// ══════════════════════════════════════════
//   USER STATE MAP (per-user conversation state)
// ══════════════════════════════════════════
const userState = new Map(); // uid → { step, data }

function getUS(uid) {
  if (!userState.has(uid)) userState.set(uid, {});
  return userState.get(uid);
}
function clearUS(uid) { userState.set(uid, {}); }

// ══════════════════════════════════════════
//   FORCE JOIN CHECK
// ══════════════════════════════════════════

async function checkChannels(userId) {
  const missing = [];
  for (const ch of CHANNELS) {
    try {
      const member = await bot.getChatMember(ch, userId);
      if (!['member', 'administrator', 'creator'].includes(member.status)) missing.push(ch);
    } catch { missing.push(ch); }
  }
  return missing;
}

async function sendForceJoin(chatId, missing) {
  const buttons = missing.map((ch, i) => ([{
    text: `📢 Join Channel ${i + 1}`,
    url: `https://t.me/${ch.replace('@', '')}`
  }]));
  buttons.push([{ text: '✅ I Joined', callback_data: 'check_join' }]);
  await sendMsg(chatId,
    '╔═══〔 🔥 JOIN REQUIRED 〕═══╗\n🚀 Join all channels to use bot\n\n👉 Click below to join\n✅ Then press \'I Joined\'\n╚══════════════════════╝',
    { reply_markup: { inline_keyboard: buttons } }
  );
}

// ══════════════════════════════════════════
//   /START
// ══════════════════════════════════════════

bot.onText(/\/start(?:\s+(.+))?/, safe(async (msg, match) => {
  const uid  = String(msg.from.id);
  const from = msg.from;
  const ref  = match?.[1] || null;

  const missing = await checkChannels(msg.from.id);
  const isNew   = !(await User.findOne({ uid }));

  if (isNew && ref && ref !== uid) {
    const refUser = await User.findOne({ uid: ref });
    if (refUser) getUS(uid).pendingRef = ref;
  }

  if (missing.length) return await sendForceJoin(msg.chat.id, missing);

  await getUser(uid, from);

  if (isNew && getUS(uid).pendingRef) {
    await sendMsg(msg.chat.id, WELCOME_TEXT(from.first_name, from.id, from.username), { reply_markup: mainKb() });
    return await sendContactRequest(msg.chat.id);
  }

  await sendMsg(msg.chat.id, WELCOME_TEXT(from.first_name, from.id, from.username), { reply_markup: mainKb() });
}));

async function sendContactRequest(chatId) {
  await sendMsg(chatId,
    '📱 Referral confirm karne ke liye apna contact share karo:\n(Neeche wala button dabao)',
    { reply_markup: { keyboard: [[{ text: '📱 Share My Contact', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } }
  );
}

// ══════════════════════════════════════════
//   LEADERBOARD
// ══════════════════════════════════════════

async function showLeaderboard(chatId) {
  const users = await User.find({}).sort({ winning: -1 }).limit(10);
  if (!users.length) return sendMsg(chatId, '📊 Abhi koi data nahi hai!');

  let text = '🏆 TOP 10 LEADERBOARD\n━━━━━━━━━━━━━━━━━━━━\n';
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

  users.forEach((u, i) => {
    const total = (u.deposit || 0) + (u.bonus || 0) + (u.winning || 0);
    const name = u.name || 'Unknown';
    text += `${medals[i]} ${name}\n    💰 Total Wallet: ₹${total} | 🏆 Winning: ₹${u.winning}\n`;
  });
  text += '━━━━━━━━━━━━━━━━━━━━';
  await sendMsg(chatId, text);
}

// ══════════════════════════════════════════
//   BALANCE
// ══════════════════════════════════════════

async function showBalance(chatId, uid) {
  const u = await User.findOne({ uid });
  if (!u) return sendMsg(chatId, '❌ /start karo pehle');
  const total = await getBalance(u);
  await sendMsg(chatId,
    `💰 BALANCE DETAILS\n━━━━━━━━━━━━━━━━━━\n🏦 Deposit (Play):     ₹${u.deposit}\n🎁 Bonus (Play):       ₹${u.bonus}\n💸 Winning (Withdraw): ₹${u.winning}\n👥 Referral:           ₹${u.referral}\n━━━━━━━━━━━━━━━━━━\n💰 TOTAL: ₹${total}`,
    { reply_markup: { inline_keyboard: [[{ text: '🔄 Convert Referral → Winning', callback_data: 'convert_ref' }]] } }
  );
}

// ══════════════════════════════════════════
//   PLAY — send bet panel without requiring /start again
// ══════════════════════════════════════════

async function showPlayPanel(chatId, uid) {
  const u = await User.findOne({ uid });
  if (!u) return sendMsg(chatId, '❌ /start karo pehle');
  if (!state.gameActive) return sendMsg(chatId, '❌ Game abhi active nahi hai\n⏳ Admin ke game start karne ka wait karo');

  // Re-opt-in
  state.optedOut.delete(uid);
  state.activePlayers.add(uid);

  // Already bet this round?
  const existingBet = state.pendingBets.get(uid);
  if (existingBet) {
    const remaining = getRemainingSeconds();
    const emoji = existingBet.choice === 'big' ? '🔵' : '🔴';
    return sendMsg(chatId,
      `✅ Bet already placed!\n${emoji} ${existingBet.choice.toUpperCase()} — ₹${existingBet.amount}\n⏳ Result in ${remaining}s`
    );
  }

  const remaining = getRemainingSeconds();
  const bar = timerBar(remaining);

  const m = await sendMsg(chatId,
    `🎮 ROUND #${state.currentRound + 1}\n${bar}\n⏳ ${remaining}s baki hai\n\n🔵 BIG ya 🔴 SMALL choose karo:`,
    { reply_markup: { inline_keyboard: [[
      { text: '🔵 BIG',   callback_data: 'bet_big' },
      { text: '🔴 SMALL', callback_data: 'bet_small' }
    ]] } }
  );
  if (m) state.timerMsgIds.set(uid, m.message_id);
}

// ══════════════════════════════════════════
//   DEPOSIT
// ══════════════════════════════════════════

async function startDeposit(chatId, uid) {
  getUS(uid).step = 'dep_amount';
  await sendMsg(chatId, '💰 Kitna deposit karna hai? (min ₹10)');
}

// ══════════════════════════════════════════
//   WITHDRAW
// ══════════════════════════════════════════

async function startWithdraw(chatId, uid) {
  getUS(uid).step = 'wd_amount';
  await sendMsg(chatId, '💸 Withdrawal amount enter karo (min ₹30):');
}

// ══════════════════════════════════════════
//   DAILY BONUS
// ══════════════════════════════════════════

async function dailyBonus(chatId, uid, from) {
  const u = await getUser(uid, from);
  const today = new Date().toISOString().split('T')[0];
  if (u.last_bonus === today) return sendMsg(chatId, '❌ Aaj ka bonus le chuke ho. Kal aana! 😊');
  u.bonus += 3;
  u.last_bonus = today;
  await u.save();
  await sendMsg(chatId, '🎁 ₹3 daily bonus add ho gaya!');
}

// ══════════════════════════════════════════
//   REFER
// ══════════════════════════════════════════

async function showRefer(chatId, uid) {
  const u = await User.findOne({ uid });
  if (!u) return sendMsg(chatId, '❌ /start karo pehle');
  const botInfo = await bot.getMe();
  const link = `https://t.me/${botInfo.username}?start=${uid}`;
  await sendMsg(chatId,
    `👥 YOUR REFERRAL\n━━━━━━━━━━━━━━━━\n🔗 Your Link:\n${link}\n\n👥 Confirmed Referrals: ${u.referral_count}\n💰 Referral Balance: ₹${u.referral}\n\nℹ️ Jab naya user aapki link se aaye aur\ncontact share kare → aapko ₹1 milega!\n\n💡 Convert button se Referral → Winning me badlo`,
    { reply_markup: { inline_keyboard: [[{ text: '🔄 Convert Referral → Winning', callback_data: 'convert_ref' }]] } }
  );
}

// ══════════════════════════════════════════
//   MESSAGE ROUTER
// ══════════════════════════════════════════

bot.on('message', safe(async (msg) => {
  if (!msg.from) return;
  const uid  = String(msg.from.id);
  const chatId = msg.chat.id;
  const from = msg.from;

  // ── Contact share ──
  if (msg.contact) {
    if (String(msg.contact.user_id) !== uid)
      return sendMsg(chatId, '❌ Apna hi contact share karo', { reply_markup: mainKb() });

    const u = await User.findOne({ uid });
    if (!u) return;
    if (u.phone) return sendMsg(chatId, '✅ Already verified!', { reply_markup: mainKb() });

    u.phone = msg.contact.phone_number;
    await u.save();

    const us = getUS(uid);
    if (us.pendingRef) {
      const refUser = await User.findOne({ uid: us.pendingRef });
      if (refUser) {
        refUser.referral += 1;
        refUser.referral_count += 1;
        await refUser.save();
        await sendMsg(us.pendingRef,
          `🎉 REFERRAL CONFIRMED!\n━━━━━━━━━━━━━━━━\n👤 ${u.name} ne join kiya!\n💰 +₹1 Referral Balance add ho gaya!\n━━━━━━━━━━━━━━━━\n👥 Total Referrals: ${refUser.referral_count}\n💵 Total Referral Balance: ₹${refUser.referral}`
        );
      }
      delete us.pendingRef;
    }

    return sendMsg(chatId, `✅ Contact verified! Welcome ${from.first_name}!\nAb aap game khel sakte ho! 🎮`, { reply_markup: mainKb() });
  }

  if (!msg.text) return;
  const txt = msg.text.trim();

  // ── Admin: QR set mode ──
  if (msg.photo && String(from.id) === String(ADMIN_ID)) {
    const us = getUS(uid);
    if (us.step === 'set_qr') {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      await setSetting('qr_file_id', fileId);
      clearUS(uid);
      return sendMsg(chatId, '✅ QR Code saved!');
    }
  }

  // ── Menu buttons ──
  if (txt === '🎮 Play')                    return showPlayPanel(chatId, uid);
  if (txt === '💰 Balance')                 return showBalance(chatId, uid);
  if (txt === '➕ Deposit')                 return startDeposit(chatId, uid);
  if (txt === '➖ Withdraw')                return startWithdraw(chatId, uid);
  if (txt === '👥 Refer')                   return showRefer(chatId, uid);
  if (txt === '🎁 Daily Bonus')             return dailyBonus(chatId, uid, from);
  if (txt === '🏆 Leaderboard')             return showLeaderboard(chatId);
  if (txt === '🛑 Stop Game Notifications') return stopGameNotifications(chatId, uid);

  // ── Conversation state machine ──
  const us = getUS(uid);

  // ── Bet amount entry ──
  if (us.step === 'bet_amount') {
    const amt = parseInt(txt);
    if (isNaN(amt) || amt < 1) return sendMsg(chatId, '❌ Min bet ₹1 hai, valid number enter karo');
    if (!state.gameActive)     return (clearUS(uid), sendMsg(chatId, '❌ Game active nahi'));

    const remaining = getRemainingSeconds();
    if (remaining <= 0) return (clearUS(uid), sendMsg(chatId, '❌ Betting time khatam ho gaya!'));
    if (state.pendingBets.has(uid)) return (clearUS(uid), sendMsg(chatId, '❌ Already bet place ho chuki hai'));

    const u = await User.findOne({ uid });
    const total = await getBalance(u);
    if (total < amt) return sendMsg(chatId, `❌ Balance kam hai. Total: ₹${total}`);

    // Deduct: deposit → bonus → winning
    let rem = amt;
    const stakeFrom = { deposit: 0, bonus: 0, winning: 0 };
    for (const key of ['deposit', 'bonus', 'winning']) {
      if (rem <= 0) break;
      const use = Math.min(u[key], rem);
      u[key] -= use;
      stakeFrom[key] = use;
      rem -= use;
    }
    if (rem > 0) return sendMsg(chatId, '❌ Balance nahi hai');
    await u.save();

    const choice = us.betChoice;
    state.pendingBets.set(uid, { choice, amount: amt, stakeFrom });
    clearUS(uid);

    // Update existing timer message to show bet placed (no bet buttons)
    const emoji = choice === 'big' ? '🔵' : '🔴';
    const totalReturn = Math.round(amt * WIN_MULT * 100) / 100;
    const netProfit   = Math.round((totalReturn - amt) * 100) / 100;

    const existingMid = state.timerMsgIds.get(uid);
    if (existingMid) {
      await editMsg(chatId, existingMid,
        `🎮 ROUND #${state.currentRound + 1}\n${timerBar(remaining)}\n⏳ ${remaining}s\n\n✅ Bet: ${emoji} ${choice.toUpperCase()} ₹${amt}\n🏆 Jeet gaye to: ₹${totalReturn} (profit: +₹${netProfit})`
      );
    } else {
      await sendMsg(chatId,
        `✅ BET PLACED!\n${emoji} ${choice.toUpperCase()} — ₹${amt}\n🏆 Jeet gaye to: ₹${totalReturn} (profit: +₹${netProfit})\n⏳ Result ${remaining}s me aayega`
      );
    }
    return;
  }

  // ── Deposit amount ──
  if (us.step === 'dep_amount') {
    const amt = parseInt(txt);
    if (isNaN(amt) || amt < 10) return sendMsg(chatId, '❌ Minimum ₹10 deposit karo');
    us.depAmount = amt;
    us.step = 'dep_screenshot';

    const bonus   = calcDepositBonus(amt);
    const upi     = await getSetting('upi_id') || process.env.DEFAULT_UPI_ID;
    const qr      = await getSetting('qr_file_id');
    const msgText = `💳 PAYMENT DETAILS\n━━━━━━━━━━━━━━━━\n💵 Amount: ₹${amt}\n🎁 Bonus: ₹${bonus}\n━━━━━━━━━━━━━━━━\n📱 UPI ID:\n\`${upi}\`\n━━━━━━━━━━━━━━━━\n📸 Pay karke screenshot bhejo`;

    if (qr) await bot.sendPhoto(chatId, qr, { caption: msgText, parse_mode: 'Markdown' });
    else await sendMsg(chatId, msgText, { parse_mode: 'Markdown' });
    return;
  }

  // ── Withdraw amount ──
  if (us.step === 'wd_amount') {
    const amt = parseInt(txt);
    if (isNaN(amt) || amt < 30) return sendMsg(chatId, '❌ Min ₹30 withdraw karo');
    const u = await User.findOne({ uid });
    if (!u || u.winning < amt) return sendMsg(chatId, `❌ Winning balance kam hai: ₹${u?.winning || 0}`);
    us.wdAmount = amt;
    us.step = 'wd_upi';
    return sendMsg(chatId, '📱 Apna UPI ID bhejo:');
  }

  // ── Withdraw UPI ──
  if (us.step === 'wd_upi') {
    const upiAddr = txt;
    const amt = us.wdAmount;
    const u = await User.findOne({ uid });
    if (!u || u.winning < amt) return sendMsg(chatId, '❌ Balance nahi hai');

    u.winning -= amt;
    await u.save();

    // Save transaction
    const txn = await Transaction.create({ uid, type: 'withdrawal', amount: amt, upi_id: upiAddr, status: 'pending' });

    const forwardCh = await getSetting('forward_channel');
    const adminKb = { inline_keyboard: [[
      { text: '✅ Pay',     callback_data: `w_ok_${uid}_${amt}_${txn._id}` },
      { text: '❌ Reject',  callback_data: `w_no_${uid}_${amt}_${txn._id}` },
      { text: '👤 Profile', callback_data: `profile_${uid}` }
    ]] };
    const wdText = `💸 WITHDRAWAL REQUEST\n━━━━━━━━━━━━━━━━\n👤 ${u.name}  |  @${u.username || 'N/A'}\n🆔 ID: ${uid}\n💵 Amount: ₹${amt}\n📱 UPI: ${upiAddr}\n━━━━━━━━━━━━━━━━`;

    await sendMsg(ADMIN_ID, wdText, { reply_markup: adminKb });

    // Also forward to group/channel if set
    if (forwardCh) {
      await sendMsg(forwardCh, wdText + '\n\n⚠️ Approval sirf admin de sakta hai.');
    }

    clearUS(uid);
    return sendMsg(chatId, '⏳ Withdrawal request bhej di! Admin process karega.');
  }

  // ── Admin: set UPI ──
  if (us.step === 'set_upi' && String(from.id) === String(ADMIN_ID)) {
    await setSetting('upi_id', txt);
    clearUS(uid);
    return sendMsg(chatId, `✅ UPI ID updated: ${txt}`);
  }

  // ── Admin: set forward channel ──
  if (us.step === 'set_fwd_ch' && String(from.id) === String(ADMIN_ID)) {
    await setSetting('forward_channel', txt);
    clearUS(uid);
    return sendMsg(chatId, `✅ Forward channel set: ${txt}\nAb deposit/withdrawal requests wahan bhi jayenge.`);
  }
}));

// ── Photo handler for deposit screenshot ──
bot.on('photo', safe(async (msg) => {
  const uid    = String(msg.from.id);
  const chatId = msg.chat.id;
  const us     = getUS(uid);

  // Admin setting QR
  if (String(msg.from.id) === String(ADMIN_ID) && us.step === 'set_qr') {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    await setSetting('qr_file_id', fileId);
    clearUS(uid);
    return sendMsg(chatId, '✅ QR Code saved!');
  }

  // Deposit screenshot
  if (us.step === 'dep_screenshot') {
    const amt   = us.depAmount;
    const bonus = calcDepositBonus(amt);
    const u     = await User.findOne({ uid });
    if (!u || !amt) return sendMsg(chatId, '❌ Amount missing, deposit restart karo');

    // Save transaction record
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const txn = await Transaction.create({ uid, type: 'deposit', amount: amt, screenshot_file_id: fileId, status: 'pending' });

    // Forward screenshot to admin
    await bot.forwardMessage(ADMIN_ID, chatId, msg.message_id);

    const adminKb = { inline_keyboard: [[
      { text: '✅ Approve', callback_data: `d_ok_${uid}_${amt}_${txn._id}` },
      { text: '❌ Reject',  callback_data: `d_no_${uid}_${txn._id}` },
      { text: '👤 Profile', callback_data: `profile_${uid}` }
    ]] };
    const depText = `💰 DEPOSIT REQUEST\n━━━━━━━━━━━━━━━━\n👤 ${u.name}  |  @${u.username || 'N/A'}\n🆔 ID: ${uid}\n💵 Amount: ₹${amt}\n🎁 Bonus: ₹${bonus}\n━━━━━━━━━━━━━━━━`;

    await sendMsg(ADMIN_ID, depText, { reply_markup: adminKb });

    // Forward to channel/group if set
    const forwardCh = await getSetting('forward_channel');
    if (forwardCh) {
      await bot.forwardMessage(forwardCh, chatId, msg.message_id);
      await sendMsg(forwardCh, depText + '\n\n⚠️ Approval sirf admin de sakta hai.');
    }

    clearUS(uid);
    return sendMsg(chatId, '⏳ Screenshot bhej diya! Admin approve karega jaldi.');
  }
}));

// ══════════════════════════════════════════
//   STOP GAME NOTIFICATIONS
// ══════════════════════════════════════════

async function stopGameNotifications(chatId, uid) {
  const u = await User.findOne({ uid });
  if (!u) return sendMsg(chatId, '❌ /start karo pehle');
  state.optedOut.add(uid);
  state.activePlayers.delete(uid);
  await sendMsg(chatId,
    '🛑 Game notifications band kar di gayi!\n\nAb aapko game ke koi bhi messages nahi aayenge.\nWapas khelne ke liye 🎮 Play dabao.',
    { reply_markup: mainKb() }
  );
}

// ══════════════════════════════════════════
//   CALLBACK QUERY HANDLER
// ══════════════════════════════════════════

bot.on('callback_query', safe(async (q) => {
  const uid    = String(q.from.id);
  const chatId = q.message.chat.id;
  const msgId  = q.message.message_id;
  const cb     = q.data;

  // ── Check join ──
  if (cb === 'check_join') {
    const missing = await checkChannels(q.from.id);
    if (missing.length) return bot.answerCallbackQuery(q.id, { text: '❌ Pehle sabhi channels join karo!', show_alert: true });

    await bot.answerCallbackQuery(q.id);
    const u = await getUser(uid, q.from);
    const us = getUS(uid);
    if (us.pendingRef) return sendContactRequest(chatId);

    await sendMsg(chatId, WELCOME_TEXT(q.from.first_name, q.from.id, q.from.username), { reply_markup: mainKb() });
    return;
  }

  // ── Bet choice ──
  if (cb === 'bet_big' || cb === 'bet_small') {
    await bot.answerCallbackQuery(q.id);
    if (!state.gameActive) return bot.answerCallbackQuery(q.id, { text: '❌ Game active nahi', show_alert: true });
    if (state.pendingBets.has(uid)) return bot.answerCallbackQuery(q.id, { text: '❌ Bet already placed!', show_alert: true });

    const remaining = getRemainingSeconds();
    if (remaining <= 0) return bot.answerCallbackQuery(q.id, { text: '❌ Betting time khatam!', show_alert: true });

    const choice = cb.replace('bet_', '');
    const us = getUS(uid);
    us.step = 'bet_amount';
    us.betChoice = choice;

    // Don't remove buttons yet — keep timer running; ask for amount in new message
    const emoji = choice === 'big' ? '🔵' : '🔴';
    await sendMsg(chatId, `${emoji} ${choice.toUpperCase()} choose kiya!\n\n💰 Bet amount enter karo (min ₹1):`);
    return;
  }

  // ── Convert referral ──
  if (cb === 'convert_ref') {
    await bot.answerCallbackQuery(q.id);
    const u = await User.findOne({ uid });
    if (!u || u.referral <= 0) return bot.answerCallbackQuery(q.id, { text: '❌ Referral balance nahi hai', show_alert: true });
    const refAmt = u.referral;
    u.winning  += refAmt;
    u.referral  = 0;
    await u.save();
    return bot.editMessageText(`✅ ₹${refAmt} referral → Winning me convert ho gaya!`, { chat_id: chatId, message_id: msgId });
  }

  // ── Profile ──
  if (cb.startsWith('profile_')) {
    await bot.answerCallbackQuery(q.id);
    const tUid = cb.slice(8);
    const u = await User.findOne({ uid: tUid });
    if (!u) return sendMsg(chatId, '❌ User not found');
    const total = await getBalance(u);
    return sendMsg(chatId,
      `👤 USER PROFILE\n━━━━━━━━━━━━━━━━\n🆔 ID: ${tUid}\n👤 Name: ${u.name}\n🏷️ Username: @${u.username || 'N/A'}\n📱 Phone: ${u.phone || 'Not verified'}\n━━━━━━━━━━━━━━━━\n🏦 Deposit: ₹${u.deposit}\n🎁 Bonus:   ₹${u.bonus}\n💸 Winning: ₹${u.winning}\n👥 Referral: ₹${u.referral}\n💰 Total:   ₹${total}\n━━━━━━━━━━━━━━━━\n📅 Last Bonus: ${u.last_bonus || 'Never'}\n👥 Referrals: ${u.referral_count}`
    );
  }

  // ── Deposit approve ──
  if (cb.startsWith('d_ok_')) {
    if (q.from.id !== ADMIN_ID) return bot.answerCallbackQuery(q.id, { text: '❌ Admin nahi ho', show_alert: true });
    await bot.answerCallbackQuery(q.id);
    const parts = cb.split('_');
    const tUid = parts[2], amt = parseInt(parts[3]), txnId = parts[4];
    const bonus = calcDepositBonus(amt);
    const u = await User.findOne({ uid: tUid });
    if (!u) return sendMsg(chatId, '❌ User not found');
    u.deposit += amt;
    u.bonus   += bonus;
    await u.save();
    if (txnId) await Transaction.findByIdAndUpdate(txnId, { status: 'approved' });
    await sendMsg(tUid, `✅ DEPOSIT APPROVED!\n💵 Amount: ₹${amt}\n🎁 Bonus:  ₹${bonus}\n💰 Total Added: ₹${amt + bonus}`);
    return bot.editMessageText(`✅ Deposit ₹${amt} approved for ${tUid}`, { chat_id: chatId, message_id: msgId });
  }

  // ── Deposit reject ──
  if (cb.startsWith('d_no_')) {
    if (q.from.id !== ADMIN_ID) return bot.answerCallbackQuery(q.id, { text: '❌ Admin nahi ho', show_alert: true });
    await bot.answerCallbackQuery(q.id);
    const parts = cb.split('_');
    const tUid = parts[2], txnId = parts[3];
    if (txnId) await Transaction.findByIdAndUpdate(txnId, { status: 'rejected' });
    await sendMsg(tUid, '❌ Deposit reject ho gaya. Help ke liye @RTFGAMMING contact karo.');
    return bot.editMessageText('❌ Deposit rejected', { chat_id: chatId, message_id: msgId });
  }

  // ── Withdraw approve ──
  if (cb.startsWith('w_ok_')) {
    if (q.from.id !== ADMIN_ID) return bot.answerCallbackQuery(q.id, { text: '❌ Admin nahi ho', show_alert: true });
    await bot.answerCallbackQuery(q.id);
    const parts = cb.split('_');
    const tUid = parts[2], amt = parseInt(parts[3]), txnId = parts[4];
    if (txnId) await Transaction.findByIdAndUpdate(txnId, { status: 'approved' });
    await sendMsg(tUid, `✅ Withdrawal ₹${amt} complete! UPI check karo.`);
    return bot.editMessageText(`✅ Withdrawal ₹${amt} paid to ${tUid}`, { chat_id: chatId, message_id: msgId });
  }

  // ── Withdraw reject ──
  if (cb.startsWith('w_no_')) {
    if (q.from.id !== ADMIN_ID) return bot.answerCallbackQuery(q.id, { text: '❌ Admin nahi ho', show_alert: true });
    await bot.answerCallbackQuery(q.id);
    const parts = cb.split('_');
    const tUid = parts[2], amt = parseInt(parts[3]), txnId = parts[4];
    const u = await User.findOne({ uid: tUid });
    if (u) { u.winning += amt; await u.save(); }
    if (txnId) await Transaction.findByIdAndUpdate(txnId, { status: 'rejected' });
    await sendMsg(tUid, `❌ Withdrawal reject. ₹${amt} wapas add ho gaya.`);
    return bot.editMessageText('❌ Withdrawal rejected, amount refunded', { chat_id: chatId, message_id: msgId });
  }

  // ══════════════════
  //   ADMIN PANEL CBs
  // ══════════════════
  if (q.from.id !== ADMIN_ID) return bot.answerCallbackQuery(q.id, { text: '❌ Admin nahi ho', show_alert: true });
  await bot.answerCallbackQuery(q.id);

  if (cb === 'set_upi') {
    getUS(uid).step = 'set_upi';
    return sendMsg(chatId, '📱 Naya UPI ID bhejo:');
  }

  if (cb === 'set_qr') {
    getUS(uid).step = 'set_qr';
    return sendMsg(chatId, '🖼️ QR Code image bhejo:');
  }

  if (cb === 'set_fwd_ch') {
    getUS(uid).step = 'set_fwd_ch';
    return sendMsg(chatId, '📢 Forward channel/group ID ya @username bhejo:\n(e.g. @MyGroup ya -1001234567890)\n\nBot ko us channel/group ka admin banana padega!');
  }

  if (cb === 'admin_startgame') {
    if (state.gameActive) return sendMsg(chatId, '⚠️ Game already running');
    state.currentRound = 0;
    startGameLoop();
    return sendMsg(chatId, '✅ Game started! Users 🎮 Play dabake khel sakte hain.');
  }

  if (cb === 'admin_stopgame') {
    await stopGame(chatId);
    return;
  }

  if (cb === 'admin_stats') {
    const totalUsers = await User.countDocuments();
    const agg = await User.aggregate([{ $group: { _id: null, dep: { $sum: '$deposit' }, win: { $sum: '$winning' }, bon: { $sum: '$bonus' } } }]);
    const totals = agg[0] || { dep: 0, win: 0, bon: 0 };
    return sendMsg(chatId,
      `📊 FULL STATS\n━━━━━━━━━━━━━━━━\n👥 Total Users: ${totalUsers}\n🏦 Total Deposits: ₹${totals.dep}\n💸 Total Winnings: ₹${totals.win}\n🎁 Total Bonus: ₹${totals.bon}\n🎲 Active Bets (this round): ${state.pendingBets.size}`
    );
  }

  if (cb === 'admin_backup') {
    // Export all users as JSON summary
    const users = await User.find({}, '-__v').lean();
    const summary = JSON.stringify(users, null, 2);
    const buf = Buffer.from(summary);
    await bot.sendDocument(ADMIN_ID, buf, {}, { filename: `rtf_backup_${Date.now()}.json`, contentType: 'application/json' });
    return sendMsg(chatId, '✅ Backup file bhej diya!');
  }
}));

// ══════════════════════════════════════════
//   ADMIN COMMANDS
// ══════════════════════════════════════════

bot.onText(/\/admin/, safe(async (msg) => {
  if (msg.from.id !== ADMIN_ID) return sendMsg(msg.chat.id, '❌ Admin nahi ho');

  const s = await Settings.find({}).lean();
  const settingsMap = Object.fromEntries(s.map(x => [x.key, x.value]));
  const gameStatus = state.gameActive ? '🟢 RUNNING' : '🔴 STOPPED';
  const seqIdx = state.currentRound % RESULT_SEQUENCE.length;

  await sendMsg(msg.chat.id,
    `⚙️ ADMIN PANEL\n━━━━━━━━━━━━━━━━\n👥 Users: ${await User.countDocuments()}\n🎮 Game: ${gameStatus}\n🎲 Active Bets: ${state.pendingBets.size}\n👁️ Active Players: ${state.activePlayers.size}\n🚫 Opted Out: ${state.optedOut.size}\n🔢 Round: #${state.currentRound + 1}\n🎯 Next Result: ${RESULT_SEQUENCE[seqIdx].toUpperCase()}\n━━━━━━━━━━━━━━━━\n📱 UPI: ${settingsMap.upi_id || process.env.DEFAULT_UPI_ID}\n🖼️ QR: ${settingsMap.qr_file_id ? '✅ Set' : '❌ Not Set'}\n📢 Forward Ch: ${settingsMap.forward_channel || '❌ Not Set'}\n━━━━━━━━━━━━━━━━`,
    { reply_markup: { inline_keyboard: [
      [{ text: '📱 Change UPI ID', callback_data: 'set_upi' }, { text: '🖼️ Set QR Code', callback_data: 'set_qr' }],
      [{ text: '📢 Set Forward Channel', callback_data: 'set_fwd_ch' }],
      [{ text: '▶️ Start Game', callback_data: 'admin_startgame' }, { text: '⏹️ Stop Game', callback_data: 'admin_stopgame' }],
      [{ text: '📊 Stats', callback_data: 'admin_stats' }, { text: '💾 Backup DB', callback_data: 'admin_backup' }]
    ] } }
  );
}));

bot.onText(/\/startgame/, safe(async (msg) => {
  if (msg.from.id !== ADMIN_ID) return sendMsg(msg.chat.id, '❌ Admin nahi ho');
  if (state.gameActive) return sendMsg(msg.chat.id, '⚠️ Game already running');
  state.currentRound = 0;
  startGameLoop();
  sendMsg(msg.chat.id, '✅ Game started!');
}));

bot.onText(/\/stopgame/, safe(async (msg) => {
  if (msg.from.id !== ADMIN_ID) return sendMsg(msg.chat.id, '❌ Admin nahi ho');
  await stopGame(msg.chat.id);
}));

bot.onText(/\/all (.+)/, safe(async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const text = match[1];
  const users = await User.find({}, 'uid');
  let sent = 0, failed = 0;
  for (const u of users) {
    const ok = await sendMsg(u.uid, text);
    ok ? sent++ : failed++;
    await sleep(50); // rate limit safety
  }
  sendMsg(msg.chat.id, `📢 Done\n✅ Sent: ${sent}\n❌ Failed: ${failed}`);
}));

bot.onText(/\/send (.+)/, safe(async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(' ');
  const target = parts[0];
  const text = parts.slice(1).join(' ');
  let tUid = target;
  if (target.startsWith('@')) {
    const u = await User.findOne({ username: target.slice(1) });
    if (!u) return sendMsg(msg.chat.id, '❌ Username not found');
    tUid = u.uid;
  }
  const ok = await sendMsg(tUid, text);
  sendMsg(msg.chat.id, ok ? '✅ Sent' : '❌ Failed');
}));

bot.onText(/\/add (.+)/, safe(async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const [uid, amtStr, wallet] = match[1].split(' ');
  const amt = parseInt(amtStr);
  if (!['deposit','bonus','winning'].includes(wallet)) return sendMsg(msg.chat.id, '❌ /add <uid> <amount> <deposit|bonus|winning>');
  const u = await User.findOne({ uid });
  if (!u) return sendMsg(msg.chat.id, '❌ User not found');
  u[wallet] += amt;
  await u.save();
  await sendMsg(uid, `💰 Admin ne ₹${amt} ${wallet} me add kiya!`);
  sendMsg(msg.chat.id, `✅ ₹${amt} added to ${uid} ${wallet}`);
}));

bot.onText(/\/daily/, safe(async (msg) => {
  const uid = String(msg.from.id);
  await dailyBonus(msg.chat.id, uid, msg.from);
}));

// ══════════════════════════════════════════
//   GAME LOOP
// ══════════════════════════════════════════

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function startGameLoop() {
  state.gameActive = true;
  if (state.gameTimer) clearTimeout(state.gameTimer);
  runRound();
}

async function runRound() {
  if (!state.gameActive) return;

  const roundNum   = state.currentRound;
  const result     = RESULT_SEQUENCE[roundNum % RESULT_SEQUENCE.length];
  state.roundEndTime = Date.now() + ROUND_TIME * 1000;
  state.timerMsgIds.clear();
  state.pendingBets.clear();

  // Send opening message to all active non-opted-out players
  const toNotify = [...state.activePlayers].filter(uid => !state.optedOut.has(uid));
  const bar = timerBar(ROUND_TIME);

  await Promise.all(toNotify.map(async (uid) => {
    try {
      const m = await sendMsg(uid,
        `🎮 ROUND #${roundNum + 1} ACTIVE!\n${bar}\n⏳ ${ROUND_TIME}s\n\n🔵 BIG  या  🔴 SMALL\n👇 🎮 Play dabao bet lagaane ke liye`,
        { reply_markup: { inline_keyboard: [[
          { text: '🔵 BIG',   callback_data: 'bet_big' },
          { text: '🔴 SMALL', callback_data: 'bet_small' }
        ]] } }
      );
      if (m) state.timerMsgIds.set(uid, m.message_id);
    } catch { state.activePlayers.delete(uid); }
  }));

  // Live countdown — update every 5s to stay within Telegram rate limits
  // For 40-50 users: edit in batches with small delays
  const UPDATE_INTERVAL = 5000; // every 5 seconds
  let elapsed = 0;

  while (elapsed < ROUND_TIME * 1000) {
    await sleep(UPDATE_INTERVAL);
    elapsed += UPDATE_INTERVAL;
    if (!state.gameActive) return;

    const remaining = Math.max(0, Math.round((state.roundEndTime - Date.now()) / 1000));
    const bar2 = timerBar(remaining);
    const allTimerUids = [...state.timerMsgIds.keys()];

    // Batch edits with small delay to avoid Telegram flood limits
    for (let i = 0; i < allTimerUids.length; i++) {
      const uid2 = allTimerUids[i];
      if (state.optedOut.has(uid2)) continue;
      const mid = state.timerMsgIds.get(uid2);
      const bet = state.pendingBets.get(uid2);

      try {
        if (bet) {
          const emoji = bet.choice === 'big' ? '🔵' : '🔴';
          const totalReturn = Math.round(bet.amount * WIN_MULT * 100) / 100;
          await editMsg(uid2, mid,
            `🎮 ROUND #${roundNum + 1}\n${bar2}\n⏳ ${remaining}s\n\n✅ Bet: ${emoji} ${bet.choice.toUpperCase()} ₹${bet.amount}\n🏆 Jeet gaye to: ₹${totalReturn}`
          );
        } else {
          await editMsg(uid2, mid,
            `🎮 ROUND #${roundNum + 1}\n${bar2}\n⏳ ${remaining}s\n\n🔵 BIG  या  🔴 SMALL\n👇 🎮 Play dabao bet lagaane ke liye`,
            { reply_markup: { inline_keyboard: [[
              { text: '🔵 BIG',   callback_data: 'bet_big' },
              { text: '🔴 SMALL', callback_data: 'bet_small' }
            ]] } }
          );
        }
      } catch { /* message too old or deleted */ }

      // Stagger edits: 50ms between each to avoid rate limits with 40-50 users
      if (i % 10 === 9) await sleep(50);
    }
  }

  if (!state.gameActive) return;

  // ── Settle bets ──
  const betsThisRound = new Map(state.pendingBets);
  state.pendingBets.clear();

  const realBigTotal   = [...betsThisRound.values()].filter(b => b.choice === 'big').reduce((s, b) => s + b.amount, 0);
  const realSmallTotal = [...betsThisRound.values()].filter(b => b.choice === 'small').reduce((s, b) => s + b.amount, 0);

  // Fake display stats
  const fakeBigPool   = Math.floor(Math.random() * 700 + 200);
  const fakeSmallPool = Math.floor(Math.random() * 700 + 200);
  const fakeTotalBets = Math.floor(Math.random() * 12 + 30);
  const fakeWinners   = Math.floor(Math.random() * 7 + 14);
  const displayBig    = fakeBigPool   + realBigTotal;
  const displaySmall  = fakeSmallPool + realSmallTotal;
  const displayTotal  = fakeTotalBets + betsThisRound.size;
  const resultEmoji   = result === 'big' ? '🔵' : '🔴';

  let realWinners = 0;
  const betOps = [];
  for (const [uid2, b] of betsThisRound) {
    const totalReturn = Math.round(b.amount * WIN_MULT * 100) / 100;
    const netProfit   = Math.round((totalReturn - b.amount) * 100) / 100;
    const won = b.choice === result;

    betOps.push(Bet.create({
      uid: uid2, round: roundNum, choice: b.choice,
      amount: b.amount, stakeFrom: b.stakeFrom,
      result: won ? 'win' : 'loss',
      payout: won ? totalReturn : 0
    }).catch(() => {}));

    if (won) {
      realWinners++;
      betOps.push(User.findOneAndUpdate({ uid: uid2 }, { $inc: { winning: totalReturn } }).catch(() => {}));
      if (!state.optedOut.has(uid2)) {
        betOps.push(sendMsg(uid2,
          `🏆 JEET GAYE!\n━━━━━━━━━━━━━━━━\n💰 Bet: ₹${b.amount}\n🎉 Total Return: ₹${totalReturn}\n💵 Net Profit: +₹${netProfit}`
        ));
      }
    } else {
      if (!state.optedOut.has(uid2)) {
        betOps.push(sendMsg(uid2, '💔 Is baar nahi hua. Agli baar try karo! 🎮'));
      }
    }
  }
  await Promise.all(betOps);

  // Broadcast result to active players
  const resultText = `🎯 ROUND #${roundNum + 1} RESULT\n━━━━━━━━━━━━━━━━━━━━\n${resultEmoji} WINNER: ${result.toUpperCase()}\n━━━━━━━━━━━━━━━━━━━━\n🔵 Big Pool:   ₹${displayBig}\n🔴 Small Pool: ₹${displaySmall}\n🎮 Total Bets: ${displayTotal}\n🏆 Winners:    ${fakeWinners + realWinners}\n━━━━━━━━━━━━━━━━━━━━\n⏳ Next round ${BREAK_TIME}s me...`;

  await Promise.all(
    [...state.activePlayers]
      .filter(uid2 => !state.optedOut.has(uid2))
      .map(uid2 => sendMsg(uid2, resultText))
  );

  state.currentRound++;

  // Break between rounds
  await sleep(BREAK_TIME * 1000);

  if (state.gameActive) runRound(); // tail-call next round
}

async function stopGame(chatId) {
  state.gameActive = false;

  // Settle any remaining bets with next sequence result
  if (state.pendingBets.size > 0) {
    const result = RESULT_SEQUENCE[state.currentRound % RESULT_SEQUENCE.length];
    for (const [uid2, b] of state.pendingBets) {
      const totalReturn = Math.round(b.amount * WIN_MULT * 100) / 100;
      if (b.choice === result) {
        await User.findOneAndUpdate({ uid: uid2 }, { $inc: { winning: totalReturn } });
        await sendMsg(uid2, `🏆 Final round win! ₹${totalReturn} credited.`);
      } else {
        await sendMsg(uid2, '❌ Final round: Haar gaye.');
      }
    }
    state.pendingBets.clear();
  }

  for (const uid2 of state.activePlayers) {
    if (!state.optedOut.has(uid2)) await sendMsg(uid2, '🛑 Game band ho gaya. Phir milenge!');
  }
  state.activePlayers.clear();

  if (chatId) await sendMsg(chatId, '🛑 Game stop ho gaya. Sab bets settle ho gayi.');
}

// ══════════════════════════════════════════
//   STARTUP
// ══════════════════════════════════════════

(async () => {
  await connectDB();
  console.log('✅ RTF Gaming Bot v2 (Node.js) running...');
})();
