import mongoose, { Schema } from "mongoose";

export type RankEntryDoc = {
    playerId: mongoose.Types.ObjectId;
    queue: string;

    tier?: string;
    division?: string;
    lp?: number;
    wins?: number;
    losses?: number;

    fetchedAt: Date;
};

const RankEntrySchema = new Schema<RankEntryDoc>(
    {
        playerId: { type: Schema.Types.ObjectId, ref: "Player", required: true, index: true },
        queue: { type: String, required: true, trim: true, index: true },

        tier: { type: String, trim: true },
        division: { type: String, trim: true },
        lp: Number,
        wins: Number,
        losses: Number,

        fetchedAt: { type: Date, default: Date.now, index: true },
    },
    { timestamps: false }
);

RankEntrySchema.index({ playerId: 1, queue: 1, fetchedAt: -1 });

export const RankEntry =
    (mongoose.models.RankEntry as mongoose.Model<RankEntryDoc>) ??
    mongoose.model<RankEntryDoc>("RankEntry", RankEntrySchema);
