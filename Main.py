import json
import os
import asyncio
from telegram import *
from telegram.ext import *
from telegram.ext import filters

TOKEN = "8605538011:AAEpwg_oeJ3r9ob7zNJZWp5HZ5y2_2T4Kgo"
ADMIN_ID = 6346250222
CHANNELS = ["@RTFGMINGGC", "@RTFGAMINGHACK0"]
UPI_ID = "70497398@axl"

# Change the file name to "data2.json"
DATA_FILE = "data2.json"
game_active = False
game_task = None

# ================= LOAD/SAVE =================

def load():
    if not os.path.exists(DATA_FILE):
        return {"users": {}, "bets": {}}
    with open(DATA_FILE, "r") as f:
        return json.load(f)

def save(data):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

data = load()

# ================= USER CREATE =================

def get_user(uid, user=None):
    if uid not in data["users"]:
        data["users"][uid] = {
            "winning": 0,
            "deposit": 0,
            "bonus": 0,
            "referral": 0,
            "last_bonus": "0"
        }
        save(data)
    return data["users"][uid]

# ================= PHOTO HANDLER FIX =================

async def photo(update, context):
    uid = str(update.effective_user.id)

    if uid not in data["users"]:
        return await update.message.reply_text("❌ Start bot first")

    if context.user_data.get("dep") == "ss":
        amt = context.user_data.get("amt")

        if not amt:
            return await update.message.reply_text("❌ Amount missing")

        await context.bot.send_message(
            ADMIN_ID,
            f"💰 Deposit Request\nUser: {uid}\nAmount: ₹{amt}",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("✅ Approve",
        callback_data=f"d_ok_{uid}_{amt}"),       
                InlineKeyboardButton("❌ Reject",     
        callback_data=f"d_no_{uid}_{amt}")  
            ]])
        )

        await update.message.reply_text("⏳ Deposit sent for approval")

        # साफ़ cleanup
        context.user_data.pop("dep", None)
        context.user_data.pop("amt", None)
        return

    return await update.message.reply_text("❌ Invalid deposit flow")
# ================= JOINN =================

async def force_join(update: Update, context: ContextTypes.DEFAULT_TYPE):
    buttons = []

    for i, ch in enumerate(CHANNELS):
        buttons.append([
            InlineKeyboardButton(
                f"📢 Join Channel {i+1}",
                url=f"https://t.me/{ch[1:]}"
            )
        ])

    buttons.append([
        InlineKeyboardButton("✅ I Joined", callback_data="check_join")
    ])

    text = """
╔═══〔 🔥 JOIN REQUIRED 〕═══╗
🚀 Access bot features by joining channels

👉 Join all channels below
✅ Then click "I Joined"
╚══════════════════════╝
"""

    if update.message:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(buttons))
    else:
        await update.effective_chat.send_message(text, reply_markup=InlineKeyboardMarkup(buttons))
        
