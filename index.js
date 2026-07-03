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
const PORT       = process.env.PORT || 3000;

// ── Bot init ──
const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: { timeout: 10, allowed_updates: ['message', 'callback_query'] }
  }
});

// ── Keep-alive server ──
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
💸 Min Withdrawal: ₹50
🛡️ Play responsibly

👑 OWNER: @RTFGAMMING
📢 CHANNEL: @RTFGAMINGHACK0
✨ READY TO WIN BIG ✨`;

// ══════════════════════════════════════════
//   USER STATE MAP
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

async function getForceChannels() {
  let channels = await getSetting('force_channels');
  if (!channels || !Array.isArray(channels) || channels.length === 0) {
    const envChannels = (process.env.CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (envChannels.length) {
      await setSetting('force_channels', envChannels);
      return envChannels;
    }
    return [];
  }
  return channels;
}

async function checkChannels(userId) {
  const channels = await getForceChannels();
  const missing = [];
  for (const ch of channels) {
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
    '╔═══〔 🔥 JOIN REQUIRED 〕═══╗\n🚀 Bot use karne ke liye sabhi channels join karo!\n\n👉 Neeche diye links se join karo\n✅ Join karne ke baad "I Joined" dabao\n╚══════════════════════╝',
    { reply_markup: { inline_keyboard: buttons } }
  );
}

// ── Global force-join middleware — user ke kisi bhi action pe check ──
// Returns true if user is blocked (not joined), false if allowed
async function requireJoin(chatId, userId) {
  // Admin ko kabhi block mat karo
  if (userId === ADMIN_ID) return false;
  const missing = await checkChannels(userId);
  if (missing.length) {
    await sendForceJoin(chatId, missing);
    return true; // blocked
  }
  return false; // allowed
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
//   LEADERBOARD — total balance se sort (FIX)
// ══════════════════════════════════════════

async function showLeaderboard(chatId) {
  // Total balance = deposit + bonus + winning — isi se sort karo
  const users = await User.aggregate([
    {
      $addFields: {
        totalBalance: { $add: ['$deposit', '$bonus', '$winning'] }
      }
    },
    { $sort: { totalBalance: -1 } },
    { $limit: 10 }
  ]);

  if (!users.length) return sendMsg(chatId, '📊 Abhi koi data nahi hai!');

  let text = '🏆 TOP 10 LEADERBOARD\n━━━━━━━━━━━━━━━━━━━━\n';
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

  users.forEach((u, i) => {
    const total = (u.deposit || 0) + (u.bonus || 0) + (u.winning || 0);
    const name = u.name || 'Unknown';
    text += `${medals[i]} ${name}\n    💰 Total Balance: ₹${total} | 💸 Winning: ₹${u.winning || 0}\n`;
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
//   PLAY PANEL
// ══════════════════════════════════════════

async function showPlayPanel(chatId, uid) {
  const u = await User.findOne({ uid });
  if (!u) return sendMsg(chatId, '❌ /start karo pehle');
  if (!state.gameActive) return sendMsg(chatId, '❌ Game abhi active nahi hai\n⏳ Admin ke game start karne ka wait karo');

  state.optedOut.delete(uid);
  state.activePlayers.add(uid);

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
//   DEPOSIT / WITHDRAW
// ══════════════════════════════════════════

async function startDeposit(chatId, uid) {
  getUS(uid).step = 'dep_amount';
  await sendMsg(chatId, '💰 Kitna deposit karna hai? (min ₹10)');
}

async function startWithdraw(chatId, uid) {
  getUS(uid).step = 'wd_amount';
  await sendMsg(chatId, '💸 Withdrawal amount enter karo (min ₹50):');
}

// ══════════════════════════════════════════
//   DAILY BONUS
// ══════════════════════════════════════════

async function dailyBonus(chatId, uid, from) {
  const u = await getUser(uid, from);
  const today = new Date().toISOString().split('T')[0];
  if (u.last_bonus === today) return sendMsg(chatId, '❌ Aaj ka bonus le chuke ho. Kal aana! 😊');

  const bonusAmount = Number(await getSetting('daily_bonus')) || 3;
  u.bonus += bonusAmount;
  u.last_bonus = today;
  await u.save();
  await sendMsg(chatId, `🎁 ₹${bonusAmount} daily bonus add ho gaya!`);
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

  // ── Ban check ──
  if (String(from.id) !== String(ADMIN_ID)) {
    const checkUser = await User.findOne({ uid });
    if (checkUser && checkUser.banned) {
      return sendMsg(chatId, '🚫 Aapko is bot se ban kar diya gaya hai. Admin se contact karo.');
    }
  }

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

        // ── FIX: referred_by me naam ya username save karo ──
        // Jo available ho — username prefer karo, warna naam
        const referredByLabel = refUser.username
          ? `@${refUser.username}`
          : (refUser.name || refUser.uid);
        await User.findOneAndUpdate({ uid }, { referred_by: referredByLabel });

        await sendMsg(us.pendingRef,
          `🎉 REFERRAL CONFIRMED!\n━━━━━━━━━━━━━━━━\n👤 ${u.name} ne join kiya!\n💰 +₹1 Referral Balance add ho gaya!\n━━━━━━━━━━━━━━━━\n👥 Total Referrals: ${refUser.referral_count}\n💵 Total Referral Balance: ₹${refUser.referral}`
        );
      }
      delete us.pendingRef;
    }

    return sendMsg(chatId, `✅ Contact verified! Welcome ${from.first_name}!\nAb aap game khel sakte ho! 🎮`, { reply_markup: mainKb() });
  }

  // ── Admin: Broadcast — capture ANY content type (text/photo/video/gif/sticker/doc/voice/emoji) ──
  if (String(from.id) === String(ADMIN_ID) && getUS(uid).step === 'broadcast_wait') {
    const us = getUS(uid);
    const totalUsers = await User.countDocuments({ banned: { $ne: true } });
    if (totalUsers === 0) {
      clearUS(uid);
      return sendMsg(chatId, '❌ Koi active user nahi hai broadcast ke liye.');
    }
    us.step = 'broadcast_confirm';
    us.broadcastFromChat = chatId;
    us.broadcastMsgId = msg.message_id;
    return sendMsg(chatId,
      `📢 Preview upar hi hai (jo abhi bheja).\n\n👥 Ye message ${totalUsers} users ko jayega.\n\nConfirm karo:`,
      { reply_markup: { inline_keyboard: [
        [{ text: '✅ Sabko Bhejo', callback_data: 'broadcast_confirm_yes' }, { text: '❌ Cancel', callback_data: 'broadcast_confirm_no' }]
      ] } }
    );
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

  // ── Menu buttons — force join check on every button (non-admin) ──
  const menuButtons = ['🎮 Play','💰 Balance','➕ Deposit','➖ Withdraw','👥 Refer','🎁 Daily Bonus','🏆 Leaderboard','🛑 Stop Game Notifications'];
  if (menuButtons.includes(txt) && String(from.id) !== String(ADMIN_ID)) {
    const blocked = await requireJoin(chatId, msg.from.id);
    if (blocked) return;
  }

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
    // Force join check before bet
    if (String(from.id) !== String(ADMIN_ID)) {
      const blocked = await requireJoin(chatId, msg.from.id);
      if (blocked) return clearUS(uid);
    }

    const amt = parseInt(txt);
    if (isNaN(amt) || amt < 1) return sendMsg(chatId, '❌ Min bet ₹1 hai, valid number enter karo');
    if (!state.gameActive)     return (clearUS(uid), sendMsg(chatId, '❌ Game active nahi'));

    const remaining = getRemainingSeconds();
    if (remaining <= 0) return (clearUS(uid), sendMsg(chatId, '❌ Betting time khatam ho gaya!'));
    if (state.pendingBets.has(uid)) return (clearUS(uid), sendMsg(chatId, '❌ Already bet place ho chuki hai'));

    const u = await User.findOne({ uid });
    const total = await getBalance(u);
    if (total < amt) return sendMsg(chatId, `❌ Balance kam hai. Total: ₹${total}`);

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
    state.pendingBets.set(uid, { choice, amount: amt, stakeFrom, name: from.first_name, username: from.username || null });
    clearUS(uid);

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
    if (isNaN(amt) || amt < 50) return sendMsg(chatId, '❌ Min ₹50 withdraw karo');
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

    const txn = await Transaction.create({ uid, type: 'withdrawal', amount: amt, upi_id: upiAddr, status: 'pending' });

    const forwardCh = await getSetting('forward_channel');
    const adminKb = { inline_keyboard: [[
      { text: '✅ Pay',     callback_data: `w_ok_${uid}_${amt}_${txn._id}` },
      { text: '❌ Reject',  callback_data: `w_no_${uid}_${amt}_${txn._id}` },
      { text: '👤 Profile', callback_data: `profile_${uid}` }
    ]] };
    const wdText = `💸 WITHDRAWAL REQUEST\n━━━━━━━━━━━━━━━━\n👤 ${u.name}  |  @${u.username || 'N/A'}\n🆔 ID: ${uid}\n💵 Amount: ₹${amt}\n📱 UPI: ${upiAddr}\n━━━━━━━━━━━━━━━━`;

    await sendMsg(ADMIN_ID, wdText, { reply_markup: adminKb });

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

  // ── Admin: set daily bonus ──
  if (us.step === 'set_daily_bonus' && String(from.id) === String(ADMIN_ID)) {
    const amt = parseFloat(txt);
    if (isNaN(amt) || amt < 0) return sendMsg(chatId, '❌ Valid amount (e.g. 5) enter karo.');
    await setSetting('daily_bonus', amt);
    clearUS(uid);
    return sendMsg(chatId, `✅ Daily bonus set to ₹${amt}`);
  }

  // ── Admin: add channel ──
  if (us.step === 'add_channel' && String(from.id) === String(ADMIN_ID)) {
    let ch = txt.trim();
    if (!ch.startsWith('@') && !ch.startsWith('-')) ch = '@' + ch;
    const current = (await getSetting('force_channels')) || [];
    if (current.includes(ch)) return sendMsg(chatId, `❌ ${ch} already in list.`);
    current.push(ch);
    await setSetting('force_channels', current);
    clearUS(uid);
    return sendMsg(chatId, `✅ Channel ${ch} added to force‑join list.`);
  }

  // ── Admin: DM user — enter target UID ──
  if (us.step === 'dm_uid' && String(from.id) === String(ADMIN_ID)) {
    let tUid = txt.trim();
    if (tUid.startsWith('@')) {
      const found = await User.findOne({ username: tUid.slice(1) });
      if (!found) return sendMsg(chatId, '❌ Username nahi mila. Seedha UID number do.');
      tUid = found.uid;
    }
    const found = await User.findOne({ uid: tUid });
    if (!found) return sendMsg(chatId, '❌ User not found. Sahi UID do.');
    us.step = 'dm_msg';
    us.dmTargetUid = tUid;
    return sendMsg(chatId, `✅ User: ${found.name} (${tUid})\n\n📝 Ab jo message bhejni ho wo type karo:`);
  }

  // ── Admin: DM user — enter message ──
  if (us.step === 'dm_msg' && String(from.id) === String(ADMIN_ID)) {
    const tUid = us.dmTargetUid;
    const ok = await sendMsg(tUid, `📩 Admin ka message:\n\n${txt}`);
    clearUS(uid);
    return sendMsg(chatId, ok ? `✅ Message bhej diya ${tUid} ko!` : `❌ Message nahi gaya (user ne block kiya hoga).`);
  }

  // ── Admin: balance edit — enter UID ──
  if (us.step === 'bal_uid' && String(from.id) === String(ADMIN_ID)) {
    let tUid = txt.trim();
    if (tUid.startsWith('@')) {
      const found = await User.findOne({ username: tUid.slice(1) });
      if (!found) return sendMsg(chatId, '❌ Username nahi mila.');
      tUid = found.uid;
    }
    const found = await User.findOne({ uid: tUid });
    if (!found) return sendMsg(chatId, '❌ User not found.');
    us.step = 'bal_action';
    us.balTargetUid = tUid;
    const total = await getBalance(found);
    return sendMsg(chatId,
      `👤 ${found.name} (${tUid})\n🏦 Deposit: ₹${found.deposit} | 🎁 Bonus: ₹${found.bonus} | 💸 Winning: ₹${found.winning}\n💰 Total: ₹${total}\n\n📝 Format: <wallet> <+/-amount>\nExample: winning +500  ya  deposit -200\nWallets: deposit / bonus / winning`,
    );
  }

  // ── Admin: balance edit — apply change ──
  if (us.step === 'bal_action' && String(from.id) === String(ADMIN_ID)) {
    const parts = txt.trim().split(/\s+/);
    if (parts.length !== 2) return sendMsg(chatId, '❌ Format galat hai. Example: winning +500');
    const wallet = parts[0].toLowerCase();
    if (!['deposit','bonus','winning'].includes(wallet)) return sendMsg(chatId, '❌ Wallet: deposit / bonus / winning');
    const change = parseFloat(parts[1]);
    if (isNaN(change)) return sendMsg(chatId, '❌ Amount sahi nahi hai. Example: +500 ya -200');
    const tUid = us.balTargetUid;
    const u = await User.findOne({ uid: tUid });
    if (!u) return sendMsg(chatId, '❌ User not found.');
    const before = u[wallet];
    u[wallet] = Math.max(0, u[wallet] + change);
    await u.save();
    clearUS(uid);
    const sign = change >= 0 ? '+' : '';
    await sendMsg(tUid, `💰 Admin ne aapka balance update kiya:\n${wallet}: ₹${before} → ₹${u[wallet]}`);
    return sendMsg(chatId, `✅ Done!\n${tUid} ka ${wallet}: ₹${before} → ₹${u[wallet]} (${sign}${change})`);
  }

  // ── Admin: ban user — enter UID ──
  if (us.step === 'ban_uid' && String(from.id) === String(ADMIN_ID)) {
    let tUid = txt.trim();
    if (tUid.startsWith('@')) {
      const found = await User.findOne({ username: tUid.slice(1) });
      if (!found) return sendMsg(chatId, '❌ Username nahi mila.');
      tUid = found.uid;
    }
    const u = await User.findOne({ uid: tUid });
    if (!u) return sendMsg(chatId, '❌ User not found.');
    u.banned = true;
    await u.save();
    clearUS(uid);
    await sendMsg(tUid, '🚫 Aapko is bot se ban kar diya gaya hai.');
    return sendMsg(chatId,
      `✅ User ban ho gaya!\n👤 ${u.name} (${tUid})\n\nUnban karne ke liye:\n/unban ${tUid}`
    );
  }
}));

// ── Photo handler for deposit screenshot ──
bot.on('photo', safe(async (msg) => {
  const uid    = String(msg.from.id);
  const chatId = msg.chat.id;
  const us     = getUS(uid);

  if (String(msg.from.id) === String(ADMIN_ID) && us.step === 'set_qr') {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    await setSetting('qr_file_id', fileId);
    clearUS(uid);
    return sendMsg(chatId, '✅ QR Code saved!');
  }

  if (us.step === 'dep_screenshot') {
    const amt   = us.depAmount;
    const bonus = calcDepositBonus(amt);
    const u     = await User.findOne({ uid });
    if (!u || !amt) return sendMsg(chatId, '❌ Amount missing, deposit restart karo');

    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const txn = await Transaction.create({ uid, type: 'deposit', amount: amt, screenshot_file_id: fileId, status: 'pending' });

    await bot.forwardMessage(ADMIN_ID, chatId, msg.message_id);

    const adminKb = { inline_keyboard: [[
      { text: '✅ Approve', callback_data: `d_ok_${uid}_${amt}_${txn._id}` },
      { text: '❌ Reject',  callback_data: `d_no_${uid}_${txn._id}` },
      { text: '👤 Profile', callback_data: `profile_${uid}` }
    ]] };
    const depText = `💰 DEPOSIT REQUEST\n━━━━━━━━━━━━━━━━\n👤 ${u.name}  |  @${u.username || 'N/A'}\n🆔 ID: ${uid}\n💵 Amount: ₹${amt}\n🎁 Bonus: ₹${bonus}\n━━━━━━━━━━━━━━━━`;

    await sendMsg(ADMIN_ID, depText, { reply_markup: adminKb });

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

  // ── Force join check on all non-admin callback actions (except check_join) ──
  if (q.from.id !== ADMIN_ID) {
    const missing = await checkChannels(q.from.id);
    if (missing.length) {
      await bot.answerCallbackQuery(q.id, { text: '❌ Pehle channels join karo!', show_alert: true });
      await sendForceJoin(chatId, missing);
      return;
    }
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
      `👤 USER PROFILE\n━━━━━━━━━━━━━━━━\n🆔 ID: ${tUid}\n👤 Name: ${u.name}\n🏷️ Username: @${u.username || 'N/A'}\n📱 Phone: ${u.phone || 'Not verified'}\n👥 Referred By: ${u.referred_by || 'Direct'}\n━━━━━━━━━━━━━━━━\n🏦 Deposit: ₹${u.deposit}\n🎁 Bonus:   ₹${u.bonus}\n💸 Winning: ₹${u.winning}\n👥 Referral: ₹${u.referral}\n💰 Total:   ₹${total}\n━━━━━━━━━━━━━━━━\n📅 Last Bonus: ${u.last_bonus || 'Never'}\n👥 Referrals Made: ${u.referral_count}`
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

  if (cb === 'set_daily_bonus') {
    getUS(uid).step = 'set_daily_bonus';
    return sendMsg(chatId, '💰 Daily bonus amount enter karo (e.g. 5):');
  }

  if (cb === 'manage_channels') {
    const channels = await getForceChannels();
    let text = '📢 CURRENT FORCE‑JOIN CHANNELS:\n';
    if (channels.length === 0) text += '(None)\n';
    else channels.forEach((ch, i) => { text += `${i+1}. ${ch}\n`; });
    text += '\nChoose action:';

    const buttons = [];
    if (channels.length > 0) {
      channels.forEach((ch, i) => {
        buttons.push([{ text: `❌ Remove ${ch}`, callback_data: `remove_ch_${i}` }]);
      });
    }
    buttons.push([{ text: '➕ Add Channel', callback_data: 'add_channel' }]);
    buttons.push([{ text: '🔙 Back', callback_data: 'admin_back' }]);
    return sendMsg(chatId, text, { reply_markup: { inline_keyboard: buttons } });
  }

  if (cb.startsWith('remove_ch_')) {
    const idx = parseInt(cb.split('_')[2]);
    const channels = await getForceChannels();
    if (idx < 0 || idx >= channels.length) return sendMsg(chatId, '❌ Invalid channel.');
    const removed = channels.splice(idx, 1);
    await setSetting('force_channels', channels);
    return sendMsg(chatId, `✅ Removed ${removed[0]}`);
  }

  if (cb === 'add_channel') {
    getUS(uid).step = 'add_channel';
    return sendMsg(chatId, '📢 Channel @username or ID bhejo (e.g. @mychannel)');
  }

  if (cb === 'admin_back') {
    return showAdminPanel(chatId);
  }

  if (cb === 'admin_dm') {
    getUS(uid).step = 'dm_uid';
    return sendMsg(chatId, '📩 Kis user ko message karna hai?\n\nUser ka UID ya @username bhejo:');
  }

  if (cb === 'toggle_force_result') {
    state.forceResultMode = !state.forceResultMode;
    const status = state.forceResultMode ? '🟢 ON' : '🔴 OFF';
    return sendMsg(chatId,
      `🎯 Force Result Mode: ${status}\n\n${state.forceResultMode
        ? '✅ Ab jis side PE KAM bet lagi hogi, wahi side jeetegi!'
        : '✅ Ab game apni normal sequence ke hisab se chalega.'}`
    );
  }

  if (cb === 'admin_balance_edit') {
    getUS(uid).step = 'bal_uid';
    return sendMsg(chatId, '💰 Kiska balance edit karna hai?\n\nUser ka UID ya @username bhejo:');
  }

  if (cb === 'admin_ban_user') {
    getUS(uid).step = 'ban_uid';
    return sendMsg(chatId, '🚫 Kise ban karna hai?\n\nUser ka UID ya @username bhejo:');
  }

  if (cb === 'admin_broadcast') {
    getUS(uid).step = 'broadcast_wait';
    return sendMsg(chatId,
      '📢 BROADCAST\n━━━━━━━━━━━━━━━━\nJo bhi bhejoge — text, photo, video, GIF, sticker, document, voice, ya emoji — wahi sabhi users ko forward ho jayega, exactly jaisa dikhega.\n\nEk hi message bhejo (caption ke saath ho to wo bhi chala jayega).\n\nCancel karne ke liye /admin bhejo.'
    );
  }

  if (cb === 'broadcast_confirm_yes') {
    const srcChatId = getUS(uid).broadcastFromChat;
    const srcMsgId  = getUS(uid).broadcastMsgId;
    clearUS(uid);
    if (!srcMsgId) return sendMsg(chatId, '❌ Broadcast expire ho gaya, dobara try karo.');
    const targets = await User.find({ banned: { $ne: true } }, 'uid').lean();
    if (targets.length === 0) return sendMsg(chatId, '❌ Koi active user nahi mila.');
    return runBroadcast(chatId, srcChatId, srcMsgId, targets);
  }

  if (cb === 'broadcast_confirm_no') {
    clearUS(uid);
    return sendMsg(chatId, '❌ Broadcast cancel kar diya.');
  }

  // ── NEW: View current round bets ──
  if (cb === 'admin_view_bets') {
    return showCurrentRoundBets(chatId);
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
    const bannedCount = await User.countDocuments({ banned: true });
    const agg = await User.aggregate([{ $group: { _id: null, dep: { $sum: '$deposit' }, win: { $sum: '$winning' }, bon: { $sum: '$bonus' } } }]);
    const totals = agg[0] || { dep: 0, win: 0, bon: 0 };
    return sendMsg(chatId,
      `📊 FULL STATS\n━━━━━━━━━━━━━━━━\n👥 Total Users: ${totalUsers}\n🚫 Banned Users: ${bannedCount}\n🏦 Total Deposits: ₹${totals.dep}\n💸 Total Winnings: ₹${totals.win}\n🎁 Total Bonus: ₹${totals.bon}\n🎲 Active Bets (this round): ${state.pendingBets.size}`
    );
  }

  if (cb === 'admin_backup') {
    const users = await User.find({}, '-__v').lean();
    const summary = JSON.stringify(users, null, 2);
    const buf = Buffer.from(summary);
    await bot.sendDocument(ADMIN_ID, buf, {}, { filename: `rtf_backup_${Date.now()}.json`, contentType: 'application/json' });
    return sendMsg(chatId, '✅ Backup file bhej diya!');
  }
}));

// ══════════════════════════════════════════
//   ADMIN: VIEW CURRENT ROUND BETS
// ══════════════════════════════════════════

async function showCurrentRoundBets(chatId) {
  if (!state.gameActive) return sendMsg(chatId, '❌ Game active nahi hai');
  if (state.pendingBets.size === 0) {
    return sendMsg(chatId, `🎮 ROUND #${state.currentRound + 1} — Abhi koi bet nahi aayi`);
  }

  let bigTotal = 0, smallTotal = 0;
  let bigBets = [], smallBets = [];

  for (const [betUid, b] of state.pendingBets) {
    // naam/username dono try karo
    const userInfo = await User.findOne({ uid: betUid }).catch(() => null);
    const label = userInfo
      ? (userInfo.username ? `@${userInfo.username}` : userInfo.name || betUid)
      : betUid;

    if (b.choice === 'big') {
      bigTotal += b.amount;
      bigBets.push(`  • ${label} — ₹${b.amount}`);
    } else {
      smallTotal += b.amount;
      smallBets.push(`  • ${label} — ₹${b.amount}`);
    }
  }

  const totalPool = bigTotal + smallTotal;
  let text = `📊 ROUND #${state.currentRound + 1} — BETS DETAIL\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `🔵 BIG — ₹${bigTotal} (${bigBets.length} bets)\n`;
  bigBets.forEach(b => text += b + '\n');
  text += `\n🔴 SMALL — ₹${smallTotal} (${smallBets.length} bets)\n`;
  smallBets.forEach(b => text += b + '\n');
  text += `\n💰 Total Pool: ₹${totalPool}\n`;
  text += `━━━━━━━━━━━━━━━━━━━━`;

  // Agar text bada ho to split karo
  if (text.length > 4000) {
    await sendMsg(chatId, text.slice(0, 4000));
    await sendMsg(chatId, text.slice(4000));
  } else {
    await sendMsg(chatId, text);
  }
}

// ══════════════════════════════════════════
//   ADMIN: BROADCAST
// ══════════════════════════════════════════

async function runBroadcast(adminChatId, srcChatId, srcMsgId, users) {
  await sendMsg(adminChatId, `🚀 Broadcast shuru ho gaya... (${users.length} users)`);

  let sent = 0, failed = 0, blocked = 0;
  const BATCH_SIZE = 25;
  const BATCH_DELAY_MS = 1000; // Telegram rate limit: ~30 msgs/sec safe margin

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (u) => {
      try {
        await bot.copyMessage(u.uid, srcChatId, srcMsgId);
        sent++;
      } catch (e) {
        const desc = e.response?.body?.description || e.message || '';
        if (/blocked|deactivated|not found|chat not found|kicked/i.test(desc)) blocked++;
        else failed++;
      }
    }));

    if (i + BATCH_SIZE < users.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  await sendMsg(adminChatId,
    `✅ BROADCAST COMPLETE\n━━━━━━━━━━━━━━━━\n📤 Sent: ${sent}\n🚫 Blocked/Inactive: ${blocked}\n❌ Failed (other): ${failed}\n👥 Total Targeted: ${users.length}\n━━━━━━━━━━━━━━━━`
  );
}

// ── Helper to show admin panel ──
async function showAdminPanel(chatId) {
  const s = await Settings.find({}).lean();
  const settingsMap = Object.fromEntries(s.map(x => [x.key, x.value]));
  const gameStatus = state.gameActive ? '🟢 RUNNING' : '🔴 STOPPED';
  const seqIdx = state.currentRound % RESULT_SEQUENCE.length;
  const dailyBonus = settingsMap.daily_bonus || 3;
  const channels = (await getForceChannels()).join(', ') || '(None)';
  const forceMode = state.forceResultMode ? '🟢 ON (Kam bet jeetegi)' : '🔴 OFF (Normal)';
  const remaining = state.gameActive ? getRemainingSeconds() : 0;

  await sendMsg(chatId,
    `⚙️ ADMIN PANEL\n━━━━━━━━━━━━━━━━\n👥 Users: ${await User.countDocuments()}\n🎮 Game: ${gameStatus}\n🎲 Active Bets This Round: ${state.pendingBets.size}\n⏳ Time Remaining: ${state.gameActive ? remaining + 's' : 'N/A'}\n👁️ Active Players: ${state.activePlayers.size}\n🚫 Opted Out: ${state.optedOut.size}\n🔢 Round: #${state.currentRound + 1}\n🎯 Next Result: ${RESULT_SEQUENCE[seqIdx].toUpperCase()}\n🃏 Force Result: ${forceMode}\n━━━━━━━━━━━━━━━━\n📱 UPI: ${settingsMap.upi_id || process.env.DEFAULT_UPI_ID}\n🖼️ QR: ${settingsMap.qr_file_id ? '✅ Set' : '❌ Not Set'}\n📢 Forward Ch: ${settingsMap.forward_channel || '❌ Not Set'}\n💰 Daily Bonus: ₹${dailyBonus}\n📢 Force Channels: ${channels}\n━━━━━━━━━━━━━━━━`,
    { reply_markup: { inline_keyboard: [
      [{ text: '📱 Change UPI ID', callback_data: 'set_upi' }, { text: '🖼️ Set QR Code', callback_data: 'set_qr' }],
      [{ text: '📢 Set Forward Channel', callback_data: 'set_fwd_ch' }],
      [{ text: '💰 Set Daily Bonus', callback_data: 'set_daily_bonus' }, { text: '📢 Manage Channels', callback_data: 'manage_channels' }],
      [{ text: '▶️ Start Game', callback_data: 'admin_startgame' }, { text: '⏹️ Stop Game', callback_data: 'admin_stopgame' }],
      [{ text: '📊 Stats', callback_data: 'admin_stats' }, { text: '💾 Backup DB', callback_data: 'admin_backup' }],
      [{ text: '📩 DM User', callback_data: 'admin_dm' }, { text: '💰 Edit Balance', callback_data: 'admin_balance_edit' }],
      [{ text: state.forceResultMode ? '🟢 Force Result: ON' : '🔴 Force Result: OFF', callback_data: 'toggle_force_result' }],
      [{ text: '🚫 Ban User', callback_data: 'admin_ban_user' }],
      [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }],
      [{ text: '🎲 View Current Round Bets', callback_data: 'admin_view_bets' }]
    ] } }
  );
}

