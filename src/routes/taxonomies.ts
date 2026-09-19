import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import { requirePerfxcelTenant } from "../middleware/tenant";
import {
  getTaxonomies,
  createTaxonomyItem,
  updateTaxonomyItem,
  deleteTaxonomyItem,
} from "../controllers/taxonomyController";

const router = Router();

router.get("/", asyncHandler(getTaxonomies));
router.post(
  "/:type",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(createTaxonomyItem),
);
router.put(
  "/:type/:id",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(updateTaxonomyItem),
);
router.delete(
  "/:type/:id",
  requireAuth,
  requirePerfxcelTenant,
  asyncHandler(deleteTaxonomyItem),
);

export default router;
