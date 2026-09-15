import { Request, Response } from "express";
import { supabase } from "../db/supabase";
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

export const getDashboardMetrics = async (req: Request, res: Response): Promise<void> => {
  // Return cached response if still valid
  if (metricsCache && metricsCache.expiresAt > Date.now()) {
    res.status(200).json({ status: "success", data: metricsCache.data });
    return;
  }

  const count = { count: "exact" as const, head: true };

  const [
    courses,
    categories, cities, associations, deliveryModes,
    interestsNew, interestsContacted, interestsEnrolled, interestsRejected, interestsTotal,
    enrollmentsPending, enrollmentsInProgress, enrollmentsAchieved, enrollmentsDropped, enrollmentsTotal,
    certificatesTotal,
  ] = await Promise.all([
    supabase.from("courses").select("*", count),
    supabase.from("categories").select("*", count),
    supabase.from("cities").select("*", count),
    supabase.from("associations").select("*", count),
    supabase.from("delivery_modes").select("*", count),
    supabase.from("course_interests").select("*", count).eq("status", "new"),
    supabase.from("course_interests").select("*", count).eq("status", "contacted"),
    supabase.from("course_interests").select("*", count).eq("status", "enrolled"),
    supabase.from("course_interests").select("*", count).eq("status", "rejected"),
    supabase.from("course_interests").select("*", count),
    supabase.from("enrollments").select("*", count).eq("status", "pending"),
    supabase.from("enrollments").select("*", count).eq("status", "in_progress"),
    supabase.from("enrollments").select("*", count).eq("status", "achieved"),
    supabase.from("enrollments").select("*", count).eq("status", "dropped"),
    supabase.from("enrollments").select("*", count),
    supabase.from("certificates").select("*", count),
  ]);

  // Check each result for errors, throw AppError if any query failed
  const results = [
    courses, categories, cities, associations, deliveryModes,
    interestsNew, interestsContacted, interestsEnrolled, interestsRejected, interestsTotal,
    enrollmentsPending, enrollmentsInProgress, enrollmentsAchieved, enrollmentsDropped, enrollmentsTotal,
    certificatesTotal
  ];
  
  for (const result of results) {
    if (result.error) {
      throw new AppError(result.error.message, 500, ErrorCategory.SYSTEM);
    }
  }

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
  };

  // Populate cache
  metricsCache = { data: responseData, expiresAt: Date.now() + CACHE_TTL_MS };

  res.status(200).json({ status: "success", data: responseData });
};
