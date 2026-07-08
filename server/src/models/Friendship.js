import mongoose from 'mongoose';

const friendshipSchema = new mongoose.Schema(
  {
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted'], default: 'pending' },
  },
  { timestamps: true },
);

friendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });
friendshipSchema.index({ recipient: 1, status: 1 });

/** The friendship between two users, whichever direction it was requested in. */
friendshipSchema.statics.between = function between(a, b) {
  return this.findOne({
    $or: [
      { requester: a, recipient: b },
      { requester: b, recipient: a },
    ],
  });
};

export default mongoose.model('Friendship', friendshipSchema);
