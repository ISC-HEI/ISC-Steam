import mongoose from 'mongoose';

const libraryEntrySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    game: { type: mongoose.Schema.Types.ObjectId, ref: 'Game', required: true },
    secondsPlayed: { type: Number, default: 0, min: 0 },
    lastPlayedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

libraryEntrySchema.index({ user: 1, game: 1 }, { unique: true });

export default mongoose.model('LibraryEntry', libraryEntrySchema);
