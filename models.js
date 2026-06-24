const mongoose = require('mongoose');

// ── User Schema ──
const userSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true, index: true },
  name: { type: String, default: 'Unknown' },
  username: { type: String, default: null },
  phone: { type: String, default: null },
  deposit: { type: Number, default: 0 },
  bonus: { type: Number, default: 0 },
  winning: { type: Number, default: 0 },
  referral: { type: Number, default: 0 },
  referral_count: { type: Number, default: 0 },
  last_bonus: { type: String, default: '0' },
  referred_by: { type: String, default: null },
  banned: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});

// ── Bet Schema ──
const betSchema = new mongoose.Schema({
  uid: { type: String, required: true, index: true },
  round: { type: Number, required: true },
  choice: { type: String, enum: ['big', 'small'], required: true },
  amount: { type: Number, required: true },
  stake_from: {
    deposit: { type: Number, default: 0 },
    bonus: { type: Number, default: 0 },
    winning: { type: Number, default: 0 }
  },
  result: { type: String, enum: ['win', 'loss', 'pending'], default: 'pending' },
  payout: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
});

// ── Settings Schema ──
const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null }
});

// ── Transaction Schema (for backup/history) ──
const transactionSchema = new mongoose.Schema({
  uid: { type: String, required: true, index: true },
  type: { type: String, enum: ['deposit', 'withdrawal', 'bet_win', 'bet_loss', 'bonus', 'referral'], required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  upi_id: { type: String, default: null },
  screenshot_file_id: { type: String, default: null },
  admin_note: { type: String, default: null },
  forward_channel: { type: String, default: null },
  created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Bet = mongoose.model('Bet', betSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = { User, Bet, Settings, Transaction };
