const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
  username: String,
  password: String  // Plaintext for demo; use bcrypt in production
});

module.exports = mongoose.model('Admin', adminSchema);