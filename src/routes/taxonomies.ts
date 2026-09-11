import { Router } from 'express';
import { asyncHandler } from '@dotevolve/error-utils';
import {
  getTaxonomies,
  createTaxonomyItem,
  updateTaxonomyItem,
  deleteTaxonomyItem,
} from '../controllers/taxonomyController';

const router = Router();

// Public routes
router.get('/', asyncHandler(getTaxonomies));

// Admin routes
router.post('/:type', asyncHandler(createTaxonomyItem));
router.put('/:type/:id', asyncHandler(updateTaxonomyItem));
router.delete('/:type/:id', asyncHandler(deleteTaxonomyItem));

export default router;
