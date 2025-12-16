import mongoose, { Schema } from "mongoose";

const SubmitLogSchema = new Schema({
    ip: { type: String, required: true, index: true },
    createdAt: { type: Date, default: Date.now, expires: 3600 }, // TTL: 1 hour
});

SubmitLogSchema.index({ ip: 1, createdAt: -1 });

export const SubmitLog = mongoose.models.SubmitLog ?? mongoose.model("SubmitLog", SubmitLogSchema);