async def check_join(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    user_id = query.from_user.id
    uid = str(user_id)

    # 🔒 CHECK CHANNEL JOIN
    for ch in CHANNELS:
        try:
            member = await context.bot.get_chat_member(ch, user_id)
            if member.status not in ["member", "administrator", "creator"]:
                return await query.answer("❌ पहले सभी चैनल join करो", show_alert=True)
        except:
            return await query.answer("❌ पहले सभी चैनल join करो", show_alert=True)

    # 🔗 REF LINK
    ref_link = f"https://t.me/{context.bot.username}?start={uid}"

    kb = [
        ["🎮 Play", "💰 Balance"],
        ["➕ Deposit", "➖ Withdraw"],
        ["👥 Refer", "🎁 Daily Bonus"]
    ]

    user = query.from_user

    await query.message.reply_text(
f"""
✨━━━━━━━━━━━━━━━━━━━━━━━━━━━✨
🎭  RTF GAMING COLOUR PREDICTION
✨━━━━━━━━━━━━━━━━━━━━━━━━━━━✨

👋 Welcome {user.first_name} 🎉

⚡ Your Gaming Profile:
━━━━━━━━━━━━━━━━━━━━━━
🆔 ID: {user.id}
👤 Name: {user.first_name}
🏷️ Username: @{user.username if user.username else "N/A"}

━━━━━━━━━━━━━━━━━━━━━━
🚀 QUICK ACTIONS
━━━━━━━━━━━━━━━━━━━━━━
🎁 CLAIM FREE BONUS DAILY
💰 EARN PLAY MONEY
🏆 WIN & WITHDRAW INSTANTLY

━━━━━━━━━━━━━━━━━━━━━━
💎 DEPOSIT BONUS SYSTEM
━━━━━━━━━━━━━━━━━━━━━━
💰 ₹10  → 🎁 ₹2 Bonus
💰 ₹20  → 🎁 ₹4 Bonus
💰 ₹40  → 🎁 ₹8 Bonus
💰 ₹50  → 🎁 ₹10 Bonus
💰 ₹100 → 🎁 ₹20 Bonus

━━━━━━━━━━━━━━━━━━━━━━
⚠️ RULES
━━━━━━━━━━━━━━━━━━━━━━
🛡️ Play responsibly
⚖️ Follow guidelines
🔒 Secure gameplay

━━━━━━━━━━━━━━━━━━━━━━
👑 OWNER: @RTFGAMMING
📢 CHANNEL: @RTFGAMINGHACK0

✨ READY TO PLAY & WIN BIG ✨
""",
reply_markup=ReplyKeyboardMarkup(kb, resize_keyboard=True)
)


# ================= START =================

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = str(update.effective_user.id)

    args = context.args
    ref_id = args[0] if args else None

    # FORCE JOIN CHECK
    for ch in CHANNELS:
        try:
            member = await context.bot.get_chat_member(ch, update.effective_user.id)
            if member.status not in ["member", "administrator", "creator"]:
                return await force_join(update, context)
        except:
            return await force_join(update, context)

    # USER CREATE
    if uid not in data["users"]:
        user = update.effective_user

        data["users"][uid] = {
            "winning": 0,
            "deposit": 0,
            "bonus": 0,
            "referral": 0,
            "name": user.first_name,
            "username": user.username,
            "last_bonus": "0"
        }

        # ================= REFERRAL SYSTEM =================
        if ref_id and ref_id != uid and ref_id in data["users"]:

            data["users"][ref_id]["winning"] += 0
            data["users"][ref_id]["referral"] += 1   # 👈 यही वाली line

            try:
                await context.bot.send_message(
                    ref_id,
                    "🎉 You earned ₹1 referral bonus"
                )
            except:
                pass

        save(data)

    # 🔗 REF LINK
    ref_link = f"https://t.me/{context.bot.username}?start={uid}"

    kb = [
        ["🎮 Play", "💰 Balance"],
        ["➕ Deposit", "➖ Withdraw"],
        ["👥 Refer", "🎁 Daily Bonus"]
    ]

    user = update.effective_user

    await update.message.reply_text(
f"""
✨━━━━━━━━━━━━━━━━━━━━━━━━━━━✨
🎭  RTF GAMING COLOUR PREDICTION
✨━━━━━━━━━━━━━━━━━━━━━━━━━━━✨

👋 Welcome {user.first_name} 🎉

⚡ Your Gaming Profile:
━━━━━━━━━━━━━━━━━━━━━━
🆔 ID: {user.id}
👤 Name: {user.first_name}
🏷️ Username: @{user.username if user.username else "N/A"}

━━━━━━━━━━━━━━━━━━━━━━
🚀 QUICK ACTIONS
━━━━━━━━━━━━━━━━━━━━━━
🎁 CLAIM FREE BONUS DAILY
💰 EARN PLAY MONEY
🏆 WIN & WITHDRAW INSTANTLY

━━━━━━━━━━━━━━━━━━━━━━
💎 DEPOSIT BONUS SYSTEM
━━━━━━━━━━━━━━━━━━━━━━
💰 ₹10  → 🎁 ₹2 Bonus
💰 ₹20  → 🎁 ₹4 Bonus
💰 ₹40  → 🎁 ₹8 Bonus
💰 ₹50  → 🎁 ₹10 Bonus
💰 ₹100 → 🎁 ₹20 Bonus

━━━━━━━━━━━━━━━━━━━━━━
⚠️ RULES
━━━━━━━━━━━━━━━━━━━━━━
🛡️ Play responsibly
⚖️ Follow guidelines
🔒 Secure gameplay

━━━━━━━━━━━━━━━━━━━━━━
👑 OWNER: @RTFGAMMING
📢 CHANNEL: @RTFGAMINGHACK0

✨ READY TO PLAY & WIN BIG ✨
""",
reply_markup=ReplyKeyboardMarkup(kb, resize_keyboard=True)
)
    

# ================= REFER =================

async def refer(update, context):
    uid = str(update.effective_user.id)

    if uid not in data["users"]:
        return await update.message.reply_text("❌ Start bot first")

    ref_link = f"https://t.me/{context.bot.username}?start={uid}"
    refs = data["users"][uid]["referral"]

    await update.message.reply_text(
        f"👥 Your Link:\n{ref_link}\n\nEarn ₹1 per referral\nTotal: {refs}"
    )

# ================= BALANCE =================

async def balance(update, context):
    uid = str(update.effective_user.id)
    user = data["users"].get(uid)

    if not user:
        return await update.message.reply_text("Start bot first")

    deposit = user["deposit"]
    bonus = user["bonus"]
    winning = user["winning"]
    referral = user["referral"]

    # ✅ ab total me sab include
    total = deposit + bonus + winning + referral

    # 🔥 button add kiya
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🔄 Convert Referral TO WITHDRAWAL AMMOUNT", callback_data="convert_ref")]
    ])

    await update.message.reply_text(
        f"""
💰 BALANCE DETAILS

🏦 DEPOSIT (Play Money): ₹{deposit}
🎁 BONUS (Play Credit): ₹{bonus}
💰 WINNING (Withdrawable): ₹{winning}
👥 REFERRAL: ₹{referral}

━━━━━━━━━━━━━━
💰 TOTAL BALANCE: ₹{total}
""",
        reply_markup=kb
    )

