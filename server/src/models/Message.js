import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

messageSchema.index({ from: 1, to: 1, createdAt: -1 });
messageSchema.index({ to: 1, readAt: 1 });

messageSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    from: this.from.toString(),
    to: this.to.toString(),
    text: this.text,
    readAt: this.readAt,
    createdAt: this.createdAt,
  };
};

export default mongoose.model('Message', messageSchema);
