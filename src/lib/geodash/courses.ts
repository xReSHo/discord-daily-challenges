/**
 * Read-through for today's geodash course. Kept separate from `daily.ts` so the
 * course generator + physics stay pure and importable by verification scripts
 * (no Prisma / daily-content dependency).
 */

import { getOrCreateDailyContent } from "@/lib/daily-content";
import { deriveCourseWithSolution, type Difficulty } from "./daily";
import type { Course } from "./physics";

type DailyCoursePayload = { course: Course };

export async function getDailyCourse(difficulty: Difficulty): Promise<Course> {
  const payload = await getOrCreateDailyContent<DailyCoursePayload>(
    `geodash:${difficulty}`,
    (dateStr) => ({ course: deriveCourseWithSolution(dateStr, difficulty).course }),
  );
  return payload.course;
}
