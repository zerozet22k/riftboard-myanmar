import mongoose, { Schema } from "mongoose";

export type SchedulerLeaseDoc = {
  _id: string;
  owner: string;
  leaseUntil: Date;
  startedAt: Date;
  updatedAt: Date;
};

const SchedulerLeaseSchema = new Schema<SchedulerLeaseDoc>(
  {
    _id: { type: String, required: true },
    owner: { type: String, required: true },
    leaseUntil: { type: Date, required: true, index: true },
    startedAt: { type: Date, required: true },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    versionKey: false,
  }
);

export const SchedulerLease =
  (mongoose.models.SchedulerLease as mongoose.Model<SchedulerLeaseDoc>) ??
  mongoose.model<SchedulerLeaseDoc>("SchedulerLease", SchedulerLeaseSchema);
