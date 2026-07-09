import mongoose from 'mongoose';

export const ROLES = ['visitor', 'student', 'admin'];
export const SHOWCASE_TYPES = ['favorite-game', 'games-made', 'recent-games', 'reviews', 'screenshots', 'custom'];

const showcaseSchema = new mongoose.Schema(
  {
    type: { type: String, enum: SHOWCASE_TYPES, required: true },
    title: { type: String, trim: true, maxlength: 80, default: '' },
    text: { type: String, trim: true, maxlength: 2000, default: '' },
    gameSlug: { type: String, trim: true, lowercase: true, maxlength: 100, default: '' },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 32,
      match: [/^[a-z0-9_.-]+$/, 'Username may only contain letters, digits, ., - and _'],
    },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    displayName: { type: String, trim: true, maxlength: 80 },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, default: 'visitor' },

    // Profile page
    bio: { type: String, trim: true, maxlength: 500, default: '' },
    avatarFileId: { type: mongoose.Schema.Types.ObjectId, default: null }, // GridFS
    bannerFileId: { type: mongoose.Schema.Types.ObjectId, default: null }, // GridFS
    showcases: { type: [showcaseSchema], default: [] },
  },
  { timestamps: true },
);

userSchema.methods.avatarUrl = function avatarUrl() {
  return this.avatarFileId ? `/api/users/${this.username}/avatar?v=${this.updatedAt?.getTime() ?? 0}` : null;
};

userSchema.methods.bannerUrl = function bannerUrl() {
  return this.bannerFileId ? `/api/users/${this.username}/banner?v=${this.updatedAt?.getTime() ?? 0}` : null;
};

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    username: this.username,
    email: this.email,
    displayName: this.displayName || this.username,
    role: this.role,
    bio: this.bio,
    avatarUrl: this.avatarUrl(),
    bannerUrl: this.bannerUrl(),
    createdAt: this.createdAt,
  };
};

export default mongoose.model('User', userSchema);