# ================= DEPOSIT =================

async def deposit(update, context):
    await update.message.reply_text("Enter amount (min ₹5):")
    context.user_data["dep"] = True

async def handle_msg(update, context):
    uid = str(update.effective_user.id)
    txt = update.message.text

    # ================= USER CHECK =================
    if uid not in data["users"]:
        return await update.message.reply_text("❌ Start bot first")

    user = data["users"][uid]

#=========BET FLOW========

    if context.user_data.get("bet"):
        try:
            amt = int(txt)
        except:
            return await update.message.reply_text("❌ Enter valid amount")

        if not game_active:
            return await update.message.reply_text("❌ Game not active")

        total = user["deposit"] + user["bonus"] + user["winning"]

        if total < amt:
            return await update.message.reply_text("❌ Low balance")

        if uid in data["bets"]:
            return await update.message.reply_text("❌ Already bet placed")

        #=============== WALLET PRIORITY (DEPOSIT → BONUS → WINNING) ===========
        stake_from = {"deposit": 0, "bonus": 0, "winning": 0}
        remaining = amt

        # 1️⃣ Deposit first
        use = min(user["deposit"], remaining)
        user["deposit"] -= use
        stake_from["deposit"] = use
        remaining -= use

        # 2️⃣ Bonus second
        if remaining > 0:
            use = min(user["bonus"], remaining)
            user["bonus"] -= use
            stake_from["bonus"] = use
            remaining -= use

        # 3️⃣ Winning last
        if remaining > 0:
            use = min(user["winning"], remaining)
            user["winning"] -= use
            stake_from["winning"] = use
            remaining -= use

        # safety check
        if remaining > 0:
            return await update.message.reply_text("❌ Not enough balance")

        #=============== SAVE BET ===========
        data["bets"][uid] = {
            "choice": context.user_data["bet"],
            "amount": amt,
            "stake_from": stake_from
        }

        save(data)
        context.user_data.pop("bet", None)

        return await update.message.reply_text("✅ Bet placed successfully")

    # ================= DEPOSIT FLOW =================
    if context.user_data.get("dep") == True:
        try:
            amt = int(txt)
        except:
            return await update.message.reply_text("❌ Enter valid amount")

        if amt < 5:
            return await update.message.reply_text("❌ Minimum ₹5 required")

        context.user_data["amt"] = amt
        context.user_data["dep"] = "ss"

        await update.message.reply_text(
            f"💳 Pay ₹{amt} to:\n{UPI_ID}\n\n📸 Send payment screenshot here"
        )
        return

    # ================= WITHDRAW FLOW STEP 1 =================
    if context.user_data.get("wd") == "amt":
        try:
            amt = int(txt)
        except:
            return await update.message.reply_text("❌ Enter valid amount")

        if amt < 20:
            return await update.message.reply_text("❌ Minimum withdrawal is ₹20")

        if user["winning"] < amt:
            return await update.message.reply_text("❌ Not enough winning balance")

        context.user_data["amt"] = amt
        context.user_data["wd"] = "upi"

        return await update.message.reply_text("🔒 Send your UPI ID")

    # ================= WITHDRAW FLOW STEP 2 =================
    if context.user_data.get("wd") == "upi":
        upi = txt
        amt = context.user_data["amt"]

        await context.bot.send_message(
            ADMIN_ID,
            f"💸 Withdraw Request\nUser: {uid}\n₹{amt}\nUPI: {upi}",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("✅", callback_data=f"w_ok_{uid}_{amt}"),
                InlineKeyboardButton("❌", callback_data=f"w_no_{uid}")
            ]])
        )

        await update.message.reply_text("⏳ Withdrawal request sent")
        context.user_data.clear()
        return

