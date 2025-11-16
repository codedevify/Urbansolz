const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
  stripePublishableKey: String,
  stripeSecretKey: String,
  paypalClientId: String,
  paypalSecret: String
});

module.exports = mongoose.model('Config', configSchema);