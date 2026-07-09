import mongoose from 'mongoose';

const profileCommentSchema = new mongoose.Schema(
  {
    profile: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    likes: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true },
);

profileCommentSchema.index({ profile: 1, createdAt: -1 });

export default mongoose.model('ProfileComment', profileCommentSchema);
