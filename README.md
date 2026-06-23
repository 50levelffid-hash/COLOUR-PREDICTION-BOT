# RTF Gaming Bot — Node.js

Telegram colour prediction bot with MongoDB backend, ready for Render deployment.

## Files
```
rtf-gaming-bot/
├── index.js        ← Main bot logic
├── game.js         ← Game state & helpers
├── models.js       ← MongoDB schemas
├── db.js           ← DB connection & helpers
├── package.json
├── render.yaml     ← Render auto-deploy config
├── .env            ← Local dev only (DO NOT commit)
└── .gitignore
```

## Local Setup
```bash
npm install
node index.js
```

## Render Deployment Steps
1. Push code to GitHub (without .env)
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo
4. Render auto-reads render.yaml
5. Set Environment Variables in Render dashboard:
   - BOT_TOKEN
   - ADMIN_ID
   - CHANNELS  (comma-separated, e.g. @ch1,@ch2)
   - DEFAULT_UPI_ID
   - MONGO_URL

## Admin Commands
| Command | Description |
|---------|-------------|
| /admin  | Admin panel (UPI, QR, game control, forward channel, backup) |
| /startgame | Start game loop |
| /stopgame  | Stop game loop |
| /all <msg> | Broadcast to all users |
| /send <uid/@user> <msg> | Message specific user |
| /add <uid> <amt> <wallet> | Add balance (deposit/bonus/winning) |
| /daily | Get daily bonus |

## New Features vs Python Version
- ✅ MongoDB — all users, bets, transactions persisted
- ✅ Top 10 Leaderboard (by total wallet balance)
- ✅ Forward channel — deposit/withdrawal sent to group too
- ✅ Admin backup button — exports DB as JSON
- ✅ No repeated /start for betting — inline BIG/SMALL buttons work continuously
- ✅ 40-50 concurrent users — batched edits, connection pool, Promise.all
- ✅ Min withdrawal raised to ₹30
- ✅ Transaction history stored per user
- ✅ Render keep-alive Express server included
