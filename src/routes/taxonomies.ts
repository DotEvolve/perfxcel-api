import { Router } from "express";
import { asyncHandler } from "@dotevolve/error-utils";
import { requireAuth } from "../middleware/auth";
import {
  getTaxonomies,
  createTaxonomyItem,
  updateTaxonomyItem,
  deleteTaxonomyItem,
} from "../controllers/taxonomyController";

const router = Router();

router.get("/", requireAuth, asyncHandler(getTaxonomies));
router.post("/:type", requireAuth, asyncHandler(createTaxonomyItem));
router.put("/:type/:id", requireAuth, asyncHandler(updateTaxonomyItem));
router.delete("/:type/:id", requireAuth, asyncHandler(deleteTaxonomyItem));

export default router;
