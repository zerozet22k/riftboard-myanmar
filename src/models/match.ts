// models/match.ts
import mongoose, { Schema } from "mongoose";

export type MatchDoc = {
    matchId: string; // unique
    region: string;  // "sea" etc

    queueId?: number;
    gameCreation?: number; // unix ms
    gameDuration?: number; // seconds

    raw?: any;

    fetchedAt: Date;
};

const MatchSchema = new Schema<MatchDoc>(
    {
        matchId: { type: String, required: true, trim: true, unique: true },
        region: { type: String, required: true, lowercase: true, trim: true, index: true },

        queueId: Number,
        gameCreation: Number,
        gameDuration: Number,

        raw: Schema.Types.Mixed,

        fetchedAt: { type: Date, default: Date.now, index: true },
    },
    { timestamps: false }
);

MatchSchema.index({ region: 1, gameCreation: -1 });

export const Match =
    (mongoose.models.Match as mongoose.Model<MatchDoc>) ??
    mongoose.model<MatchDoc>("Match", MatchSchema);
