import { Request, Response } from "express";
import { supabase } from "../db/supabase";
import { AppError, ErrorCategory } from "@dotevolve/error-utils";

export const getDashboardMetrics = async (req: Request, res: Response): Promise<void> => {
  const count = { count: "exact" as const, head: true };

  const [
    courses,
    categories, cities, associations, deliveryModes,
    interestsNew, interestsContacted, interestsEnrolled, interestsRejected,
    enrollmentsPending, enrollmentsInProgress, enrollmentsAchieved, enrollmentsDropped,
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
    supabase.from("enrollments").select("*", count).eq("status", "pending"),
    supabase.from("enrollments").select("*", count).eq("status", "in_progress"),
    supabase.from("enrollments").select("*", count).eq("status", "achieved"),
    supabase.from("enrollments").select("*", count).eq("status", "dropped"),
  ]);

  // Check each result for errors, throw AppError if any query failed
  const results = [
    courses, categories, cities, associations, deliveryModes,
    interestsNew, interestsContacted, interestsEnrolled, interestsRejected,
    enrollmentsPending, enrollmentsInProgress, enrollmentsAchieved, enrollmentsDropped
  ];
  
  for (const result of results) {
    if (result.error) {
      throw new AppError(result.error.message, 500, ErrorCategory.SYSTEM);
    }
  }

  res.status(200).json({
    status: "success",
    data: {
      courses: { total: courses.count ?? 0 },
      taxonomies: {
        categories: categories.count ?? 0,
        cities: cities.count ?? 0,
        associations: associations.count ?? 0,
        delivery_modes: deliveryModes.count ?? 0,
      },
      interests: {
        new: interestsNew.count ?? 0,
        contacted: interestsContacted.count ?? 0,
        enrolled: interestsEnrolled.count ?? 0,
        rejected: interestsRejected.count ?? 0,
      },
      enrollments: {
        pending: enrollmentsPending.count ?? 0,
        in_progress: enrollmentsInProgress.count ?? 0,
        achieved: enrollmentsAchieved.count ?? 0,
        dropped: enrollmentsDropped.count ?? 0,
      },
    },
  });
};
