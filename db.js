require('dotenv').config();
const mongoose = require('mongoose');
const { User, Settings } = require('./models');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 50,       // handle 40-50 concurrent users
      minPoolSize: 5
    });
    console.log('✅ MongoDB Connected');
    await initSettings();
  } catch (err) {
    console.error('❌ MongoDB Error:', err.message);
    process.exit(1);
  }
}

async function initSettings() {
  const defaults = [
    { key: 'upi_id', value: process.env.DEFAULT_UPI_ID },
    { key: 'qr_file_id', value: null },
    { key: 'forward_channel', value: null }
  ];
  for (const d of defaults) {
    await Settings.findOneAndUpdate({ key: d.key }, { $setOnInsert: { value: d.value } }, { upsert: true, new: true });
  }
}

async function getSetting(key) {
  const s = await Settings.findOne({ key });
  return s ? s.value : null;
}

async function setSetting(key, value) {
  await Settings.findOneAndUpdate({ key }, { value }, { upsert: true });
}

async function getUser(uid, userObj = null) {
  let user = await User.findOne({ uid });
  if (!user) {
    user = await User.create({
      uid,
      name: userObj?.first_name || 'Unknown',
      username: userObj?.username || null
    });
  }
  return user;
}

async function getBalance(user) {
  return (user.deposit || 0) + (user.bonus || 0) + (user.winning || 0);
}

module.exports = { connectDB, getSetting, setSetting, getUser, getBalance };