# ================= WITHDRAW =================

async def withdraw(update, context):
    await update.message.reply_text("Enter amount:")
    context.user_data["wd"] = "amt"

# ================= ADMIN =================
async def admin_callback(update, context):
    q = update.callback_query
    await q.answer()

    data_cb = q.data

    # ================= DEPOSIT APPROVAL =================
    if data_cb.startswith("d_ok"):
        _, _, uid, amt = data_cb.split("_")
        amt = int(amt)

        bonus = amt // 5

        data["users"][uid]["deposit"] += amt
        data["users"][uid]["bonus"] += bonus

        save(data)

        await context.bot.send_message(
            uid,
            f"✅ Deposit ₹{amt} approved\n🎁 Bonus ₹{bonus} added"
        )

        await q.edit_message_text("Deposit Approved")

    # ================= DEPOSIT REJECT =================
    elif data_cb.startswith("d_no"):
        uid = data_cb.split("_")[2]

        await context.bot.send_message(
            uid,
            "❌ Your deposit request was rejected"
        )

        await q.edit_message_text("Rejected")

    # ================= WITHDRAW APPROVAL =================
    elif data_cb.startswith("w_ok"):
        _, _, uid, amt = data_cb.split("_")
        amt = int(amt)

        if data["users"][uid]["winning"] >= amt:
            data["users"][uid]["winning"] -= amt
            save(data)

            await context.bot.send_message(
                uid,
                f"✅ Withdrawal ₹{amt} successful"
            )
        else:
            await context.bot.send_message(
                uid,
                "❌ Insufficient winning balance"
            )

        await q.edit_message_text("Withdrawal Approved")

    # ================= WITHDRAW REJECT =================
    elif data_cb.startswith("w_no"):
        uid = data_cb.split("_")[2]

        await context.bot.send_message(
            uid,
            "❌ Your withdrawal request was rejected"
        )

        await q.edit_message_text("Withdrawal Rejected")

#================= DEPOSIT BONUS =============
    
def calc_bonus(amt):
    return amt // 5

# ================= CONVERT REFERRAL =================
async def convert_ref(update, context):
    q = update.callback_query
    await q.answer()

    uid = str(q.from_user.id)
    user = data["users"].get(uid)

    if not user:
        return await q.message.reply_text("❌ User not found")

    ref_amt = user["referral"]

    if ref_amt <= 0:
        return await q.answer("❌ No referral balance", show_alert=True)

    # 🔥 convert
    user["winning"] += ref_amt
    user["referral"] = 0

    save(data)

    await q.edit_message_text(
        f"✅ Referral ₹{ref_amt} converted to Winning 💰"
    )
# ================= GAME =================

async def play(update, context):
    if not game_active:
        return await update.message.reply_text("❌ Game Time 7pm to 10pm")

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🔵 Big", callback_data="big")],
        [InlineKeyboardButton("🔴 Small", callback_data="small")]
    ])
    await update.message.reply_text("Choose:", reply_markup=kb)

async def bet(update, context):
    q = update.callback_query
    await q.answer()  # 👈 IMPORTANT

    context.user_data["bet"] = q.data
    await q.message.reply_text("💰 Enter bet amount:")

#===========GAME LOOP=========

