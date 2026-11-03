import { NextResponse } from "next/server";
import { getMongoDb } from "@/lib/mongo";
import { requireRole } from "@/lib/auth";

// MongoDB aggregation report: total watch hours and unique viewers per course.
export async function GET() {
  const { error } = await requireRole(["admin"]);
  if (error) return error;

  try {
    const db = await getMongoDb();
    const rows = await db
      .collection("activity_events")
      .aggregate([
        { $match: { event_type: { $in: ["pause", "ended"] } } },
        {
          $group: {
            _id: "$course_id",
            total_seconds: { $sum: "$watch_seconds" },
            viewers: { $addToSet: "$user_id" },
          },
        },
        {
          $project: {
            _id: 0,
            course_id: "$_id",
            watch_hours: { $round: [{ $divide: ["$total_seconds", 3600] }, 2] },
            unique_viewers: { $size: "$viewers" },
          },
        },
        { $sort: { watch_hours: -1 } },
      ])
      .toArray();
    return NextResponse.json({ rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Report unavailable" }, { status: 503 });
  }
}
