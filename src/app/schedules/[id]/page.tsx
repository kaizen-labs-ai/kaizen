import { getSchedule } from "@/lib/schedules/queries";
import { serialize } from "@/lib/db/serialize";
import { ScheduleDetailClient } from "./schedule-detail-client";

export default async function ScheduleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const schedule = id === "new" ? null : await getSchedule(id);
  return <ScheduleDetailClient initialData={schedule ? serialize(schedule) : null} id={id} />;
}