async def game_loop(context):
    global game_active

    while True:
        if not game_active:
            await asyncio.sleep(2)
            continue

        # ================= NOTIFY USERS =================
        for uid in list(data["users"].keys()):
            try:
                await context.bot.send_message(
                    chat_id=uid,
                    text="🎮 New Round Started!\n⏳ 30 sec betting time"
                )
            except:
                pass

        # ⏳ betting time
        await asyncio.sleep(30)

        # ================= COPY BETS =================
        bets_copy = data["bets"].copy()
        data["bets"] = {}

        # ================= CALCULATE TOTALS =================
        big = sum(v["amount"] for v in bets_copy.values() if v["choice"] == "big")
        small = sum(v["amount"] for v in bets_copy.values() if v["choice"] == "small")

        result = "big" if big < small else "small"

        winners = []

        # ================= WIN / LOSS =================
        for uid, bet in bets_copy.items():
            try:
                if bet["choice"] == result:
                    win_amt = bet["amount"] * 2
                    data["users"][uid]["winning"] += win_amt
                    winners.append(uid)

                    await context.bot.send_message(
                        uid,
                        f"🎉 You Won ₹{win_amt}"
                    )
                else:
                    await context.bot.send_message(
                        uid,
                        "❌ You Lost"
                    )
            except:
                pass

        save(data)

        # ================= RESULT BROADCAST =================
        for uid in list(data["users"].keys()):
            try:
                if uid in winners:
                    await context.bot.send_message(
                        uid,
                        f"🎯 RESULT: {result.upper()}\n\n"
                        f"🔵 Big: ₹{big}\n🔴 Small: ₹{small}\n"
                        f"🏆 You WON!"
                    )
                else:
                    await context.bot.send_message(
                        uid,
                        f"🎯 RESULT: {result.upper()}\n\n"
                        f"🔵 Big: ₹{big}\n🔴 Small: ₹{small}\n"
                        f"❌ You LOST"
                    )
            except:
                pass

        await asyncio.sleep(5)

# ================= GAME START =================

async def startgame(update, context):
    global game_active, game_task

    if update.effective_user.id != ADMIN_ID:
        return await update.message.reply_text("❌ You are not admin")

    if game_active:
        return await update.message.reply_text("⚠️ Game already running")

    game_active = True

    await update.message.reply_text("✅ Continuous game started")

    # cancel old task if exists
    if game_task:
        game_task.cancel()

    # start single loop
    game_task = context.application.create_task(game_loop(context))

    # broadcast
    for uid in data["users"]:
        try:
            await context.bot.send_message(
                chat_id=uid,
                text="🎮 Game Started!\n👉 Play now!"
            )
        except:
            pass

    await update.message.reply_text("✅ Game Started (30 sec PLAY PR CLICK KRE AUR KHELE)")  
    
    #====STOPGAME====
async def stopgame(update, context):
    global game_active, game_task

    if update.effective_user.id != ADMIN_ID:
        return await update.message.reply_text("❌ You are not admin")

    if not game_active:
        return await update.message.reply_text("⚠️ Game already stopped")

    game_active = False

    # 🛑 STOP GAME LOOP TASK
    if game_task:
        game_task.cancel()
        game_task = None

    await update.message.reply_text("🛑 Game stopped successfully")

    # ================= FINAL SETTLEMENT =================
    bets_copy = data["bets"].copy()
    data["bets"] = {}

    big = sum(v["amount"] for v in bets_copy.values() if v["choice"] == "big")
    small = sum(v["amount"] for v in bets_copy.values() if v["choice"] == "small")

    result = "big" if big < small else "small"

    winners = []

    for uid, bet in bets_copy.items():
        try:
            if bet["choice"] == result:
                win_amt = bet["amount"] * 2
                data["users"][uid]["winning"] += win_amt
                winners.append(uid)

                await context.bot.send_message(
                    uid,
                    f"🎉 Final Settlement Win ₹{win_amt}"
                )
            else:
                await context.bot.send_message(
                    uid,
                    "❌ Final Result: You Lost"
                )
        except:
            pass

    save(data)

    # ================= SUMMARY =================
    for uid in data["users"]:
        try:
            await context.bot.send_message(
                uid,
                f"📊 FINAL RESULT: {result.upper()}\n"
                f"🔵 Big: ₹{big}\n"
                f"🔴 Small: ₹{small}\n"
                f"🏆 Winners: {len(winners)}"
            )
        except:
            pass
            
