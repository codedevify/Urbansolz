const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  items: [{ product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, quantity: Number }],
  total: Number,
  email: String,
  status: { type: String, default: 'Pending' },
  stripeSessionId: String
});

module.exports = mongoose.model('Order', orderSchema);