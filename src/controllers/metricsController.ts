import { Request, Response } from "express";
import { perfxcelSupabase } from "../db/supabase";
import { AppError, ErrorCategory } from "@dotevolve/error-utils";

// ---------------------------------------------------------------------------
// In-memory cache — interim solution until Redis is wired up (see GitHub #3)
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 300_000; // 5 minutes

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

let metricsCache: CacheEntry | null = null;

export const getDashboardMetrics = async (
  req: Request,
  res: Response,
): Promise<void> => {
  // Return cached response if still valid
  if (metricsCache && metricsCache.expiresAt > Date.now()) {
    res.status(200).json({ status: "success", data: metricsCache.data });
    return;
  }

  const count = { count: "exact" as const, head: true };

  const [
    courses,
    categories,
    cities,
    associations,
    deliveryModes,
    interestsNew,
    interestsContacted,
    interestsEnrolled,
    interestsRejected,
    interestsTotal,
    enrollmentsPending,
    enrollmentsInProgress,
    enrollmentsAchieved,
    enrollmentsDropped,
    enrollmentsTotal,
    certificatesTotal,
    allCourses,
    allInterests,
    allEnrollments,
  ] = await Promise.all([
    perfxcelSupabase.from("courses").select("*", count),
    perfxcelSupabase.from("categories").select("*", count),
    perfxcelSupabase.from("cities").select("*", count),
    perfxcelSupabase.from("associations").select("*", count),
    perfxcelSupabase.from("delivery_modes").select("*", count),
    perfxcelSupabase.from("course_interests").select("*", count).eq("status", "new"),
    perfxcelSupabase
      .from("course_interests")
      .select("*", count)
      .eq("status", "contacted"),
    perfxcelSupabase
      .from("course_interests")
      .select("*", count)
      .eq("status", "enrolled"),
    perfxcelSupabase
      .from("course_interests")
      .select("*", count)
      .eq("status", "rejected"),
    perfxcelSupabase.from("course_interests").select("*", count),
    perfxcelSupabase.from("enrollments").select("*", count).eq("status", "pending"),
    perfxcelSupabase.from("enrollments").select("*", count).eq("status", "in_progress"),
    perfxcelSupabase.from("enrollments").select("*", count).eq("status", "achieved"),
    perfxcelSupabase.from("enrollments").select("*", count).eq("status", "dropped"),
    perfxcelSupabase.from("enrollments").select("*", count),
    perfxcelSupabase.from("certificates").select("*", count),
    perfxcelSupabase.from("courses").select("id, course_categories(categories(name))"),
    perfxcelSupabase.from("course_interests").select("id, courses(title)"),
    perfxcelSupabase
      .from("enrollments")
      .select("status, course_interests(courses(title))"),
  ]);

  // Check each result for errors, throw AppError if any query failed
  const results = [
    courses,
    categories,
    cities,
    associations,
    deliveryModes,
    interestsNew,
    interestsContacted,
    interestsEnrolled,
    interestsRejected,
    interestsTotal,
    enrollmentsPending,
    enrollmentsInProgress,
    enrollmentsAchieved,
    enrollmentsDropped,
    enrollmentsTotal,
    certificatesTotal,
    allCourses,
    allInterests,
    allEnrollments,
  ];

  for (const result of results) {
    if (result.error) {
      throw new AppError(result.error.message, 500, ErrorCategory.SYSTEM);
    }
  }

  // JS Aggregations for detailed lists
  const categoryCounts: Record<string, number> = {};
  allCourses.data?.forEach((c: any) => {
    if (c.course_categories && c.course_categories.length > 0) {
      c.course_categories.forEach((cc: any) => {
        const catName = cc.categories?.name ?? "Uncategorized";
        categoryCounts[catName] = (categoryCounts[catName] || 0) + 1;
      });
    } else {
      categoryCounts["Uncategorized"] =
        (categoryCounts["Uncategorized"] || 0) + 1;
    }
  });
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const interestCounts: Record<string, number> = {};
  allInterests.data?.forEach((i: any) => {
    const title = i.courses?.title ?? "Unknown Course";
    interestCounts[title] = (interestCounts[title] || 0) + 1;
  });
  const mostDemanded = Object.entries(interestCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([title, count]) => ({ title, count }));

  const completionStats: Record<
    string,
    { achieved: number; in_progress: number }
  > = {};
  allEnrollments.data?.forEach((e: any) => {
    const title = e.course_interests?.courses?.title ?? "Unknown Course";
    if (!completionStats[title]) {
      completionStats[title] = { achieved: 0, in_progress: 0 };
    }
    if (e.status === "achieved") completionStats[title].achieved++;
    if (e.status === "in_progress") completionStats[title].in_progress++;
  });
  const topCompletions = Object.entries(completionStats)
    .sort((a, b) => {
      if (b[1].achieved !== a[1].achieved) return b[1].achieved - a[1].achieved;
      return b[1].in_progress - a[1].in_progress;
    })
    .slice(0, 5)
    .map(([title, stats]) => ({ title, ...stats }));

  const responseData = {
    courses: { total: courses.count ?? 0 },
    taxonomies: {
      categories: categories.count ?? 0,
      cities: cities.count ?? 0,
      associations: associations.count ?? 0,
      delivery_modes: deliveryModes.count ?? 0,
    },
    interests: {
      total: interestsTotal.count ?? 0,
      new: interestsNew.count ?? 0,
      contacted: interestsContacted.count ?? 0,
      enrolled: interestsEnrolled.count ?? 0,
      rejected: interestsRejected.count ?? 0,
    },
    enrollments: {
      total: enrollmentsTotal.count ?? 0,
      pending: enrollmentsPending.count ?? 0,
      in_progress: enrollmentsInProgress.count ?? 0,
      achieved: enrollmentsAchieved.count ?? 0,
      dropped: enrollmentsDropped.count ?? 0,
    },
    certificates: {
      total: certificatesTotal.count ?? 0,
    },
    detailed: {
      topCategories,
      mostDemanded,
      topCompletions,
    },
  };

  // Populate cache
  metricsCache = { data: responseData, expiresAt: Date.now() + CACHE_TTL_MS };

  res.status(200).json({ status: "success", data: responseData });
};