# ========DAILY BONUS FUNCTION=======

from datetime import datetime

async def daily_bonus(update, context):
    uid = str(update.effective_user.id)
    user = get_user(uid, update.effective_user)

    today = str(datetime.now().date())

    if user.get("last_bonus") == today:
        return await update.message.reply_text("❌ Aaj already bonus le chuke ho")

    bonus = 3  # fixed daily bonus

    user["bonus"] += bonus
    user["last_bonus"] = today

    save(data)

    await update.message.reply_text(f"🎁 Daily bonus ₹{bonus} added")

# ================= BROADCAST =================

async def broadcast(update, context):
    if update.effective_user.id != ADMIN_ID:
        return await update.message.reply_text("❌ You are not admin")

    if not context.args:
        return await update.message.reply_text("❌ Use:\n/all message")

    msg = " ".join(context.args)

    sent = 0
    failed = 0

    for uid in data["users"]:
        try:
            await context.bot.send_message(uid, msg)
            sent += 1
        except:
            failed += 1

    await update.message.reply_text(f"✅ Sent: {sent}\n❌ Failed: {failed}")
 
# ================= SINGLE USER MSG =================

async def send_user(update, context):
    if update.effective_user.id != ADMIN_ID:
        return await update.message.reply_text("❌ You are not admin")

    if len(context.args) < 2:
        return await update.message.reply_text(
            "❌ Use:\n/userid message\nor\n/username message"
        )

    target = context.args[0]
    msg = " ".join(context.args[1:])

    # अगर @username दिया है
    if target.startswith("@"):
        uid = None
        for u, info in data["users"].items():
            if info.get("username") == target[1:]:
                uid = u
                break
        if not uid:
            return await update.message.reply_text("❌ Username not found")
    else:
        uid = target  # direct user id

    try:
        await context.bot.send_message(uid, msg)
        await update.message.reply_text("✅ Message sent")
    except:
        await update.message.reply_text("❌ Failed to send")
   
# ================= MAIN =================

app = (
    ApplicationBuilder()
    .token(TOKEN)
    .connect_timeout(30)
    .read_timeout(30)
    .pool_timeout(30)
    .get_updates_connect_timeout(30)
    .get_updates_read_timeout(30)
    .build()
)

# ===== COMMANDS =====
app.add_handler(CommandHandler("start", start))
app.add_handler(CommandHandler("startgame", startgame))
app.add_handler(CommandHandler("stopgame", stopgame))

# ===== MENU BUTTONS =====
app.add_handler(MessageHandler(filters.TEXT & filters.Regex("👥 Refer"), refer))
app.add_handler(MessageHandler(filters.TEXT & filters.Regex("💰 Balance"), balance))
app.add_handler(MessageHandler(filters.TEXT & filters.Regex("➕ Deposit"), deposit))
app.add_handler(MessageHandler(filters.TEXT & filters.Regex("➖ Withdraw"), withdraw))
app.add_handler(MessageHandler(filters.TEXT & filters.Regex("🎮 Play"), play))
app.add_handler(MessageHandler(filters.TEXT & filters.Regex("🎁 Daily Bonus"), daily_bonus))

# ===== NEW / IMPORTANT ADDITIONS =====

# 🔥 Daily Bonus Command
app.add_handler(CommandHandler("daily", daily_bonus))

# 🔥 Force Join Callback
app.add_handler(CallbackQueryHandler(check_join, pattern="check_join"))

# 🔥 Betting Callback (Big / Small)
app.add_handler(CallbackQueryHandler(bet, pattern="^(big|small)$"))

# 🔥 Admin Approval System (Deposit + Withdraw)
app.add_handler(CallbackQueryHandler(admin_callback, pattern="^(d_|w_)"))

# 🔥 Referral Convert Button (NEW)
app.add_handler(CallbackQueryHandler(convert_ref, pattern="convert_ref"))

# ===== USER MESSAGE HANDLER (MAIN ENGINE) =====
app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), handle_msg))

# ===== PHOTO (DEPOSIT SCREENSHOT) =====
app.add_handler(MessageHandler(filters.PHOTO, photo))
app.add_handler(CommandHandler("all", broadcast))
app.add_handler(CommandHandler("send", send_user))

print("Bot Running...")
app.run_polling(
    drop_pending_updates=True,
    allowed_updates=Update.ALL_TYPES
)
