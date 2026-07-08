import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    game: { type: mongoose.Schema.Types.ObjectId, ref: 'Game', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, trim: true, maxlength: 4000, default: '' },
  },
  { timestamps: true },
);

reviewSchema.index({ user: 1, game: 1 }, { unique: true });
reviewSchema.index({ game: 1, createdAt: -1 });

export default mongoose.model('Review', reviewSchema);
