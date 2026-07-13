import mongoose from 'mongoose';

export const BUILD_STATUSES = ['none', 'queued', 'cloning', 'building', 'packaging', 'success', 'failed'];

const mediaSchema = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true }, // GridFS
    contentType: { type: String, default: 'image/png' },
    kind: { type: String, enum: ['cover', 'screenshot'], required: true },
  },
  { _id: true },
);

const collabRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true, _id: false },
);

const gameSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, match: /^[a-z0-9-]+$/ },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // original creator

    // Co-owners with full equal control, plus pending join requests
    collaborators: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    collabRequests: { type: [collabRequestSchema], default: [] },

    // Source
    sourceType: { type: String, enum: ['repo', 'executable', 'web'], default: 'repo' },
    repoUrl: { type: String, trim: true, default: '' },
    websiteUrl: { type: String, trim: true, default: '' }, // sourceType 'web': hosted site URL
    branch: { type: String, trim: true, default: '' }, // '' = repo default branch
    metadataLocked: { type: Boolean, default: false },
    mediaLocked: { type: Boolean, default: false },

    // Metadata mirrored from isc.json on each successful import
    title: { type: String, required: true, trim: true, maxlength: 80 },
    shortDescription: { type: String, trim: true, maxlength: 200, default: '' },
    description: { type: String, trim: true, maxlength: 8000, default: '' },
    version: { type: String, trim: true, default: '1.0.0' },
    authors: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    controls: { type: String, trim: true, maxlength: 300, default: '' },
    year: { type: Number },
    engine: {
      name: { type: String, default: 'fungraphics' },
      version: { type: String, default: '' },
    },
    mainClass: { type: String, trim: true, default: '' },

    media: { type: [mediaSchema], default: [] },

    // Store state
    published: { type: Boolean, default: false }, // set by admins (moderation)
    featured: { type: Boolean, default: false },
    downloads: { type: Number, default: 0 },

    // Build pipeline
    buildStatus: { type: String, enum: BUILD_STATUSES, default: 'none' },
    buildLog: { type: String, default: '', maxlength: 100000 },
    builtAt: { type: Date },
    commit: { type: String, default: '' },
    packageFileId: { type: mongoose.Schema.Types.ObjectId }, // GridFS zip (Windows)
    packageFilename: { type: String, trim: true, default: '' },
    packageContentType: { type: String, trim: true, default: 'application/zip' },
    packageSize: { type: Number, default: 0 },
    linuxPackageFileId: { type: mongoose.Schema.Types.ObjectId }, // GridFS zip (Linux)
    linuxPackageFilename: { type: String, trim: true, default: '' },
    linuxPackageSize: { type: Number, default: 0 },
  },
  { timestamps: true },
);

gameSchema.index({ title: 'text', shortDescription: 'text', tags: 'text' });

/** Store-card / store-page shape (safe for everyone). */
gameSchema.methods.toStore = function toStore() {
  const cover = this.media.find((m) => m.kind === 'cover');
  const screenshots = this.media.filter((m) => m.kind === 'screenshot');
  return {
    id: this._id,
    slug: this.slug,
    title: this.title,
    shortDescription: this.shortDescription,
    description: this.description,
    version: this.version,
    authors: this.authors,
    tags: this.tags,
    controls: this.controls,
    year: this.year,
    engine: this.engine,
    sourceType: this.sourceType,
    repoUrl: this.repoUrl,
    websiteUrl: this.websiteUrl,
    published: this.published,
    featured: this.featured,
    downloads: this.downloads,
    buildStatus: this.buildStatus,
    builtAt: this.builtAt,
    packageSize: this.packageSize,
    downloadable: this.buildStatus === 'success' && !!this.packageFileId,
    downloadableLinux: this.buildStatus === 'success' && !!this.linuxPackageFileId,
    coverUrl: cover ? `/api/games/${this.slug}/media/${cover._id}` : null,
    screenshotUrls: screenshots.map((s) => `/api/games/${this.slug}/media/${s._id}`),
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model('Game', gameSchema);