// ══════════════════════════════════════════
//   ADMIN COMMANDS
// ══════════════════════════════════════════

bot.onText(/\/admin/, safe(async (msg) => {
  if (msg.from.id !== ADMIN_ID) return sendMsg(msg.chat.id, '❌ Admin nahi ho');
  await showAdminPanel(msg.chat.id);
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

bot.onText(/\/bets/, safe(async (msg) => {
  if (msg.from.id !== ADMIN_ID) return sendMsg(msg.chat.id, '❌ Admin nahi ho');
  await showCurrentRoundBets(msg.chat.id);
}));

bot.onText(/\/ban (.+)/, safe(async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return sendMsg(msg.chat.id, '❌ Admin nahi ho');
  let tUid = match[1].trim();
  if (tUid.startsWith('@')) {
    const found = await User.findOne({ username: tUid.slice(1) });
    if (!found) return sendMsg(msg.chat.id, '❌ Username nahi mila');
    tUid = found.uid;
  }
  const u = await User.findOne({ uid: tUid });
  if (!u) return sendMsg(msg.chat.id, '❌ User not found');
  u.banned = true;
  await u.save();
  await sendMsg(tUid, '🚫 Aapko is bot se ban kar diya gaya hai.');
  sendMsg(msg.chat.id, `✅ User ${u.name} (${tUid}) ban ho gaya!`);
}));

bot.onText(/\/unban (.+)/, safe(async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return sendMsg(msg.chat.id, '❌ Admin nahi ho');
  let tUid = match[1].trim();
  if (tUid.startsWith('@')) {
    const found = await User.findOne({ username: tUid.slice(1) });
    if (!found) return sendMsg(msg.chat.id, '❌ Username nahi mila');
    tUid = found.uid;
  }
  const u = await User.findOne({ uid: tUid });
  if (!u) return sendMsg(msg.chat.id, '❌ User not found');
  u.banned = false;
  await u.save();
  await sendMsg(tUid, '✅ Aapka ban hata diya gaya hai! Ab aap bot use kar sakte ho.');
  sendMsg(msg.chat.id, `✅ User ${u.name} (${tUid}) unban ho gaya!`);
}));

bot.onText(/\/all (.+)/, safe(async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const text = match[1];
  const users = await User.find({}, 'uid');
  let sent = 0, failed = 0;
  for (const u of users) {
    const ok = await sendMsg(u.uid, text);
    ok ? sent++ : failed++;
    await sleep(50);
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
//   GAME LOOP — RESULT TIMING FIX
//   60s betting window → result 5-10s baad
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

  // ── Timer update loop — har 5s pe update ──
  const UPDATE_INTERVAL = 5000;
  let elapsed = 0;

  while (elapsed < ROUND_TIME * 1000) {
    await sleep(UPDATE_INTERVAL);
    elapsed += UPDATE_INTERVAL;
    if (!state.gameActive) return;

    const remaining = Math.max(0, Math.round((state.roundEndTime - Date.now()) / 1000));
    const bar2 = timerBar(remaining);
    const allTimerUids = [...state.timerMsgIds.keys()];

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
      } catch { /* ignore */ }

      if (i % 10 === 9) await sleep(50);
    }
  }

  if (!state.gameActive) return;

  // ── FIX: Time khatam hote hi IMMEDIATELY 7s ka countdown dikhao ──
  // Users ko pata chale ki result aane wala hai
  const countdownSecs = 7;
  await Promise.all(
    [...state.timerMsgIds.keys()]
      .filter(uid2 => !state.optedOut.has(uid2))
      .map(uid2 => {
        const mid = state.timerMsgIds.get(uid2);
        return editMsg(uid2, mid,
          `🎮 ROUND #${roundNum + 1}\n⏳ Betting band!\n⚡ Result ${countdownSecs}s me aayega...`
        ).catch(() => {});
      })
  );

  // 7 seconds wait — then result
  await sleep(countdownSecs * 1000);

  if (!state.gameActive) return;

  // ── Settle bets ──
  const betsThisRound = new Map(state.pendingBets);
  state.pendingBets.clear();

  const realBigTotal   = [...betsThisRound.values()].filter(b => b.choice === 'big').reduce((s, b) => s + b.amount, 0);
  const realSmallTotal = [...betsThisRound.values()].filter(b => b.choice === 'small').reduce((s, b) => s + b.amount, 0);

  let finalResult = result;
  if (state.forceResultMode && betsThisRound.size > 0) {
    if (realBigTotal === 0 && realSmallTotal === 0) {
      finalResult = result;
    } else if (realBigTotal === 0) {
      finalResult = 'big';
    } else if (realSmallTotal === 0) {
      finalResult = 'small';
    } else {
      finalResult = realBigTotal < realSmallTotal ? 'big' : 'small';
    }
  }

  const fakeBigPool   = Math.floor(Math.random() * 700 + 200);
  const fakeSmallPool = Math.floor(Math.random() * 700 + 200);
  const fakeTotalBets = Math.floor(Math.random() * 12 + 30);
  const fakeWinners   = Math.floor(Math.random() * 7 + 14);
  const displayBig    = fakeBigPool   + realBigTotal;
  const displaySmall  = fakeSmallPool + realSmallTotal;
  const displayTotal  = fakeTotalBets + betsThisRound.size;
  const resultEmoji   = finalResult === 'big' ? '🔵' : '🔴';

  let realWinners = 0;
  const betOps = [];
  for (const [uid2, b] of betsThisRound) {
    const totalReturn = Math.round(b.amount * WIN_MULT * 100) / 100;
    const netProfit   = Math.round((totalReturn - b.amount) * 100) / 100;
    const won = b.choice === finalResult;

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

  // ── Admin ko bhi result notify karo ──
  const adminResultText = `🎯 ROUND #${roundNum + 1} RESULT (ADMIN)\n━━━━━━━━━━━━━━━━\n${resultEmoji} RESULT: ${finalResult.toUpperCase()}\n🔵 Big: ₹${realBigTotal} | 🔴 Small: ₹${realSmallTotal}\n🏆 Real Winners: ${realWinners}/${betsThisRound.size}`;
  sendMsg(ADMIN_ID, adminResultText).catch(() => {});

  const resultText = `🎯 ROUND #${roundNum + 1} RESULT\n━━━━━━━━━━━━━━━━━━━━\n${resultEmoji} WINNER: ${finalResult.toUpperCase()}\n━━━━━━━━━━━━━━━━━━━━\n🔵 Big Pool:   ₹${displayBig}\n🔴 Small Pool: ₹${displaySmall}\n🎮 Total Bets: ${displayTotal}\n🏆 Winners:    ${fakeWinners + realWinners}\n━━━━━━━━━━━━━━━━━━━━\n⏳ Next round ${BREAK_TIME}s me...`;

  await Promise.all(
    [...state.activePlayers]
      .filter(uid2 => !state.optedOut.has(uid2))
      .map(uid2 => sendMsg(uid2, resultText))
  );

  state.currentRound++;

  await sleep(BREAK_TIME * 1000);

  if (state.gameActive) runRound();
}

async function stopGame(chatId) {
  state.gameActive = false;

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
