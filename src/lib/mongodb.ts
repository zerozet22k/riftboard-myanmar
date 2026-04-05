import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("Missing env MONGODB_URI");

type Cached = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const g = globalThis as unknown as { __mongo?: Cached };

const cached: Cached = g.__mongo ?? { conn: null, promise: null };
g.__mongo = cached;

export async function dbConnect() {
    if (cached.conn) return cached.conn;

    if (!cached.promise) {
        cached.promise = mongoose.connect(MONGODB_URI!, {
            autoIndex: process.env.NODE_ENV !== "production",
        });
    }

    cached.conn = await cached.promise;
    return cached.conn;
}
